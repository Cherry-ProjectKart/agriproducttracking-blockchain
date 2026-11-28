"""Shipment movement lifecycle (BPT-107): transitions, legacy statuses, duplicates and ledger agreement."""

import sqlite3
import uuid

import pytest

from app.services.ledger_verification import verify_ledger

from tests.auth_helpers import sign_in

VALID_BATCH = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}
CHAIN = ("Shipped", "In Transit", "Delivered to Retailer")


def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _scalar(db_path, sql, params=()):
    conn = _connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _register(client):
    assert sign_in(client, "farmer").status_code == 200
    response = client.post("/api/batches", json=VALID_BATCH, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _ship(client, batch_id, status, note=None):
    body = {"batch_id": batch_id, "status": status}
    if note is not None:
        body["note"] = note
    assert sign_in(client, "distributor").status_code == 200
    return client.post("/api/shipments", json=body, headers={"Idempotency-Key": str(uuid.uuid4())})


def _status(db_path, batch_id):
    return _scalar(db_path, "SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,))


def _movement_count(db_path):
    return _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED'")


def _block_count(db_path):
    return _scalar(db_path, "SELECT COUNT(*) FROM ledger_blocks")


def _set_status(db_path, batch_id, status):
    """Simulate a row written before the lifecycle existed. Changes the status only, no event."""
    conn = _connect(db_path)
    conn.execute("UPDATE product_batches SET current_status = ? WHERE batch_code = ?", (status, batch_id))
    conn.commit()
    conn.close()


# --- Eligibility ----------------------------------------------------------------------------


def test_eligible_batches_list_their_single_next_status(client):
    batch_id = _register(client)
    assert sign_in(client, "distributor").status_code == 200

    listed = {b["batch_id"]: b for b in client.get("/api/shipments/batches").get_json()["batches"]}

    assert listed[batch_id]["current_status"] == "Registered"
    assert listed[batch_id]["next_statuses"] == ["Shipped"]


def test_batch_at_each_step_lists_the_following_step(client, db_path):
    batch_id = _register(client)
    expected = {"Shipped": ["In Transit"], "In Transit": ["Delivered to Retailer"], "Delivered to Retailer": []}
    for status in CHAIN:
        assert _ship(client, batch_id, status).status_code == 201
        listed = {b["batch_id"]: b for b in client.get("/api/shipments/batches").get_json()["batches"]}
        assert listed[batch_id]["next_statuses"] == expected[status]


# --- Valid and invalid transitions ----------------------------------------------------------


def test_full_forward_chain_succeeds_in_order(client, db_path):
    batch_id = _register(client)

    for status in CHAIN:
        response = _ship(client, batch_id, status)
        assert response.status_code == 201
        assert response.get_json()["batch"]["current_status"] == status

    assert _status(db_path, batch_id) == "Delivered to Retailer"
    assert _movement_count(db_path) == 3


@pytest.mark.parametrize(
    "steps, attempt",
    [
        ([], "In Transit"),  # skip Shipped
        ([], "Delivered to Retailer"),  # skip two steps
        (["Shipped"], "Shipped"),  # repeat the same status
        (["Shipped"], "Delivered to Retailer"),  # skip In Transit
        (["Shipped", "In Transit"], "Shipped"),  # backwards
        (["Shipped", "In Transit"], "In Transit"),  # repeat
        (["Shipped", "In Transit", "Delivered to Retailer"], "In Transit"),  # backwards after delivery
        (["Shipped", "In Transit", "Delivered to Retailer"], "Shipped"),
    ],
)
def test_invalid_transition_is_rejected_and_nothing_is_written(client, db_path, steps, attempt):
    batch_id = _register(client)
    for step in steps:
        assert _ship(client, batch_id, step).status_code == 201
    status_before = _status(db_path, batch_id)
    events_before, blocks_before = _movement_count(db_path), _block_count(db_path)

    response = _ship(client, batch_id, attempt)

    assert response.status_code == 409
    assert batch_id in response.get_json()["error"]["message"]
    assert _status(db_path, batch_id) == status_before
    assert _movement_count(db_path) == events_before
    assert _block_count(db_path) == blocks_before


def test_nothing_can_be_recorded_after_delivery_to_the_retailer(client, db_path):
    batch_id = _register(client)
    for status in CHAIN:
        _ship(client, batch_id, status)

    response = _ship(client, batch_id, "Shipped")

    assert response.status_code == 409
    assert "no further shipment update" in response.get_json()["error"]["message"]


# --- Legacy and unexpected statuses ---------------------------------------------------------


def test_legacy_created_status_can_still_be_shipped(client, db_path):
    batch_id = _register(client)
    _set_status(db_path, batch_id, "CREATED")

    assert _ship(client, batch_id, "Shipped").status_code == 201
    assert _status(db_path, batch_id) == "Shipped"


def test_unknown_legacy_status_is_readable_but_cannot_be_moved(client, db_path):
    batch_id = _register(client)
    _set_status(db_path, batch_id, "Legacy Hold")
    assert sign_in(client, "distributor").status_code == 200

    listed = {b["batch_id"]: b for b in client.get("/api/shipments/batches").get_json()["batches"]}
    assert listed[batch_id]["current_status"] == "Legacy Hold"
    assert listed[batch_id]["next_statuses"] == []

    response = _ship(client, batch_id, "Shipped")
    assert response.status_code == 409
    assert _status(db_path, batch_id) == "Legacy Hold"

    assert client.get(f"/api/history/{batch_id}").status_code == 200
    assert client.get(f"/api/tracking/{batch_id}").get_json()["batch"]["current_status"] == "Legacy Hold"


# --- Duplicate requests ---------------------------------------------------------------------


def test_same_key_resent_returns_the_original_movement(client, db_path):
    batch_id = _register(client)
    key = str(uuid.uuid4())
    assert sign_in(client, "distributor").status_code == 200
    body = {"batch_id": batch_id, "status": "Shipped", "note": "Once"}

    first = client.post("/api/shipments", json=body, headers={"Idempotency-Key": key})
    again = client.post("/api/shipments", json=body, headers={"Idempotency-Key": key})

    assert first.status_code == 201
    assert again.status_code == 200
    assert again.get_json()["event"]["event_id"] == first.get_json()["event"]["event_id"]
    assert _movement_count(db_path) == 1


def test_a_new_key_for_a_repeated_status_is_refused_not_duplicated(client, db_path):
    batch_id = _register(client)
    assert _ship(client, batch_id, "Shipped").status_code == 201

    response = _ship(client, batch_id, "Shipped")

    assert response.status_code == 409
    assert _movement_count(db_path) == 1


# --- Ledger agreement and historical blocks -------------------------------------------------


def test_history_and_ledger_agree_after_each_movement(client, db_path):
    batch_id = _register(client)
    for status in CHAIN:
        _ship(client, batch_id, status)

    history = client.get(f"/api/history/{batch_id}").get_json()["events"]
    shipment_blocks = _scalar(
        db_path,
        "SELECT COUNT(*) FROM ledger_blocks b JOIN supply_chain_events e ON e.id = b.event_id "
        "WHERE e.batch_id = (SELECT id FROM product_batches WHERE batch_code = ?)",
        (batch_id,),
    )
    assert [e["status"] for e in history if e["event_type"] == "SHIPMENT_UPDATED"] == list(CHAIN)
    assert shipment_blocks == len(CHAIN) + 1  # the registration block is also linked to the batch
    assert [e["ledger_block_index"] for e in history] == sorted(e["ledger_block_index"] for e in history)


def test_earlier_blocks_are_unchanged_by_a_new_movement(client, db_path):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped")
    before = _all_blocks(db_path)

    _ship(client, batch_id, "In Transit")

    after = _all_blocks(db_path)
    assert after[: len(before)] == before
    assert len(after) == len(before) + 1


def test_full_chain_verifies_after_all_movements(client, db_path):
    batch_id = _register(client)
    for status in CHAIN:
        _ship(client, batch_id, status)

    conn = _connect(db_path)
    try:
        result = verify_ledger(conn)
    finally:
        conn.close()

    assert result["result"] == "valid"
    assert result["failures"] == []


def _all_blocks(db_path):
    conn = _connect(db_path)
    rows = [dict(r) for r in conn.execute("SELECT * FROM ledger_blocks ORDER BY block_index")]
    conn.close()
    return rows


# --- Public tracking ------------------------------------------------------------------------


def test_public_tracking_shows_each_movement_without_a_session(client):
    batch_id = _register(client)
    _ship(client, batch_id, "Shipped", note="Left the farm")
    client.delete("/api/session")

    body = client.get(f"/api/tracking/{batch_id}").get_json()

    assert body["batch"]["current_status"] == "Shipped"
    assert [e["event_type"] for e in body["events"]] == ["PRODUCT_REGISTERED", "SHIPMENT_UPDATED"]
    assert body["events"][1]["note"] == "Left the farm"
    assert "user_id" not in str(body) and "created_by" not in str(body)


def test_public_tracking_cannot_change_a_batch(client):
    batch_id = _register(client)
    client.delete("/api/session")

    assert client.post(f"/api/tracking/{batch_id}", json={"status": "Shipped"}).status_code == 405
