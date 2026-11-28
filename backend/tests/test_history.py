"""Batch history and blockchain integrity verification (US-07).

Tampering tests change a temporary test database, never the local application database. The
verifier is called directly on those copies, so the result is independent of the API.
"""

import hashlib
import json
import sqlite3

import pytest

from app.db import init_db
from app.services.ledger_verification import verify_ledger

from tests.auth_helpers import sign_in

FARMER_KEY = "aaaa1111-bbbb-4ccc-8ddd-000000000201"
VALID_BATCH = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}


def independent_block_hash(index, timestamp, event_payload, previous_hash):
    """Hash of the documented ledger input, written out by hand (not via the module under test)."""
    text = (
        '{"event_data":' + json.dumps(event_payload, ensure_ascii=False)
        + ',"index":' + str(index)
        + ',"previous_hash":' + json.dumps(previous_hash)
        + ',"timestamp":' + json.dumps(timestamp)
        + "}"
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _role(client, role):
    assert sign_in(client, role).status_code == 200


def _scenario(client):
    """Register a batch, ship it to the retailer, and confirm receipt. Returns the batch ID."""
    _role(client, "farmer")
    batch = client.post("/api/batches", json=VALID_BATCH, headers={"Idempotency-Key": FARMER_KEY}).get_json()["batch"]
    _role(client, "distributor")
    client.post(
        "/api/shipments",
        json={"batch_id": batch["batch_id"], "status": "Shipped", "note": "Left the farm"},
        headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000201"},
    )
    client.post(
        "/api/shipments",
        json={"batch_id": batch["batch_id"], "status": "In Transit"},
        headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000203"},
    )
    client.post(
        "/api/shipments",
        json={"batch_id": batch["batch_id"], "status": "Delivered to Retailer"},
        headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000202"},
    )
    _role(client, "retailer")
    client.post("/api/receipts", json={"batch_id": batch["batch_id"]}, headers={"Idempotency-Key": "cccc3333-dddd-4eee-8fff-000000000201"})
    return batch["batch_id"]


def _snapshot(db_path):
    conn = _connect(db_path)
    try:
        tables = {}
        for name in ("users", "product_batches", "supply_chain_events", "ledger_blocks"):
            tables[name] = [tuple(row) for row in conn.execute(f"SELECT * FROM {name} ORDER BY 1")]
        return tables
    finally:
        conn.close()


def _verify_copy(db_path):
    conn = _connect(db_path)
    try:
        return verify_ledger(conn)
    finally:
        conn.close()


def _failures(result, check=None):
    return [f for f in result["failures"] if check is None or f["check"] == check]


# --- Batch history -------------------------------------------------------------------------


def test_history_includes_registration_shipment_and_receipt_events(client):
    batch_id = _scenario(client)
    _role(client, "farmer")

    history = client.get(f"/api/history/{batch_id}").get_json()

    types = [event["event_type"] for event in history["events"]]
    assert types == [
        "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]
    assert history["count"] == 5
    assert history["batch"]["current_status"] == "Received by Retailer"


def test_history_events_show_actor_status_note_and_block_index(client):
    batch_id = _scenario(client)
    _role(client, "retailer")

    events = client.get(f"/api/history/{batch_id}").get_json()["events"]

    registration, first_shipment, second_shipment, third_shipment, receipt = events
    assert (registration["label"], registration["actor_role"], registration["status"]) == ("Registration", "farmer", "Registered")
    assert (first_shipment["label"], first_shipment["actor_role"], first_shipment["status"]) == ("Shipment", "distributor", "Shipped")
    assert first_shipment["note"] == "Left the farm"
    assert (second_shipment["status"], second_shipment["note"]) == ("In Transit", None)
    assert (third_shipment["status"], third_shipment["note"]) == ("Delivered to Retailer", None)
    assert (receipt["label"], receipt["actor_role"], receipt["status"]) == ("Receipt", "retailer", "Received by Retailer")
    assert [event["ledger_block_index"] for event in events] == [1, 2, 3, 4, 5]


def test_history_is_in_chronological_order(client):
    batch_id = _scenario(client)
    _role(client, "farmer")

    events = client.get(f"/api/history/{batch_id}").get_json()["events"]

    timestamps = [event["timestamp"] for event in events]
    assert timestamps == sorted(timestamps)
    assert len({event["event_id"] for event in events}) == len(events)


def test_history_is_restricted_to_the_requested_batch(client):
    first = _scenario(client)
    _role(client, "farmer")
    second = client.post(
        "/api/batches",
        json=dict(VALID_BATCH, product_name="Wheat"),
        headers={"Idempotency-Key": "dddd4444-eeee-4fff-8000-000000000201"},
    ).get_json()["batch"]["batch_id"]

    first_events = client.get(f"/api/history/{first}").get_json()["events"]
    second_events = client.get(f"/api/history/{second}").get_json()["events"]

    assert len(first_events) == 5
    assert len(second_events) == 1
    assert second_events[0]["event_type"] == "PRODUCT_REGISTERED"
    assert {event["event_id"] for event in first_events}.isdisjoint({event["event_id"] for event in second_events})


def test_unknown_batch_history_returns_not_found(client):
    _role(client, "farmer")

    response = client.get("/api/history/PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


@pytest.mark.parametrize("batch_id", ["not-a-batch", "PB-7K2M9QXD"])
def test_malformed_batch_id_for_history_is_a_bad_request(client, batch_id):
    _role(client, "farmer")

    assert client.get(f"/api/history/{batch_id}").status_code == 400


def test_history_requires_an_active_session(client):
    batch_id = _scenario(client)
    client.delete("/api/session")

    assert client.get(f"/api/history/{batch_id}").status_code == 401


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_every_demonstration_role_can_read_history(client, role):
    batch_id = _scenario(client)
    _role(client, role)

    assert client.get(f"/api/history/{batch_id}").status_code == 200


# --- Verification of an unmodified ledger ----------------------------------------------------


def test_unmodified_ledger_is_valid(client):
    _scenario(client)
    _role(client, "farmer")

    body = client.get("/api/ledger/verify").get_json()

    assert client.get("/api/ledger/verify").status_code == 200
    assert body["result"] == "valid"
    assert body["failures"] == []
    assert body["first_failing_block"] is None
    assert body["checked_blocks"] == 6  # genesis, registration, three shipments, receipt
    assert body["latest_block_index"] == 5
    assert all(check["passed"] for check in body["checks"])


def test_genesis_block_is_checked(db_path):
    init_db(db_path)

    result = _verify_copy(db_path)

    assert result["result"] == "valid"
    assert "genesis" in {c["id"] for c in result["checks"]}


def test_recalculated_latest_hash_matches_independent_hash(client, db_path):
    _scenario(client)

    result = _verify_copy(db_path)
    conn = _connect(db_path)
    last = conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index DESC LIMIT 1").fetchone()
    conn.close()

    assert result["recalculated_latest_hash"] == independent_block_hash(
        last["block_index"], last["timestamp"], last["event_payload"], last["previous_hash"]
    )
    assert result["recalculated_latest_hash"] == last["block_hash"]


def test_verification_reports_checks_by_name(client, db_path):
    _scenario(client)

    result = _verify_copy(db_path)

    assert {check["id"] for check in result["checks"]} == {
        "genesis", "sequence", "canonical_data", "timestamps", "hash_format",
        "previous_hash_links", "block_hashes", "event_references", "event_uniqueness",
        "event_consistency", "event_coverage",
    }


# --- Tampering is detected -------------------------------------------------------------------


def _tamper(db_path, sql, params=()):
    conn = _connect(db_path)
    conn.execute(sql, params)
    conn.commit()
    conn.close()


def test_modified_event_payload_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET event_payload = REPLACE(event_payload, 'Left the farm', 'Left the depot') WHERE block_index = 2")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert result["first_failing_block"] == 2
    assert [f["block_index"] for f in _failures(result, "block_hashes")] == [2]
    assert "does not match the recalculated hash" in _failures(result, "block_hashes")[0]["reason"]


def test_modified_timestamp_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET timestamp = '2030-01-01T00:00:00.000Z' WHERE block_index = 1")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert 1 in [f["block_index"] for f in _failures(result, "block_hashes")]
    assert result["first_failing_block"] == 1


def test_modified_block_hash_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET block_hash = ? WHERE block_index = 3", ("f" * 64,))

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert [f["block_index"] for f in _failures(result, "block_hashes")] == [3]
    # Links are checked against recalculated hashes, so a changed stored hash alone does not break the chain.
    assert _failures(result, "previous_hash_links") == []


def test_broken_previous_hash_link_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET previous_hash = ? WHERE block_index = 2", ("a" * 64,))

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert 2 in [f["block_index"] for f in _failures(result, "previous_hash_links")]
    assert result["first_failing_block"] == 2


def test_missing_block_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "DELETE FROM ledger_blocks WHERE block_index = 2")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert _failures(result, "sequence"), "a gap in indexes must be reported"
    assert _failures(result, "previous_hash_links"), "the block after the gap must not link"
    assert any(f["check"] == "event_coverage" for f in result["failures"]), "the deleted block's event must be reported"


def test_reordered_blocks_are_detected(client, db_path):
    _scenario(client)
    # Swap the indexes of blocks 1 and 2 through a temporary index (block_index must stay >= 0).
    _tamper(db_path, "UPDATE ledger_blocks SET block_index = 999 WHERE block_index = 1")
    _tamper(db_path, "UPDATE ledger_blocks SET block_index = 1 WHERE block_index = 2")
    _tamper(db_path, "UPDATE ledger_blocks SET block_index = 2 WHERE block_index = 999")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert _failures(result, "sequence") or _failures(result, "previous_hash_links")


def test_modified_genesis_is_detected(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET previous_hash = ? WHERE block_index = 0", ("1" * 64,))

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert any(f["block_index"] == 0 and f["check"] == "genesis" for f in result["failures"])


def test_non_canonical_event_data_is_detected(db_path):
    init_db(db_path)
    _tamper(db_path, "UPDATE ledger_blocks SET event_payload = '{ \"event_type\": \"GENESIS\" }' WHERE block_index = 0")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert _failures(result, "canonical_data")


def test_removed_ledger_leaves_the_registration_events_uncovered(client, db_path):
    _scenario(client)
    _tamper(db_path, "DELETE FROM ledger_blocks")

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert _failures(result, "genesis"), "an empty ledger has no genesis block"
    assert len(_failures(result, "event_coverage")) == 5


def test_forged_hash_consistent_with_altered_data_still_breaks_the_next_link(client, db_path):
    _scenario(client)
    conn = _connect(db_path)
    rows = [dict(r) for r in conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index")]
    conn.close()
    block = rows[2]
    forged_payload = block["event_payload"].replace("Left the farm", "Left the depot")
    forged_hash = independent_block_hash(block["block_index"], block["timestamp"], forged_payload, block["previous_hash"])
    _tamper(db_path, "UPDATE ledger_blocks SET event_payload = ?, block_hash = ? WHERE block_index = 2", (forged_payload, forged_hash))

    result = _verify_copy(db_path)

    assert result["result"] == "invalid"
    assert 3 in [f["block_index"] for f in _failures(result, "previous_hash_links")]


# --- Verification is read-only -----------------------------------------------------------------


def test_verification_does_not_modify_database_contents(client, db_path):
    _scenario(client)
    before = _snapshot(db_path)

    _verify_copy(db_path)
    _verify_copy(db_path)

    assert _snapshot(db_path) == before


def test_verification_does_not_append_blocks(client, db_path):
    _scenario(client)
    before = _count_blocks(db_path)

    client.get("/api/ledger/verify")
    client.get("/api/ledger/verify")

    assert _count_blocks(db_path) == before


def test_verifier_restores_the_connection_mode_after_checking(db_path):
    """The verifier turns query_only on while it reads, and restores the previous setting afterwards."""
    init_db(db_path)
    conn = _connect(db_path)
    assert conn.execute("PRAGMA query_only").fetchone()[0] == 0

    result = verify_ledger(conn)

    assert result["result"] == "valid"
    assert conn.execute("PRAGMA query_only").fetchone()[0] == 0
    conn.execute("INSERT INTO users (display_name, username, role) VALUES ('X', 'x.user', 'farmer')")
    conn.commit()
    conn.close()


def _count_blocks(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM ledger_blocks").fetchone()[0]
    finally:
        conn.close()


def test_verify_endpoint_requires_an_active_session(client):
    client.delete("/api/session")

    assert client.get("/api/ledger/verify").status_code == 401


def test_verify_endpoint_reports_tampering_as_a_result_not_an_error(client, db_path):
    _scenario(client)
    _tamper(db_path, "UPDATE ledger_blocks SET block_hash = ? WHERE block_index = 1", ("e" * 64,))
    _role(client, "farmer")

    response = client.get("/api/ledger/verify")

    assert response.status_code == 200
    assert response.get_json()["result"] == "invalid"


# --- Existing behaviour stays intact -----------------------------------------------------------


def test_registration_shipment_and_receipt_still_work_after_verification(client):
    batch_id = _scenario(client)
    _role(client, "farmer")
    client.get("/api/ledger/verify")

    assert client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["current_status"] == "Received by Retailer"
    assert client.get("/api/ledger").get_json()["count"] == 6
    assert client.get("/api/health").status_code == 200
