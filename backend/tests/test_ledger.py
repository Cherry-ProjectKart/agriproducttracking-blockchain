"""Local hash-linked ledger (US-04): unit tests, registration integration, backfill and endpoints.

Hashes are recomputed here from a hand-written copy of the documented input format, using hashlib
directly. The tests do not call the module's own hashing function to check its output.
"""

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

import pytest

from app.db import init_db
from app.services import batch_service
from app.services.ledger_service import (
    GENESIS_INDEX,
    GENESIS_PREVIOUS_HASH,
    GENESIS_TIMESTAMP,
    LedgerError,
    append_block,
    canonical_json,
    compute_block_hash,
    ensure_genesis,
    get_block,
    get_block_for_event,
    get_latest_block,
    list_blocks,
    registration_event_data,
    serialize_event_data,
    utc_timestamp,
)

# Known answer: SHA-256 of the genesis hash input (see the module docstring for the format).
GENESIS_HASH = "20966f2f77cdf6f44a9c38308e39ea2640d576a436e401f39504c3de9447f603"
GENESIS_PAYLOAD = '{"event_type":"GENESIS"}'

KEY = "eeeeeeee-6666-4666-8666-000000000001"
VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}


def independent_block_hash(index, timestamp, event_payload, previous_hash):
    """Hash of the documented input, written out by hand (not via the module under test)."""
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


def _all_blocks(db_path):
    conn = _connect(db_path)
    rows = conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def _count(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _assert_chain_is_valid(blocks):
    """Independent check: indices are sequential, each previous hash matches, each hash recomputes."""
    assert blocks[0]["block_index"] == 0
    for position, block in enumerate(blocks):
        assert block["block_index"] == position
        expected_previous = GENESIS_PREVIOUS_HASH if position == 0 else blocks[position - 1]["block_hash"]
        assert block["previous_hash"] == expected_previous
        assert block["block_hash"] == independent_block_hash(
            block["block_index"], block["timestamp"], block["event_payload"], block["previous_hash"]
        )


# --- Hash input and serialisation (unit) ------------------------------------------


def test_canonical_json_sorts_keys_and_has_no_spaces():
    assert canonical_json({"b": 1, "a": {"d": "é", "c": [2, 1]}}) == '{"a":{"c":[2,1],"d":"é"},"b":1}'


def test_serialize_event_data_is_stable_regardless_of_key_order():
    first = serialize_event_data({"batch_id": "PB-AAAA-0001", "event_type": "X"})
    second = serialize_event_data({"event_type": "X", "batch_id": "PB-AAAA-0001"})

    assert first == second == '{"batch_id":"PB-AAAA-0001","event_type":"X"}'


def test_serialize_event_data_rejects_non_objects():
    with pytest.raises(LedgerError):
        serialize_event_data(["not", "an", "object"])


def test_genesis_block_hash_matches_the_known_answer_and_independent_recomputation():
    assert independent_block_hash(0, GENESIS_TIMESTAMP, GENESIS_PAYLOAD, GENESIS_PREVIOUS_HASH) == GENESIS_HASH
    assert compute_block_hash(0, GENESIS_TIMESTAMP, GENESIS_PAYLOAD, GENESIS_PREVIOUS_HASH) == GENESIS_HASH


def test_hash_is_deterministic():
    args = (3, "2026-11-26T10:00:00.000Z", '{"event_type":"X"}', "ab" * 32)

    assert compute_block_hash(*args) == compute_block_hash(*args)
    assert len(compute_block_hash(*args)) == 64


def test_hash_changes_when_event_data_changes():
    base = compute_block_hash(1, "2026-11-26T10:00:00.000Z", '{"quantity":250}', "00" * 32)
    changed = compute_block_hash(1, "2026-11-26T10:00:00.000Z", '{"quantity":251}', "00" * 32)

    assert base != changed


def test_hash_changes_when_previous_hash_changes():
    base = compute_block_hash(1, "2026-11-26T10:00:00.000Z", '{"quantity":250}', "00" * 32)
    changed = compute_block_hash(1, "2026-11-26T10:00:00.000Z", '{"quantity":250}', "11" * 32)

    assert base != changed


def test_hash_changes_when_index_or_timestamp_changes():
    base = compute_block_hash(1, "2026-11-26T10:00:00.000Z", "{}", "00" * 32)

    assert base != compute_block_hash(2, "2026-11-26T10:00:00.000Z", "{}", "00" * 32)
    assert base != compute_block_hash(1, "2026-11-26T10:00:00.001Z", "{}", "00" * 32)


def test_utc_timestamp_format_is_stable():
    moment = datetime(2026, 11, 26, 16, 40, 1, 123456, tzinfo=timezone.utc)

    assert utc_timestamp(moment) == "2026-11-26T16:40:01.123Z"


def test_utc_timestamp_converts_other_zones_to_utc():
    from datetime import timedelta

    moment = datetime(2026, 11, 26, 18, 0, 0, tzinfo=timezone(timedelta(hours=2)))

    assert utc_timestamp(moment) == "2026-11-26T16:00:00.000Z"


def test_registration_event_data_contains_product_facts_only():
    data = registration_event_data(
        event_id=7,
        batch_id="PB-AAAA-0001",
        product={"product_name": "Rice", "quantity": 2.0, "unit": "kg", "origin": "Farm", "harvest_date": "2026-01-01"},
    )

    assert data == {
        "event_type": "PRODUCT_REGISTERED",
        "event_id": 7,
        "batch_id": "PB-AAAA-0001",
        "actor_role": "farmer",
        "status": "Registered",
        "product_name": "Rice",
        "quantity": 2.0,
        "unit": "kg",
        "origin": "Farm",
        "harvest_date": "2026-01-01",
    }


# --- Ledger operations (unit, on a real database file) ------------------------------


def test_empty_ledger_has_no_latest_block_and_no_blocks(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    conn.execute("DELETE FROM ledger_blocks")

    assert get_latest_block(conn) is None
    assert get_block(conn, 0) is None
    assert list_blocks(conn) == []
    conn.close()


def test_genesis_block_is_created_by_initialisation(db_path):
    init_db(db_path)

    blocks = _all_blocks(db_path)

    assert len(blocks) == 1
    genesis = blocks[0]
    assert genesis["block_index"] == GENESIS_INDEX
    assert genesis["timestamp"] == GENESIS_TIMESTAMP
    assert genesis["event_payload"] == GENESIS_PAYLOAD
    assert genesis["previous_hash"] == GENESIS_PREVIOUS_HASH
    assert genesis["block_hash"] == GENESIS_HASH
    assert genesis["event_id"] is None


def test_ensure_genesis_does_not_create_a_second_genesis(db_path):
    init_db(db_path)
    conn = _connect(db_path)

    again = ensure_genesis(conn)
    conn.close()

    assert again["block_hash"] == GENESIS_HASH
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == 1


def test_appended_blocks_have_sequential_indices_and_link_to_previous_hash(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    first = append_block(conn, {"event_type": "A"}, None, timestamp="2026-01-01T00:00:00.000Z")
    second = append_block(conn, {"event_type": "B"}, None, timestamp="2026-01-01T00:00:01.000Z")
    conn.commit()
    conn.close()

    assert first["index"] == 1
    assert first["previous_hash"] == GENESIS_HASH
    assert second["index"] == 2
    assert second["previous_hash"] == first["block_hash"]
    _assert_chain_is_valid(_all_blocks(db_path))


def test_latest_block_and_chronological_order(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    for name in ["A", "B", "C"]:
        append_block(conn, {"event_type": name}, None)
    conn.commit()

    latest = get_latest_block(conn)
    ordered = [block["index"] for block in list_blocks(conn)]
    conn.close()

    assert latest["index"] == 3
    assert latest["event_type"] == "C"
    assert ordered == [0, 1, 2, 3]


def test_block_lookup_by_index_and_by_event(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    block = append_block(conn, {"event_type": "PRODUCT_REGISTERED", "event_id": 9}, None)
    conn.commit()

    assert get_block(conn, 1)["block_hash"] == block["block_hash"]
    assert get_block(conn, 999) is None
    assert get_block_for_event(conn, 9) is None
    conn.close()


def test_one_event_cannot_be_recorded_twice(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    conn.execute(
        "INSERT INTO users (display_name, username, role) VALUES ('U', 'ledger.user', 'farmer')"
    )
    user_id = conn.execute("SELECT id FROM users WHERE username = 'ledger.user'").fetchone()[0]
    conn.execute(
        "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
        "VALUES ('PB-LEDG-0001', 'Rice', 1, 'kg', 'Farm', '2026-01-01', ?)",
        (user_id,),
    )
    batch_row = conn.execute("SELECT id FROM product_batches WHERE batch_code = 'PB-LEDG-0001'").fetchone()[0]
    conn.execute(
        "INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status) VALUES (?, 'PRODUCT_REGISTERED', 'farmer', 'Registered')",
        (batch_row,),
    )
    event_id = conn.execute("SELECT MAX(id) FROM supply_chain_events").fetchone()[0]
    append_block(conn, {"event_type": "PRODUCT_REGISTERED", "event_id": event_id}, event_id)
    conn.commit()

    with pytest.raises(LedgerError, match="already has a ledger block"):
        append_block(conn, {"event_type": "PRODUCT_REGISTERED", "event_id": event_id}, event_id)
    conn.close()


def test_block_hash_changes_when_stored_event_data_is_altered(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    block = append_block(conn, {"event_type": "PRODUCT_REGISTERED", "quantity": 250.0}, None)
    conn.commit()
    conn.close()

    tampered_payload = serialize_event_data({"event_type": "PRODUCT_REGISTERED", "quantity": 999.0})
    recomputed = independent_block_hash(block["index"], block["timestamp"], tampered_payload, block["previous_hash"])

    assert recomputed != block["block_hash"]


# --- Registration integration ------------------------------------------------------------


def _as_farmer(client):
    assert client.post("/api/session", json={"role": "farmer"}).status_code == 201


def _register(client, key=KEY, **changes):
    return client.post("/api/batches", json=dict(VALID, **changes), headers={"Idempotency-Key": key})


def test_registration_creates_batch_event_and_exactly_one_block(client, db_path):
    _as_farmer(client)

    response = _register(client)

    assert response.status_code == 201
    batch = response.get_json()["batch"]
    assert _count(db_path, "SELECT COUNT(*) FROM product_batches WHERE batch_code = ?", (batch["batch_id"],)) == 1
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'PRODUCT_REGISTERED'") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NOT NULL") == 1


def test_first_registration_block_follows_the_genesis_block(client, db_path):
    _as_farmer(client)

    _register(client)

    blocks = _all_blocks(db_path)
    assert [block["block_index"] for block in blocks] == [0, 1]
    assert blocks[1]["previous_hash"] == blocks[0]["block_hash"]
    _assert_chain_is_valid(blocks)


def test_registration_block_contains_the_registration_event_data(client, db_path):
    _as_farmer(client)
    batch = _register(client).get_json()["batch"]

    block = _all_blocks(db_path)[1]
    data = json.loads(block["event_payload"])

    assert data["event_type"] == "PRODUCT_REGISTERED"
    assert data["batch_id"] == batch["batch_id"]
    assert data["product_name"] == "Basmati Rice"
    assert data["quantity"] == 250.0
    assert data["origin"] == "Green Valley Farm"
    assert block["timestamp"].endswith("Z")
    assert block["event_id"] == _count(db_path, "SELECT MAX(id) FROM supply_chain_events")


def test_block_hash_is_independently_reproducible(client, db_path):
    _as_farmer(client)
    _register(client)

    for block in _all_blocks(db_path):
        assert block["block_hash"] == independent_block_hash(
            block["block_index"], block["timestamp"], block["event_payload"], block["previous_hash"]
        )


def test_second_registration_links_to_the_first_block(client, db_path):
    _as_farmer(client)
    _register(client, key="ffffffff-7777-4777-8777-000000000001")
    _register(client, key="ffffffff-7777-4777-8777-000000000002", product_name="Wheat")

    blocks = _all_blocks(db_path)

    assert len(blocks) == 3
    assert blocks[2]["previous_hash"] == blocks[1]["block_hash"]
    _assert_chain_is_valid(blocks)


def test_repeated_submission_creates_no_duplicate_event_or_block(client, db_path):
    _as_farmer(client)
    first = _register(client)
    again = _register(client)

    assert first.status_code == 201
    assert again.status_code == 200
    assert again.get_json()["batch"]["batch_id"] == first.get_json()["batch"]["batch_id"]
    assert _count(db_path, "SELECT COUNT(*) FROM product_batches") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == 2  # genesis + one registration


def test_failed_ledger_write_leaves_no_partial_batch_event_or_block(client, db_path, monkeypatch):
    _as_farmer(client)
    before = (
        _count(db_path, "SELECT COUNT(*) FROM product_batches"),
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )

    def failing_append(*args, **kwargs):
        raise sqlite3.OperationalError("simulated ledger failure")

    monkeypatch.setattr(batch_service, "append_block", failing_append)
    response = _register(client, key="aaaaaaaa-8888-4888-8888-000000000001")

    assert response.status_code == 500
    after = (
        _count(db_path, "SELECT COUNT(*) FROM product_batches"),
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )
    assert after == before


def test_after_a_failed_attempt_the_same_key_can_register_successfully(client, db_path, monkeypatch):
    _as_farmer(client)
    original = batch_service.append_block

    def failing_once(*args, **kwargs):
        monkeypatch.setattr(batch_service, "append_block", original)
        raise sqlite3.OperationalError("simulated ledger failure")

    monkeypatch.setattr(batch_service, "append_block", failing_once)
    assert _register(client, key="bbbbbbbb-9999-4999-8999-000000000001").status_code == 500

    response = _register(client, key="bbbbbbbb-9999-4999-8999-000000000001")

    assert response.status_code == 201
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NOT NULL") == 1


# --- Backfill of existing registration events -------------------------------------------


def _pre_ledger_state(db_path):
    """Batches and events as they were before this story: no ledger blocks, one event out of order."""
    init_db(db_path)
    conn = _connect(db_path)
    conn.execute("DELETE FROM ledger_blocks")
    farmer_id = conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]
    conn.execute(
        "INSERT INTO users (id, display_name, username, role) VALUES (40, 'Existing Farmer', 'farmer.existing', 'farmer')"
    )
    for batch_row_id, code, name in [(1, "PB-OLD0-0001", "Rice"), (2, "PB-OLD0-0002", "Wheat"), (3, "PB-OLD0-0003", "Maize")]:
        conn.execute(
            "INSERT INTO product_batches (id, batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
            "VALUES (?, ?, ?, 10, 'kg', 'Farm', '2026-02-01', ?)",
            (batch_row_id, code, name, farmer_id),
        )
    # Event 1 happened later than event 2, so chronological order is 2, 1, 3.
    events = [
        (1, 1, "PRODUCT_REGISTERED", "2026-03-01T10:00:00.000Z"),
        (2, 2, "PRODUCT_REGISTERED", "2026-02-01T09:00:00.000Z"),
        (3, 3, "PRODUCT_REGISTERED", "2026-02-15T12:00:00.000Z"),
        (4, 1, "SHIPMENT_UPDATED", "2026-03-02T10:00:00.000Z"),  # not a US-04 event: no block
    ]
    for event_id, batch_row_id, event_type, timestamp in events:
        conn.execute(
            "INSERT INTO supply_chain_events (id, batch_id, event_type, actor_role, status, note, event_timestamp) "
            "VALUES (?, ?, ?, 'farmer', 'Registered', 'before US-05', ?)",
            (event_id, batch_row_id, event_type, timestamp),
        )
    conn.commit()
    conn.close()


def test_backfill_creates_one_block_per_registration_event_in_chronological_order(db_path):
    _pre_ledger_state(db_path)

    init_db(db_path)

    blocks = _all_blocks(db_path)
    assert [block["block_index"] for block in blocks] == [0, 1, 2, 3]
    assert [block["event_id"] for block in blocks] == [None, 2, 3, 1]
    assert [block["timestamp"] for block in blocks][1:] == [
        "2026-02-01T09:00:00.000Z",
        "2026-02-15T12:00:00.000Z",
        "2026-03-01T10:00:00.000Z",
    ]
    _assert_chain_is_valid(blocks)


def test_backfill_records_no_block_for_other_event_types(db_path):
    _pre_ledger_state(db_path)

    init_db(db_path)

    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id = 4") == 0


def test_backfilled_block_data_matches_the_stored_event_and_batch(db_path):
    _pre_ledger_state(db_path)

    init_db(db_path)

    conn = _connect(db_path)
    block = conn.execute("SELECT * FROM ledger_blocks WHERE event_id = 2").fetchone()
    data = json.loads(block["event_payload"])
    conn.close()
    assert data["batch_id"] == "PB-OLD0-0002"
    assert data["product_name"] == "Wheat"
    assert data["event_id"] == 2


def test_backfill_is_repeatable_without_duplicates(db_path):
    _pre_ledger_state(db_path)
    init_db(db_path)
    first = _all_blocks(db_path)

    init_db(db_path)
    init_db(db_path)

    assert _all_blocks(db_path) == first


def test_backfill_keeps_users_batches_and_events_intact(db_path):
    _pre_ledger_state(db_path)
    conn = _connect(db_path)
    users_before = [tuple(r) for r in conn.execute("SELECT id, username FROM users ORDER BY id").fetchall()]
    batches_before = [tuple(r) for r in conn.execute("SELECT id, batch_code, product_name FROM product_batches ORDER BY id").fetchall()]
    events_before = [tuple(r) for r in conn.execute("SELECT id, batch_id, event_type, note FROM supply_chain_events ORDER BY id").fetchall()]
    conn.close()

    init_db(db_path)

    conn = _connect(db_path)
    assert [tuple(r) for r in conn.execute("SELECT id, username FROM users ORDER BY id").fetchall()] == users_before
    assert [tuple(r) for r in conn.execute("SELECT id, batch_code, product_name FROM product_batches ORDER BY id").fetchall()] == batches_before
    assert [tuple(r) for r in conn.execute("SELECT id, batch_id, event_type, note FROM supply_chain_events ORDER BY id").fetchall()] == events_before
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


# --- Schema upgrade from the BPT-004 ledger table -----------------------------------------


def test_bpt004_ledger_table_gains_event_reference_and_keeps_its_blocks(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    genesis_before = conn.execute("SELECT * FROM ledger_blocks WHERE block_index = 0").fetchone()
    # Rebuild ledger_blocks in its BPT-004 shape (no event_id), keeping the genesis block.
    conn.execute("DROP TABLE ledger_blocks")
    conn.execute(
        """
        CREATE TABLE ledger_blocks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            block_index   INTEGER NOT NULL UNIQUE CHECK (block_index >= 0),
            timestamp     TEXT    NOT NULL,
            event_payload TEXT    NOT NULL,
            previous_hash TEXT    NOT NULL,
            block_hash    TEXT    NOT NULL UNIQUE CHECK (length(block_hash) > 0)
        )
        """
    )
    conn.execute(
        "INSERT INTO ledger_blocks (block_index, timestamp, event_payload, previous_hash, block_hash) VALUES (?, ?, ?, ?, ?)",
        tuple(genesis_before)[1:6],
    )
    conn.commit()
    conn.close()

    init_db(db_path)

    conn = _connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(ledger_blocks)")}
    index_names = {row[1] for row in conn.execute("PRAGMA index_list(ledger_blocks)")}
    genesis_after = conn.execute("SELECT * FROM ledger_blocks WHERE block_index = 0").fetchone()
    conn.close()
    assert "event_id" in columns
    assert "idx_ledger_blocks_event_id" in index_names
    assert genesis_after["block_hash"] == GENESIS_HASH
    assert genesis_after["event_id"] is None


def test_event_reference_is_unique_in_the_database(db_path):
    _pre_ledger_state(db_path)
    init_db(db_path)
    conn = _connect(db_path)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO ledger_blocks (block_index, timestamp, event_payload, previous_hash, block_hash, event_id) "
            "VALUES (500, '2026-04-01T00:00:00.000Z', '{}', 'x', 'dup-hash-500', 2)"
        )
    conn.close()


# --- Endpoints ------------------------------------------------------------------------------


def test_ledger_requires_an_active_session(client):
    assert client.get("/api/ledger").status_code == 401
    assert client.get("/api/ledger/latest").status_code == 401
    assert client.get("/api/ledger/blocks/0").status_code == 401


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_every_demonstration_role_can_read_the_ledger(client, role):
    client.post("/api/session", json={"role": role})

    response = client.get("/api/ledger")

    assert response.status_code == 200
    assert response.get_json()["count"] == 1


def test_ledger_endpoint_returns_blocks_in_order_with_latest(client):
    _as_farmer(client)
    _register(client)

    body = client.get("/api/ledger").get_json()

    assert body["count"] == 2
    assert [block["index"] for block in body["blocks"]] == [0, 1]
    assert body["latest"]["index"] == 1
    assert body["blocks"][1]["event_type"] == "PRODUCT_REGISTERED"
    assert body["blocks"][1]["batch_id"].startswith("PB-")
    assert body["blocks"][1]["previous_hash"] == body["blocks"][0]["block_hash"]


def test_block_detail_and_latest_endpoints(client):
    _as_farmer(client)
    _register(client)

    latest = client.get("/api/ledger/latest").get_json()["block"]
    detail = client.get("/api/ledger/blocks/1").get_json()["block"]
    genesis = client.get("/api/ledger/blocks/0").get_json()["block"]

    assert latest == detail
    assert genesis["block_hash"] == GENESIS_HASH
    assert genesis["event_type"] == "GENESIS"


def test_missing_and_invalid_block_requests_are_not_found(client):
    _as_farmer(client)

    missing = client.get("/api/ledger/blocks/999")
    not_a_number = client.get("/api/ledger/blocks/abc")

    assert missing.status_code == 404
    assert missing.get_json()["error"]["message"] == "Block not found."
    assert not_a_number.status_code == 404


def test_ledger_responses_contain_no_personal_or_session_data(client):
    _as_farmer(client)
    _register(client)

    body = client.get("/api/ledger").get_json()

    text = json.dumps(body)
    assert "demo.farmer" not in text
    assert "Demo Farmer" not in text
    assert "demo_access" not in text
    assert set(body["blocks"][1].keys()) == {
        "index", "timestamp", "event_type", "event_id", "batch_id", "event_data", "previous_hash", "block_hash"
    }


def test_ledger_is_read_only_through_the_api(client):
    _as_farmer(client)

    assert client.post("/api/ledger", json={}).status_code == 405
    assert client.delete("/api/ledger/blocks/0").status_code == 405
