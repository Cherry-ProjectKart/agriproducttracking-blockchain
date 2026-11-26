"""Retailer receipt confirmation (US-06): eligibility, atomicity, idempotency, roles and ledger."""

import hashlib
import json
import sqlite3

import pytest

from app.db import init_db
from app.services import receipt_service

FARMER_KEY = "aaaa1111-bbbb-4ccc-8ddd-000000000101"
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


def _status(db_path, batch_id):
    conn = _connect(db_path)
    try:
        return conn.execute("SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,)).fetchone()[0]
    finally:
        conn.close()


def _role(client, role):
    assert client.post("/api/session", json={"role": role}).status_code == 201


def _register(client, key=FARMER_KEY, **changes):
    _role(client, "farmer")
    response = client.post("/api/batches", json=dict(VALID_BATCH, **changes), headers={"Idempotency-Key": key})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _ship(client, batch_id, status, key):
    _role(client, "distributor")
    response = client.post(
        "/api/shipments", json={"batch_id": batch_id, "status": status}, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 201
    return response


def _delivered_batch(client, key_prefix="cccc2222-dddd-4eee-8fff-"):
    batch_id = _register(client)
    _ship(client, batch_id, "Delivered to Retailer", key_prefix + "000000000001")
    return batch_id


def _confirm(client, batch_id, key="dddd3333-eeee-4fff-8000-000000000001", body=None):
    payload = body if body is not None else {"batch_id": batch_id}
    return client.post("/api/receipts", json=payload, headers={"Idempotency-Key": key})


def _all_blocks(db_path):
    conn = _connect(db_path)
    rows = [dict(r) for r in conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index")]
    conn.close()
    return rows


# --- Awaiting-receipt list -------------------------------------------------------------


def test_retailer_retrieves_batches_awaiting_receipt(client):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")

    response = client.get("/api/receipts/awaiting")

    assert response.status_code == 200
    batches = response.get_json()["batches"]
    match = next(batch for batch in batches if batch["batch_id"] == batch_id)
    assert match["product_name"] == "Basmati Rice"
    assert match["origin"] == "Green Valley Farm"
    assert match["quantity"] == 250.0
    assert match["unit"] == "kg"
    assert match["current_status"] == "Delivered to Retailer"


def test_only_delivered_batches_are_eligible(client):
    delivered = _delivered_batch(client)
    registered = _register(client, key="eeee4444-ffff-4000-8111-000000000001", product_name="Wheat")
    shipped = _register(client, key="eeee4444-ffff-4000-8111-000000000002", product_name="Maize")
    _ship(client, shipped, "Shipped", "eeee4444-ffff-4000-8111-000000000003")
    in_transit = _register(client, key="eeee4444-ffff-4000-8111-000000000004", product_name="Beans")
    _ship(client, in_transit, "In Transit", "eeee4444-ffff-4000-8111-000000000005")
    _role(client, "retailer")

    ids = [batch["batch_id"] for batch in client.get("/api/receipts/awaiting").get_json()["batches"]]

    assert delivered in ids
    assert registered not in ids
    assert shipped not in ids
    assert in_transit not in ids


def test_awaiting_list_contains_no_farmer_identity(client):
    _delivered_batch(client)
    _role(client, "retailer")

    text = client.get("/api/receipts/awaiting").get_data(as_text=True)

    assert "demo.farmer" not in text
    assert "created_by" not in text
    assert "Demo Farmer" not in text


def test_awaiting_list_is_empty_when_nothing_is_delivered(client):
    _register(client)
    _role(client, "retailer")

    assert client.get("/api/receipts/awaiting").get_json() == {"batches": []}


# --- Successful confirmation -----------------------------------------------------------


def test_retailer_confirms_receipt_and_status_becomes_received(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")

    response = _confirm(client, batch_id)

    assert response.status_code == 201
    body = response.get_json()
    assert body["batch"] == {"batch_id": batch_id, "current_status": "Received by Retailer"}
    assert _status(db_path, batch_id) == "Received by Retailer"


def test_receipt_event_has_the_retailer_as_actor_and_correct_data(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")

    body = _confirm(client, batch_id).get_json()

    event = body["event"]
    assert event["event_type"] == "RECEIPT_CONFIRMED"
    assert event["actor_role"] == "retailer"
    assert event["status"] == "Received by Retailer"
    assert event["batch_id"] == batch_id
    conn = _connect(db_path)
    row = conn.execute("SELECT * FROM supply_chain_events WHERE id = ?", (event["event_id"],)).fetchone()
    conn.close()
    assert row["event_type"] == "RECEIPT_CONFIRMED"
    assert row["actor_role"] == "retailer"
    assert row["event_timestamp"] == event["timestamp"]
    assert row["note"] is None


def test_exactly_one_ledger_block_is_appended_for_the_receipt(client, db_path):
    batch_id = _delivered_batch(client)
    before = _count(db_path, "SELECT COUNT(*) FROM ledger_blocks")
    _role(client, "retailer")

    body = _confirm(client, batch_id).get_json()

    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == before + 1
    block = _all_blocks(db_path)[-1]
    assert block["event_id"] == body["event"]["event_id"]
    data = json.loads(block["event_payload"])
    assert data["event_type"] == "RECEIPT_CONFIRMED"
    assert data["actor_role"] == "retailer"
    assert data["batch_id"] == batch_id
    assert data["status"] == "Received by Retailer"


def test_receipt_block_links_to_previous_block_and_hash_is_reproducible(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id)

    blocks = _all_blocks(db_path)
    assert [block["block_index"] for block in blocks] == list(range(len(blocks)))
    assert blocks[0]["previous_hash"] == "0" * 64
    for position in range(1, len(blocks)):
        assert blocks[position]["previous_hash"] == blocks[position - 1]["block_hash"]
    for block in blocks:
        assert block["block_hash"] == independent_block_hash(
            block["block_index"], block["timestamp"], block["event_payload"], block["previous_hash"]
        )


def test_retailer_cannot_choose_the_actor_by_sending_a_role_in_the_body(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")

    body = _confirm(client, batch_id, body={"batch_id": batch_id, "actor_role": "farmer", "role": "distributor"}).get_json()

    assert body["event"]["actor_role"] == "retailer"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED' AND actor_role = 'farmer'") == 0


def test_received_batch_leaves_the_awaiting_list(client):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id)

    ids = [batch["batch_id"] for batch in client.get("/api/receipts/awaiting").get_json()["batches"]]

    assert batch_id not in ids


def test_distributor_status_and_receipt_status_stay_distinct(client, db_path):
    batch_id = _delivered_batch(client)

    assert _status(db_path, batch_id) == "Delivered to Retailer"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE status = 'Delivered to Retailer'") == 1


# --- Roles, sessions and invalid input --------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "distributor"])
def test_farmer_and_distributor_cannot_access_receipt_operations(client, db_path, role):
    batch_id = _delivered_batch(client)
    _role(client, role)

    assert client.get("/api/receipts/awaiting").status_code == 403
    response = _confirm(client, batch_id, key="ffff5555-0000-4111-8222-000000000001")
    assert response.status_code == 403
    assert _status(db_path, batch_id) == "Delivered to Retailer"


def test_unauthenticated_requests_are_rejected(client):
    assert client.get("/api/receipts/awaiting").status_code == 401
    response = client.post("/api/receipts", json={"batch_id": "PB-AAAA-0001"}, headers={"Idempotency-Key": "aaaa6666-1111-4222-8333-000000000001"})
    assert response.status_code == 401


def test_stale_retailer_session_is_rejected(client, db_path):
    batch_id = _delivered_batch(client)
    with client.session_transaction() as session:
        session["demo_access"] = {"role": "retailer", "user_id": 9999, "display_name": "Ghost"}

    assert _confirm(client, batch_id).status_code == 401
    assert _status(db_path, batch_id) == "Delivered to Retailer"


def test_unknown_batch_returns_not_found(client, db_path):
    _role(client, "retailer")

    response = _confirm(client, "PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'") == 0


@pytest.mark.parametrize("batch_id", ["not-a-batch", "PB-7K2M9QXD"])
def test_malformed_batch_id_is_a_bad_request(client, batch_id):
    _role(client, "retailer")

    response = _confirm(client, batch_id)

    assert response.status_code == 400
    assert "batch_id" in response.get_json()["error"]["details"]


def test_missing_batch_id_is_a_bad_request(client):
    _role(client, "retailer")

    response = _confirm(client, None, body={})

    assert response.status_code == 400
    assert "batch_id" in response.get_json()["error"]["details"]


def test_missing_idempotency_key_is_rejected(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")

    response = client.post("/api/receipts", json={"batch_id": batch_id})

    assert response.status_code == 400
    assert _status(db_path, batch_id) == "Delivered to Retailer"


# --- Invalid transitions -----------------------------------------------------------------


@pytest.mark.parametrize("state", ["Registered", "Shipped", "In Transit"])
def test_batches_not_delivered_to_a_retailer_cannot_be_confirmed(client, db_path, state):
    batch_id = _register(client, key="aaaa7777-2222-4333-8444-" + state.replace(" ", "")[:12].ljust(12, "0"))
    if state != "Registered":
        _ship(client, batch_id, state, "bbbb8888-3333-4444-8555-" + state.replace(" ", "")[:12].ljust(12, "0"))
    _role(client, "retailer")

    response = _confirm(client, batch_id, key="cccc9999-4444-4555-8666-" + state.replace(" ", "")[:12].ljust(12, "0"))

    assert response.status_code == 409
    assert "not awaiting receipt" in response.get_json()["error"]["message"]
    assert _status(db_path, batch_id) == state
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'") == 0


def test_a_second_confirmation_with_a_new_key_is_refused(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id, key="dddd0000-1111-4222-8333-000000000001")

    response = _confirm(client, batch_id, key="dddd0000-1111-4222-8333-000000000002")

    assert response.status_code == 409
    assert "already been received" in response.get_json()["error"]["message"]
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks") == 4  # genesis, registration, shipment, receipt


def test_a_shipment_after_receipt_is_still_a_separate_distributor_action(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id)
    _role(client, "distributor")

    response = client.post(
        "/api/shipments",
        json={"batch_id": batch_id, "status": "In Transit"},
        headers={"Idempotency-Key": "eeee1111-2222-4333-8444-000000000001"},
    )

    assert response.status_code == 201
    assert _status(db_path, batch_id) == "In Transit"


# --- Idempotency and conflicts -----------------------------------------------------------


def test_repeated_request_with_the_same_key_creates_no_duplicate(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    key = "ffff2222-3333-4444-8555-000000000001"

    first = _confirm(client, batch_id, key=key)
    again = _confirm(client, batch_id, key=key)

    assert first.status_code == 201
    assert again.status_code == 200
    assert again.get_json()["event"]["event_id"] == first.get_json()["event"]["event_id"]
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'") == 1
    assert _count(db_path, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id = ?", (first.get_json()["event"]["event_id"],)) == 1
    assert _status(db_path, batch_id) == "Received by Retailer"


def test_same_key_for_a_different_batch_is_a_conflict(client, db_path):
    first_batch = _delivered_batch(client, key_prefix="aaaa0000-1111-4222-8333-")
    second_batch = _register(client, key="aaaa0000-1111-4222-8333-000000000099", product_name="Wheat")
    _ship(client, second_batch, "Delivered to Retailer", "aaaa0000-1111-4222-8333-000000000098")
    _role(client, "retailer")
    key = "bbbb0000-1111-4222-8333-000000000001"
    _confirm(client, first_batch, key=key)

    response = _confirm(client, second_batch, key=key)

    assert response.status_code == 409
    assert _status(db_path, second_batch) == "Delivered to Retailer"


# --- Atomicity ---------------------------------------------------------------------------


def test_forced_ledger_failure_rolls_back_status_and_receipt_event(client, db_path, monkeypatch):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    before = (
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )

    def failing_append(*args, **kwargs):
        raise sqlite3.OperationalError("simulated ledger failure")

    monkeypatch.setattr(receipt_service, "append_block", failing_append)
    response = _confirm(client, batch_id, key="cccc1111-2222-4333-8444-000000000001")

    assert response.status_code == 500
    assert _status(db_path, batch_id) == "Delivered to Retailer"
    after = (
        _count(db_path, "SELECT COUNT(*) FROM supply_chain_events"),
        _count(db_path, "SELECT COUNT(*) FROM ledger_blocks"),
    )
    assert after == before


def test_after_a_forced_failure_the_same_key_confirms_successfully(client, db_path, monkeypatch):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    original = receipt_service.append_block

    def failing_once(*args, **kwargs):
        monkeypatch.setattr(receipt_service, "append_block", original)
        raise sqlite3.OperationalError("simulated ledger failure")

    key = "dddd1111-2222-4333-8444-000000000001"
    monkeypatch.setattr(receipt_service, "append_block", failing_once)
    assert _confirm(client, batch_id, key=key).status_code == 500

    response = _confirm(client, batch_id, key=key)

    assert response.status_code == 201
    assert _status(db_path, batch_id) == "Received by Retailer"
    assert _count(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'") == 1


# --- Regression: earlier stories --------------------------------------------------------


def test_full_chain_is_valid_after_the_receipt(client, db_path):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id)

    ledger = client.get("/api/ledger").get_json()

    assert ledger["count"] == 4
    assert [block["event_type"] for block in ledger["blocks"]] == [
        "GENESIS", "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]


def test_registration_shipment_and_ledger_still_work(client):
    batch_id = _delivered_batch(client)
    _role(client, "retailer")
    _confirm(client, batch_id)
    _role(client, "farmer")

    assert client.get("/api/batches").status_code == 200
    assert client.get("/api/health").status_code == 200
    assert client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["current_status"] == "Received by Retailer"
