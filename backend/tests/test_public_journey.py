"""Public product journey (BPT-110): what a consumer can read, and that reading never writes."""

import sqlite3
import uuid

import pytest

from tests.auth_helpers import sign_in

VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}
TABLES = ("users", "product_batches", "supply_chain_events", "ledger_blocks")
PRIVATE_FRAGMENTS = ("password", "username", "user_id", "created_by", "session", "display_name", "password_hash")


def _snapshot(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in TABLES}
    finally:
        conn.close()


def _register(client):
    assert sign_in(client, "farmer").status_code == 200
    response = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _ship(client, batch_id, status, note=None):
    assert sign_in(client, "distributor").status_code == 200
    body = {"batch_id": batch_id, "status": status}
    if note is not None:
        body["note"] = note
    response = client.post("/api/shipments", json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 201
    return response


def _receive(client, batch_id):
    assert sign_in(client, "retailer").status_code == 200
    response = client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 201
    return response


def _public(client, batch_id):
    client.delete("/api/session")
    return client.get(f"/api/tracking/{batch_id}")


def _keys_recursive(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _keys_recursive(item)
    elif isinstance(value, list):
        for item in value:
            yield from _keys_recursive(item)


# --- Access without authentication -----------------------------------------------------------


def test_public_tracking_succeeds_without_a_session(client):
    batch_id = _register(client)
    client.delete("/api/session")

    response = client.get(f"/api/tracking/{batch_id}")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"


# --- Product overview -------------------------------------------------------------------------


def test_overview_carries_the_registered_product_facts(client):
    batch_id = _register(client)

    batch = _public(client, batch_id).get_json()["batch"]

    assert batch["batch_id"] == batch_id
    assert batch["product_name"] == "Basmati Rice"
    assert batch["description"] == "Long-grain rice."
    assert batch["quantity"] == 250
    assert batch["unit"] == "kg"
    assert batch["origin"] == "Green Valley Farm"
    assert batch["harvest_date"] == "2026-10-15"
    assert batch["current_status"] == "Registered"


# --- Journey order and content -----------------------------------------------------------------


def test_complete_journey_is_returned_in_chronological_order(client):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped", note="Left the farm")
    _ship(client, batch_id, "In Transit")
    _ship(client, batch_id, "Delivered to Retailer")
    _receive(client, batch_id)

    body = _public(client, batch_id).get_json()

    types = [event["event_type"] for event in body["events"]]
    assert types == ["PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED"]
    timestamps = [event["timestamp"] for event in body["events"]]
    assert timestamps == sorted(timestamps)
    assert body["count"] == 5


def test_shipment_movements_appear_with_their_status_note_and_distributor_role(client):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped", note="Left the farm")
    _ship(client, batch_id, "In Transit")

    shipments = [e for e in _public(client, batch_id).get_json()["events"] if e["event_type"] == "SHIPMENT_UPDATED"]

    assert [s["status"] for s in shipments] == ["Shipped", "In Transit"]
    assert shipments[0]["note"] == "Left the farm"
    assert all(s["actor_role"] == "distributor" for s in shipments)


def test_receipt_appears_after_confirmation_with_the_retailer_and_final_status(client):
    batch_id = _register(client)
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        _ship(client, batch_id, status)
    before = _public(client, batch_id).get_json()
    assert before["batch"]["current_status"] == "Delivered to Retailer"
    assert "RECEIPT_CONFIRMED" not in [e["event_type"] for e in before["events"]]

    _receive(client, batch_id)
    after = _public(client, batch_id).get_json()

    receipt = after["events"][-1]
    assert receipt["event_type"] == "RECEIPT_CONFIRMED"
    assert receipt["actor_role"] == "retailer"
    assert receipt["status"] == "Received by Retailer"
    assert receipt["ledger_block_index"] is not None
    assert after["batch"]["current_status"] == "Received by Retailer"


def test_an_incomplete_journey_returns_only_what_was_recorded(client):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped")

    body = _public(client, batch_id).get_json()

    assert [event["event_type"] for event in body["events"]] == ["PRODUCT_REGISTERED", "SHIPMENT_UPDATED"]
    assert body["batch"]["current_status"] == "Shipped"
    assert not any(e["event_type"] == "RECEIPT_CONFIRMED" for e in body["events"])


def test_every_event_has_a_ledger_block_reference_and_a_timestamp(client):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped")

    for event in _public(client, batch_id).get_json()["events"]:
        assert event["timestamp"]
        assert isinstance(event["ledger_block_index"], int)


# --- Invalid and unknown identifiers ----------------------------------------------------------


@pytest.mark.parametrize("code", ["not-a-batch", "PB-7K2M", "pb-7k2m-9qxd"])
def test_malformed_batch_id_is_a_bad_request(client, code):
    client.delete("/api/session")

    response = client.get(f"/api/tracking/{code}")

    assert response.status_code == 400


def test_unknown_batch_id_is_not_found(client):
    client.delete("/api/session")

    response = client.get("/api/tracking/PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


# --- Privacy ----------------------------------------------------------------------------------


def test_public_response_contains_no_private_account_or_internal_fields(client):
    batch_id = _register(client)
    _deliver_chain(client, batch_id)
    _receive(client, batch_id)

    body = _public(client, batch_id).get_json()
    keys = {str(key).lower() for key in _keys_recursive(body)}

    for fragment in PRIVATE_FRAGMENTS:
        assert not any(fragment in key for key in keys), fragment
    assert "event_id" not in keys
    assert "id" not in keys
    text = str(body).lower()
    assert "farmer.demo" not in text and "demo." not in text


def _deliver_chain(client, batch_id):
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        _ship(client, batch_id, status)


# --- Read-only ---------------------------------------------------------------------------------


def test_public_reads_do_not_change_batches_events_or_ledger(client, db_path):
    batch_id = _register(client)
    _deliver_chain(client, batch_id)
    _receive(client, batch_id)
    before = _snapshot(db_path)

    for _ in range(3):
        _public(client, batch_id)
        client.get("/api/tracking/PB-ZZZZ-ZZZZ")
        client.get("/api/tracking/not-a-batch")

    assert _snapshot(db_path) == before


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_public_tracking_cannot_be_written_to(client, method):
    batch_id = _register(client)
    client.delete("/api/session")

    response = getattr(client, method)(f"/api/tracking/{batch_id}", json={"status": "Shipped"})

    assert response.status_code == 405


# --- QR compatibility ---------------------------------------------------------------------------


def test_the_registered_tracking_url_resolves_to_the_same_public_record(client):
    batch_id = _register(client)
    assert sign_in(client, "farmer").status_code == 200
    tracking_url = client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["tracking_url"]
    client.delete("/api/session")

    assert tracking_url.endswith(f"/track/{batch_id}")
    assert client.get(f"/api/tracking/{batch_id}").get_json()["batch"]["batch_id"] == batch_id
