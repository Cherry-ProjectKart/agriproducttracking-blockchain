"""Distributor shipment updates (US-05): API, validation, roles, atomicity, idempotency and ledger."""

import hashlib
import json
import sqlite3

import pytest

from app.db import init_db
from app.services import shipment_service

FARMER_KEY = "aaaa1111-bbbb-4ccc-8ddd-000000000001"
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


def _count(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _role(client, role):
    assert client.post("/api/session", json={"role": role}).status_code == 201


def _register_batch(client, key=FARMER_KEY):
    _role(client, "farmer")
    response = client.post("/api/batches", json=VALID_BATCH, headers={"Idempotency-Key": key})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _as_distributor(client):
    _role(client, "distributor")


def _ship(client, batch_id, status="Shipped", note=None, key="bbbb2222-cccc-4ddd-8eee-000000000001"):
    body = {"batch_id": batch_id, "status": status}
    if note is not None:
        body["note"] = note
    return client.post("/api/shipments", json=body, headers={"Idempotency-Key": key})


def _batch_status(db_path, batch_id):
    conn = _connect(db_path)
    try:
        return conn.execute(
            "SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,)
        ).fetchone()[0]
    finally:
        conn.close()


def _all_blocks(db_path):
    conn = _connect(db_path)
    rows = [dict(r) for r in conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index")]
    conn.close()
    return rows


# --- Batch list for the distributor ----------------------------------------------------


def test_distributor_retrieves_registered_batches(client):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = client.get("/api/shipments/batches")

    assert response.status_code == 200
    batches = response.get_json()["batches"]
    match = next(batch for batch in batches if batch["batch_id"] == batch_id)
    assert match["product_name"] == "Basmati Rice"
    assert match["origin"] == "Green Valley Farm"
    assert match["quantity"] == 250.0
    assert match["unit"] == "kg"
    assert match["current_status"] == "Registered"


def test_distributor_batch_list_contains_no_farmer_identity(client):
    _register_batch(client)
    _as_distributor(client)

    text = client.get("/api/shipments/batches").get_data(as_text=True)

    assert "demo.farmer" not in text
    assert "created_by" not in text
    assert "Demo Farmer" not in text


# --- Recording shipment updates ----------------------------------------------------------


def test_distributor_selects_a_batch_and_sets_shipped(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = _ship(client, batch_id, status="Shipped", note="Left the farm at 06:00")

    assert response.status_code == 201
    body = response.get_json()
    assert body["batch"] == {"batch_id": batch_id, "current_status": "Shipped"}
    assert body["event"]["status"] == "Shipped"
    assert body["event"]["event_type"] == "SHIPMENT_UPDATED"
    assert body["event"]["actor_role"] == "distributor"
    assert _batch_status(db_path, batch_id) == "Shipped"


@pytest.mark.parametrize("status", ["Shipped", "In Transit", "Delivered to Retailer"])
def test_each_supported_status_is_recorded(client, db_path, status):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = _ship(client, batch_id, status=status)

    assert response.status_code == 201
    assert _batch_status(db_path, batch_id) == status
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE status = ? AND event_type = 'SHIPMENT_UPDATED'", (status,)) == 1


def test_delivered_to_retailer_does_not_mark_the_batch_as_received(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    _ship(client, batch_id, status="Delivered to Retailer")

    assert _batch_status(db_path, batch_id) == "Delivered to Retailer"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE status = 'Received by Retailer'") == 0


def test_optional_note_is_saved_trimmed(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    _ship(client, batch_id, note="  Refrigerated truck  ")

    assert _count(db_path, "SELECT note FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == "Refrigerated truck"


def test_missing_note_is_stored_as_null(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    _ship(client, batch_id)

    assert _count(db_path, "SELECT note IS NULL FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1


def test_whitespace_only_note_is_treated_as_empty(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = _ship(client, batch_id, note="   ")

    assert response.status_code == 201
    assert _count(db_path, "SELECT note IS NULL FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1


# --- Validation ------------------------------------------------------------------------


def test_missing_batch_is_rejected(client, db_path):
    _register_batch(client)
    _as_distributor(client)

    response = _ship(client, "PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 0


@pytest.mark.parametrize("batch_id", ["not-a-batch", "PB-7K2M9QXD", "", None])
def test_malformed_or_absent_batch_id_is_a_bad_request(client, batch_id):
    _as_distributor(client)

    body = {"status": "Shipped"}
    if batch_id is not None:
        body["batch_id"] = batch_id
    response = client.post("/api/shipments", json=body, headers={"Idempotency-Key": "cccc3333-dddd-4eee-8fff-000000000001"})

    assert response.status_code == 400
    assert "batch_id" in response.get_json()["error"]["details"]


@pytest.mark.parametrize(
    "status",
    ["Received by Retailer", "Registered", "shipped", "Delivered", "In transit", "", None, 5, ["Shipped"]],
)
def test_invalid_status_is_rejected(client, db_path, status):
    batch_id = _register_batch(client)
    _as_distributor(client)

    body = {"batch_id": batch_id, "status": status}
    response = client.post("/api/shipments", json=body, headers={"Idempotency-Key": "dddd4444-eeee-4fff-8000-000000000001"})

    assert response.status_code == 400
    assert "status" in response.get_json()["error"]["details"]
    assert _batch_status(db_path, batch_id) == "Registered"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 0


@pytest.mark.parametrize("note", ["x" * 301, "line one\nline two", "tab\there", "bell\x07", 12, ["note"]])
def test_invalid_note_is_rejected(client, db_path, note):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = _ship(client, batch_id, note=note, key="eeee5555-ffff-4000-8111-000000000001")

    assert response.status_code == 400
    assert "note" in response.get_json()["error"]["details"]
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 0


def test_note_of_exactly_the_limit_is_accepted(client):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = _ship(client, batch_id, note="x" * 300, key="ffff6666-0000-4111-8222-000000000001")

    assert response.status_code == 201


def test_non_object_body_is_rejected(client):
    _as_distributor(client)

    response = client.post(
        "/api/shipments", data="Shipped", content_type="text/plain", headers={"Idempotency-Key": "aaaa7777-1111-4222-8333-000000000001"}
    )

    assert response.status_code == 400


def test_missing_idempotency_key_is_rejected(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    response = client.post("/api/shipments", json={"batch_id": batch_id, "status": "Shipped"})

    assert response.status_code == 400
    assert _batch_status(db_path, batch_id) == "Registered"


# --- Roles and sessions ------------------------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "retailer"])
def test_other_roles_cannot_record_shipments(client, db_path, role):
    batch_id = _register_batch(client)
    _role(client, role)

    response = _ship(client, batch_id)

    assert response.status_code == 403
    assert _batch_status(db_path, batch_id) == "Registered"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 0


@pytest.mark.parametrize("role", ["farmer", "retailer"])
def test_other_roles_cannot_list_shipment_batches(client, role):
    _register_batch(client)
    _role(client, role)

    assert client.get("/api/shipments/batches").status_code == 403


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/shipments/batches").status_code == 401
    response = client.post("/api/shipments", json={"batch_id": "PB-AAAA-0001", "status": "Shipped"}, headers={"Idempotency-Key": "bbbb8888-2222-4333-8444-000000000001"})
    assert response.status_code == 401


def test_session_for_a_missing_distributor_is_rejected(client, db_path):
    batch_id = _register_batch(client)
    with client.session_transaction() as session:
        session["demo_access"] = {"role": "distributor", "user_id": 9999, "display_name": "Ghost"}

    response = _ship(client, batch_id)

    assert response.status_code == 401
    assert _batch_status(db_path, batch_id) == "Registered"


def test_farmer_cannot_reach_distributor_actions_by_sending_a_different_role(client):
    batch_id = _register_batch(client)

    response = client.post(
        "/api/shipments",
        json={"batch_id": batch_id, "status": "Shipped", "role": "distributor", "actor_role": "distributor"},
        headers={"Idempotency-Key": "cccc9999-3333-4444-8555-000000000001"},
    )

    assert response.status_code == 403


# --- Event, ledger and atomicity ----------------------------------------------------------


def test_successful_update_creates_exactly_one_event_and_one_block(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    _ship(client, batch_id)

    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NOT NULL") == 2  # registration + shipment


def test_shipment_block_contains_the_event_data_and_links_to_previous_block(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    body = _ship(client, batch_id, note="Cold chain").get_json()

    blocks = _all_blocks(db_path)
    shipment_block = blocks[-1]
    data = json.loads(shipment_block["event_payload"])
    assert data["event_type"] == "SHIPMENT_UPDATED"
    assert data["batch_id"] == batch_id
    assert data["status"] == "Shipped"
    assert data["note"] == "Cold chain"
    assert data["actor_role"] == "distributor"
    assert data["event_id"] == body["event"]["event_id"]
    assert shipment_block["event_id"] == body["event"]["event_id"]
    assert shipment_block["previous_hash"] == blocks[-2]["block_hash"]
    assert shipment_block["timestamp"] == body["event"]["timestamp"]


def test_shipment_block_hash_is_independently_reproducible(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)
    _ship(client, batch_id)

    for block in _all_blocks(db_path):
        assert block["block_hash"] == independent_block_hash(
            block["block_index"], block["timestamp"], block["event_payload"], block["previous_hash"]
        )


def test_failed_ledger_write_rolls_back_status_and_event(client, db_path, monkeypatch):
    batch_id = _register_batch(client)
    _as_distributor(client)
    before = (
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )

    def failing_append(*args, **kwargs):
        raise sqlite3.OperationalError("simulated ledger failure")

    monkeypatch.setattr(shipment_service, "append_block", failing_append)
    response = _ship(client, batch_id, status="In Transit", key="dddd0000-4444-4555-8666-000000000001")

    assert response.status_code == 500
    assert _batch_status(db_path, batch_id) == "Registered"
    after = (
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )
    assert after == before


def test_after_a_failed_attempt_the_same_key_succeeds(client, db_path, monkeypatch):
    batch_id = _register_batch(client)
    _as_distributor(client)
    original = shipment_service.append_block

    def failing_once(*args, **kwargs):
        monkeypatch.setattr(shipment_service, "append_block", original)
        raise sqlite3.OperationalError("simulated ledger failure")

    key = "eeee1111-5555-4666-8777-000000000001"
    monkeypatch.setattr(shipment_service, "append_block", failing_once)
    assert _ship(client, batch_id, key=key).status_code == 500

    response = _ship(client, batch_id, key=key)

    assert response.status_code == 201
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1


# --- Repeated requests --------------------------------------------------------------------


def test_repeated_request_creates_no_duplicate_event_or_block(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)
    key = "ffff2222-6666-4777-8888-000000000001"

    first = _ship(client, batch_id, note="Once", key=key)
    again = _ship(client, batch_id, note="Once", key=key)

    assert first.status_code == 201
    assert again.status_code == 200
    assert again.get_json()["event"]["event_id"] == first.get_json()["event"]["event_id"]
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == 3  # genesis + registration + one shipment


def test_same_key_with_different_details_is_a_conflict(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)
    key = "aaaa3333-7777-4888-8999-000000000001"
    _ship(client, batch_id, status="Shipped", key=key)

    response = _ship(client, batch_id, status="In Transit", key=key)

    assert response.status_code == 409
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 1
    assert _batch_status(db_path, batch_id) == "Shipped"


def test_distinct_keys_record_distinct_movements(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)

    _ship(client, batch_id, status="Shipped", key="bbbb4444-8888-4999-8aaa-000000000001")
    _ship(client, batch_id, status="In Transit", key="bbbb4444-8888-4999-8aaa-000000000002")

    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'") == 2
    assert _batch_status(db_path, batch_id) == "In Transit"


# --- Previous events, history and compatibility -------------------------------------------


def test_previous_shipment_event_remains_intact_after_a_later_update(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)
    first = _ship(client, batch_id, status="Shipped", note="Leaves farm", key="cccc5555-9999-4aaa-8bbb-000000000001").get_json()
    snapshot = _count(db_path, "SELECT COUNT(*) FROM ledger_blocks")

    _ship(client, batch_id, status="In Transit", note="On the road", key="cccc5555-9999-4aaa-8bbb-000000000002")

    conn = _connect(db_path)
    kept = conn.execute("SELECT status, note FROM supply_chain_events WHERE id = ?", (first["event"]["event_id"],)).fetchone()
    conn.close()
    assert (kept["status"], kept["note"]) == ("Shipped", "Leaves farm")
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == snapshot + 1


def test_registration_and_ledger_still_work_after_shipments(client, db_path):
    batch_id = _register_batch(client)
    _as_distributor(client)
    _ship(client, batch_id)
    _role(client, "farmer")

    second = client.post("/api/batches", json=dict(VALID_BATCH, product_name="Wheat"), headers={"Idempotency-Key": "dddd6666-aaaa-4bbb-8ccc-000000000001"})
    ledger = client.get("/api/ledger").get_json()

    assert second.status_code == 201
    assert ledger["count"] == 4  # genesis, registration, shipment, second registration
    assert [block["index"] for block in ledger["blocks"]] == [0, 1, 2, 3]
    assert client.get("/api/health").status_code == 200


def test_farmer_batch_view_shows_the_updated_status(client):
    batch_id = _register_batch(client)
    _as_distributor(client)
    _ship(client, batch_id, status="In Transit")
    _role(client, "farmer")

    listed = client.get("/api/batches").get_json()["batches"]

    assert next(b for b in listed if b["batch_id"] == batch_id)["current_status"] == "In Transit"


# --- Migration of an existing events table ------------------------------------------------


def test_existing_events_table_is_upgraded_and_keeps_its_events(db_path):
    init_db(db_path)
    conn = _connect(db_path)
    farmer_id = conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]
    conn.execute(
        "INSERT INTO product_batches (batch_code, product_name, quantity, unit, origin, harvest_date, created_by) "
        "VALUES ('PB-KEEP-0001', 'Rice', 2, 'kg', 'Farm', '2026-01-01', ?)",
        (farmer_id,),
    )
    conn.execute(
        "INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status, note) "
        "VALUES (1, 'PRODUCT_REGISTERED', 'farmer', 'Registered', 'before BPT-006')"
    )
    conn.commit()
    # Rebuild the events table in its BPT-005 shape (no client_request_id), keeping its rows.
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("DROP INDEX IF EXISTS idx_supply_chain_events_request_key")
    conn.execute("ALTER TABLE supply_chain_events DROP COLUMN client_request_id")
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")
    conn.close()

    init_db(db_path)

    conn = _connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(supply_chain_events)")}
    indexes = {row[1] for row in conn.execute("PRAGMA index_list(supply_chain_events)")}
    kept = conn.execute("SELECT note FROM supply_chain_events WHERE note = 'before BPT-006'").fetchone()
    conn.close()
    assert "client_request_id" in columns
    assert "idx_supply_chain_events_request_key" in indexes
    assert kept is not None
