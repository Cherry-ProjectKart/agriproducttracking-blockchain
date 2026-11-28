"""Ledger audit (BPT-111): the API the audit view uses, verification results and read-only behaviour.

The tampering helpers come from tests/test_ledger_integrity.py, so each scenario changes only a temporary
test database. The demonstration database is never touched.
"""

import sqlite3

import pytest

from app.db import connect, init_db
from app.services.ledger_service import canonical_json, compute_block_hash
from app.services.ledger_verification import verify_ledger

from tests.auth_helpers import sign_in
from tests.test_ledger_integrity import ROLE_SWAP_SQL, _full_chain, _run, _snapshot

PRIVATE_KEYS = ("password", "username", "user_id", "created_by", "session", "display_name")


def _keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key).lower()
            yield from _keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _keys(item)


def _as(client, role):
    assert sign_in(client, role).status_code == 200


# --- Verification through the API ------------------------------------------------------------


def test_valid_ledger_verifies_through_the_api(client):
    _full_chain(client)
    _as(client, "farmer")

    body = client.get("/api/ledger/verify").get_json()

    assert body["result"] == "valid"
    assert body["checked_blocks"] == 6  # genesis, registration, three shipments, receipt
    assert body["failures"] == []
    assert body["first_failing_block"] is None
    assert body["verified_at"]


def test_genesis_only_ledger_is_handled_and_valid(tmp_path):
    db = str(tmp_path / "genesis_only.db")
    init_db(db)
    conn = connect(db)
    try:
        body = verify_ledger(conn)
    finally:
        conn.close()

    assert body["result"] == "valid"
    assert body["checked_blocks"] == 1
    assert body["latest_block_index"] == 0


@pytest.mark.parametrize(
    "scenario, sql, expected_check, expected_block",
    [
        ("invalid block hash", "UPDATE ledger_blocks SET block_hash = '{f}' WHERE block_index = 2", "block_hashes", 2),
        ("previous-hash mismatch", "UPDATE ledger_blocks SET previous_hash = '{e}' WHERE block_index = 3", "previous_hash_links", 3),
        ("block index inconsistency", "DELETE FROM ledger_blocks WHERE block_index = 2", "sequence", 3),
        ("missing event reference", "DELETE FROM supply_chain_events WHERE id = (SELECT event_id FROM ledger_blocks WHERE block_index = 2)", "event_references", 2),
        ("duplicate event reference", "DROP INDEX idx_ledger_blocks_event_id; UPDATE ledger_blocks SET event_id = (SELECT event_id FROM ledger_blocks WHERE block_index = 2) WHERE block_index = 3", "event_uniqueness", 3),
        ("event/block content mismatch", "UPDATE supply_chain_events SET status = 'Delivered to Retailer' WHERE id = (SELECT event_id FROM ledger_blocks WHERE block_index = 2)", "event_consistency", 2),
        ("missing block", "DELETE FROM ledger_blocks WHERE block_index = (SELECT MAX(block_index) FROM ledger_blocks)", "event_coverage", None),
        ("altered event payload", ROLE_SWAP_SQL, "block_hashes", 2),
    ],
)
def test_each_integrity_failure_is_reported_through_the_api(client, db_path, scenario, sql, expected_check, expected_block):
    _full_chain(client)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")
    for statement in [s.strip() for s in sql.format(f="f" * 64, e="e" * 64).split(";") if s.strip()]:
        conn.execute(statement)
    conn.commit()
    conn.close()
    _as(client, "retailer")

    body = client.get("/api/ledger/verify").get_json()

    assert body["result"] == "invalid", scenario
    failed = {failure["check"] for failure in body["failures"]}
    assert expected_check in failed, scenario
    if expected_block is not None:
        assert expected_block in [f["block_index"] for f in body["failures"]], scenario
    assert body["failures"] and all(f["reason"] for f in body["failures"])


# --- Read-only and no repair -----------------------------------------------------------------------


def test_verification_does_not_mutate_the_ledger(client, db_path):
    _full_chain(client)
    before = _snapshot(db_path)
    _as(client, "farmer")

    client.get("/api/ledger/verify")
    client.get("/api/ledger/verify")

    assert _snapshot(db_path) == before


def test_verification_reports_a_corruption_without_repairing_it(client, db_path):
    _full_chain(client)
    _run(db_path, "UPDATE ledger_blocks SET block_hash = '" + "f" * 64 + "' WHERE block_index = 2")
    corrupted = _snapshot(db_path)
    _as(client, "farmer")

    first = client.get("/api/ledger/verify").get_json()
    second = client.get("/api/ledger/verify").get_json()

    assert first["result"] == second["result"] == "invalid"
    assert _snapshot(db_path) == corrupted  # still corrupted: nothing was rebuilt or rewritten


def test_verification_response_carries_no_account_or_session_data(client):
    _full_chain(client)
    _as(client, "distributor")

    body = client.get("/api/ledger/verify").get_json()
    keys = set(_keys(body))

    assert not any(private in key for key in keys for private in PRIVATE_KEYS)


# --- Access control ----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/ledger", "/api/ledger/latest", "/api/ledger/verify", "/api/ledger/blocks/0"])
def test_ledger_endpoints_reject_unauthenticated_requests(client, path):
    _full_chain(client)
    client.delete("/api/session")

    assert client.get(path).status_code == 401


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_every_demonstration_role_can_inspect_and_verify_the_ledger(client, role):
    _full_chain(client)
    _as(client, role)

    assert client.get("/api/ledger").status_code == 200
    assert client.get("/api/ledger/verify").status_code == 200


# --- Block history and details ---------------------------------------------------------------------------


def test_blocks_are_returned_in_index_order(client):
    _full_chain(client)
    _as(client, "farmer")

    blocks = client.get("/api/ledger").get_json()["blocks"]

    assert [b["index"] for b in blocks] == list(range(len(blocks)))


def test_block_details_match_the_persisted_rows(client, db_path):
    _full_chain(client)
    _as(client, "farmer")

    listed = client.get("/api/ledger").get_json()["blocks"]
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT block_index, timestamp, event_payload, previous_hash, block_hash, event_id FROM ledger_blocks ORDER BY block_index"
    ).fetchall()
    conn.close()

    for block, row in zip(listed, rows):
        detail = client.get(f"/api/ledger/blocks/{block['index']}").get_json()["block"]
        assert detail == block
        assert (detail["index"], detail["timestamp"], detail["previous_hash"], detail["block_hash"], detail["event_id"]) == (
            row[0], row[1], row[3], row[4], row[5],
        )


def test_every_block_hash_is_reproducible_from_the_returned_contents(client):
    _full_chain(client)
    _as(client, "farmer")

    for block in client.get("/api/ledger").get_json()["blocks"]:
        payload = canonical_json(block["event_data"])
        assert compute_block_hash(block["index"], block["timestamp"], payload, block["previous_hash"]) == block["block_hash"]


def test_event_to_block_references_agree_with_the_event_records(client, db_path):
    _full_chain(client)
    _as(client, "farmer")

    for block in client.get("/api/ledger").get_json()["blocks"]:
        if block["event_id"] is None:
            continue
        conn = sqlite3.connect(db_path)
        event = conn.execute(
            "SELECT e.event_type, b.batch_code FROM supply_chain_events e JOIN product_batches b ON b.id = e.batch_id WHERE e.id = ?",
            (block["event_id"],),
        ).fetchone()
        conn.close()
        assert event is not None
        assert block["event_data"]["event_id"] == block["event_id"]
        assert block["event_type"] == event[0]
        assert block["batch_id"] == event[1]


def test_reading_the_ledger_changes_nothing(client, db_path):
    _full_chain(client)
    before = _snapshot(db_path)
    _as(client, "retailer")

    client.get("/api/ledger")
    client.get("/api/ledger/latest")
    client.get("/api/ledger/blocks/3")
    client.get("/api/ledger/verify")

    assert _snapshot(db_path) == before
