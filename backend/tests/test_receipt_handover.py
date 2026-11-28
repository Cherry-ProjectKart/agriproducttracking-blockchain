"""Retailer receipt and batch handover (BPT-109): eligibility, persistence, idempotency, ledger and tracking."""

import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.db import connect, init_db
from app.services.batch_service import register_batch, validate_batch_input
from app.services.ledger_verification import verify_ledger
from app.services.receipt_service import ReceiptNotAllowedError, confirm_receipt
from app.services.shipment_service import record_shipment

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


# --- Helpers -----------------------------------------------------------------------------------


def _snapshot(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")] for table in TABLES}
    finally:
        conn.close()


def _scalar(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _run(db_path, sql):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


def _install_failure(db_path, name, table, operation):
    _run(db_path, f"CREATE TRIGGER {name} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'forced failure for test'); END")


def _remove_failure(db_path, name):
    _run(db_path, f"DROP TRIGGER IF EXISTS {name}")


def _register(client):
    assert sign_in(client, "farmer").status_code == 200
    response = client.post("/api/batches", json=VALID, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _ship(client, batch_id, status):
    assert sign_in(client, "distributor").status_code == 200
    return client.post("/api/shipments", json={"batch_id": batch_id, "status": status}, headers={"Idempotency-Key": str(uuid.uuid4())})


def _deliver(client, batch_id):
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        assert _ship(client, batch_id, status).status_code == 201


def _receive(client, batch_id, key=None):
    assert sign_in(client, "retailer").status_code == 200
    return client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": key or str(uuid.uuid4())})


def _verify(db_path):
    conn = connect(db_path)
    try:
        return verify_ledger(conn)
    finally:
        conn.close()


def _status(db_path, batch_id):
    return _scalar(db_path, "SELECT current_status FROM product_batches WHERE batch_code = ?", (batch_id,))


def _receipt_events(db_path, batch_id):
    return _scalar(
        db_path,
        "SELECT COUNT(*) FROM supply_chain_events e JOIN product_batches b ON b.id = e.batch_id "
        "WHERE b.batch_code = ? AND e.event_type = 'RECEIPT_CONFIRMED'",
        (batch_id,),
    )


# --- Eligibility and API errors ----------------------------------------------------------------


def test_retailer_sees_delivered_batches_with_their_delivery_time(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)
    assert sign_in(client, "retailer").status_code == 200

    listed = {b["batch_id"]: b for b in client.get("/api/receipts/awaiting").get_json()["batches"]}

    assert listed[batch_id]["current_status"] == "Delivered to Retailer"
    delivered_event = _scalar(
        db_path,
        "SELECT event_timestamp FROM supply_chain_events WHERE event_type = 'SHIPMENT_UPDATED' AND status = 'Delivered to Retailer'",
    )
    assert listed[batch_id]["delivered_at"] == delivered_event


@pytest.mark.parametrize("steps", [[], ["Shipped"], ["Shipped", "In Transit"]])
def test_a_batch_in_an_earlier_state_cannot_be_received(client, db_path, steps):
    batch_id = _register(client)
    for step in steps:
        _ship(client, batch_id, step)
    status_before = _status(db_path, batch_id)

    response = _receive(client, batch_id)

    assert response.status_code == 409
    assert "not awaiting receipt" in response.get_json()["error"]["message"]
    assert _status(db_path, batch_id) == status_before
    assert _receipt_events(db_path, batch_id) == 0


def test_a_received_batch_cannot_be_received_again_with_a_new_key(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)
    assert _receive(client, batch_id).status_code == 201

    response = _receive(client, batch_id)

    assert response.status_code == 409
    assert "already been received" in response.get_json()["error"]["message"]
    assert _receipt_events(db_path, batch_id) == 1


def test_receipt_for_an_unknown_batch_is_not_found(client):
    assert _receive(client, "PB-ZZZZ-ZZZZ").status_code == 404


@pytest.mark.parametrize("body", [{}, {"batch_id": ""}, {"batch_id": "not-a-batch"}])
def test_invalid_receipt_body_is_a_bad_request(client, body):
    assert sign_in(client, "retailer").status_code == 200

    response = client.post("/api/receipts", json=body, headers={"Idempotency-Key": str(uuid.uuid4())})

    assert response.status_code == 400


def test_receipt_requires_an_idempotency_key(client):
    batch_id = _register(client)
    _deliver(client, batch_id)
    assert sign_in(client, "retailer").status_code == 200

    response = client.post("/api/receipts", json={"batch_id": batch_id})

    assert response.status_code == 400


# --- Persistence --------------------------------------------------------------------------------


def test_successful_receipt_creates_exactly_one_receipt_record_and_sets_the_status(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)

    response = _receive(client, batch_id)

    assert response.status_code == 201
    body = response.get_json()
    assert body["batch"] == {"batch_id": batch_id, "current_status": "Received by Retailer"}
    assert body["event"]["actor_role"] == "retailer"
    assert _receipt_events(db_path, batch_id) == 1
    assert _status(db_path, batch_id) == "Received by Retailer"


def test_receipt_timestamp_matches_its_event_and_its_block(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)

    body = _receive(client, batch_id).get_json()

    event_timestamp = _scalar(db_path, "SELECT event_timestamp FROM supply_chain_events WHERE id = ?", (body["event"]["event_id"],))
    block_timestamp = _scalar(db_path, "SELECT timestamp FROM ledger_blocks WHERE event_id = ?", (body["event"]["event_id"],))
    assert body["event"]["timestamp"] == event_timestamp == block_timestamp


def test_repeated_request_with_the_same_key_returns_the_stored_receipt(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)
    key = str(uuid.uuid4())

    first = _receive(client, batch_id, key=key)
    again = _receive(client, batch_id, key=key)

    assert first.status_code == 201
    assert again.status_code == 200
    assert again.get_json()["event"]["event_id"] == first.get_json()["event"]["event_id"]
    assert _receipt_events(db_path, batch_id) == 1


def test_same_key_for_a_different_batch_is_a_conflict(client, db_path):
    first = _register(client)
    _deliver(client, first)
    second = _register(client)
    _deliver(client, second)
    key = str(uuid.uuid4())
    assert _receive(client, first, key=key).status_code == 201

    response = _receive(client, second, key=key)

    assert response.status_code == 409
    assert _receipt_events(db_path, second) == 0


# --- Concurrency (service level, one connection per thread) ------------------------------------


def test_concurrent_receipts_create_exactly_one_receipt(tmp_path):
    db = str(tmp_path / "receipt_race.db")
    init_db(db)
    setup = connect(db)
    setup.execute("INSERT INTO users (display_name, username, role) VALUES ('Farmer', 'farmer.race', 'farmer')")
    setup.commit()
    farmer_id = setup.execute("SELECT id FROM users WHERE username = 'farmer.race'").fetchone()[0]
    clean = validate_batch_input(VALID)
    batch, _created = register_batch(setup, farmer_id, "race-0001-batch-key", clean)
    code = batch["batch_id"]
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        record_shipment(setup, f"race-{status[:4]}-ship-key-01".replace(" ", ""), {"batch_id": code, "status": status, "note": None})
    setup.close()

    def attempt(number):
        conn = connect(db)
        try:
            try:
                _result, created = confirm_receipt(conn, f"race-recv-key-{number:04d}", code)
                return ("created" if created else "replayed")
            except ReceiptNotAllowedError:
                return "refused"
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=6) as pool:
        outcomes = list(pool.map(attempt, range(6)))

    assert outcomes.count("created") == 1
    assert outcomes.count("refused") == 5
    assert _receipt_events(db, code) == 1
    assert _scalar(db, "SELECT COUNT(*) FROM ledger_blocks WHERE event_id IN (SELECT id FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED')") == 1
    assert _verify(db)["result"] == "valid"


def test_concurrent_requests_with_one_key_create_one_receipt(tmp_path):
    db = str(tmp_path / "receipt_same_key.db")
    init_db(db)
    setup = connect(db)
    setup.execute("INSERT INTO users (display_name, username, role) VALUES ('Farmer', 'farmer.same', 'farmer')")
    setup.commit()
    farmer_id = setup.execute("SELECT id FROM users WHERE username = 'farmer.same'").fetchone()[0]
    batch, _created = register_batch(setup, farmer_id, "same-0001-batch-key", validate_batch_input(VALID))
    code = batch["batch_id"]
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        record_shipment(setup, f"same-{status[:4]}-ship-key-01".replace(" ", ""), {"batch_id": code, "status": status, "note": None})
    setup.close()

    def attempt(_):
        conn = connect(db)
        try:
            _result, created = confirm_receipt(conn, "same-recv-key-0001", code)
            return created
        finally:
            conn.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))

    assert results.count(True) == 1
    assert _receipt_events(db, code) == 1
    assert _verify(db)["result"] == "valid"


# --- Ledger integrity and rollback --------------------------------------------------------------


@pytest.mark.parametrize(
    "table, operation",
    [("supply_chain_events", "INSERT"), ("ledger_blocks", "INSERT"), ("product_batches", "UPDATE")],
)
def test_failed_receipt_write_leaves_no_receipt_event_block_or_status_change(client, db_path, table, operation):
    batch_id = _register(client)
    _deliver(client, batch_id)
    before = _snapshot(db_path)
    _install_failure(db_path, "forced_receipt_failure", table, operation)

    failed = _receive(client, batch_id, key="rcpt-fail-key-0001")

    assert failed.status_code == 500
    assert _snapshot(db_path) == before
    assert _status(db_path, batch_id) == "Delivered to Retailer"

    _remove_failure(db_path, "forced_receipt_failure")
    assert _receive(client, batch_id, key="rcpt-fail-key-0001").status_code == 201
    assert _verify(db_path)["result"] == "valid"


def test_successful_receipt_appends_one_block_and_keeps_history_blocks_unchanged(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)
    blocks_before = _snapshot(db_path)["ledger_blocks"]

    _receive(client, batch_id)

    blocks_after = _snapshot(db_path)["ledger_blocks"]
    assert blocks_after[: len(blocks_before)] == blocks_before
    assert len(blocks_after) == len(blocks_before) + 1
    assert _verify(db_path)["result"] == "valid"


def test_distributor_cannot_record_a_movement_after_receipt(client, db_path):
    batch_id = _register(client)
    _deliver(client, batch_id)
    _receive(client, batch_id)

    response = _ship(client, batch_id, "In Transit")

    assert response.status_code == 409
    assert _status(db_path, batch_id) == "Received by Retailer"


# --- Received list ------------------------------------------------------------------------------


def test_received_list_shows_the_receipt_time_and_only_received_batches(client, db_path):
    received = _register(client)
    _deliver(client, received)
    _receive(client, received)
    waiting = _register(client)
    _deliver(client, waiting)
    assert sign_in(client, "retailer").status_code == 200

    listed = client.get("/api/receipts/received").get_json()["batches"]
    awaiting = client.get("/api/receipts/awaiting").get_json()["batches"]

    assert [b["batch_id"] for b in listed] == [received]
    assert listed[0]["received_at"] == _scalar(
        db_path, "SELECT event_timestamp FROM supply_chain_events WHERE event_type = 'RECEIPT_CONFIRMED'"
    )
    assert waiting in [b["batch_id"] for b in awaiting]
    assert received not in [b["batch_id"] for b in awaiting]


def test_received_list_contains_no_farmer_identity(client):
    batch_id = _register(client)
    _deliver(client, batch_id)
    _receive(client, batch_id)
    assert sign_in(client, "retailer").status_code == 200

    body = client.get("/api/receipts/received").get_data(as_text=True)

    assert "created_by" not in body
    assert "username" not in body
    assert "password" not in body.lower()


# --- Role isolation -----------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "distributor"])
def test_other_roles_cannot_read_or_confirm_receipts(client, role):
    batch_id = _register(client)
    _deliver(client, batch_id)
    assert sign_in(client, role).status_code == 200

    assert client.get("/api/receipts/received").status_code == 403
    assert client.get("/api/receipts/awaiting").status_code == 403
    response = client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 403


def test_unauthenticated_requests_cannot_read_or_confirm_receipts(client):
    client.delete("/api/session")

    assert client.get("/api/receipts/received").status_code == 401
    response = client.post("/api/receipts", json={"batch_id": "PB-ZZZZ-ZZZZ"}, headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 401


# --- Public tracking and QR ---------------------------------------------------------------------


def test_public_tracking_shows_the_completed_handover_in_order(client):
    batch_id = _register(client)
    _deliver(client, batch_id)
    _receive(client, batch_id)
    client.delete("/api/session")

    body = client.get(f"/api/tracking/{batch_id}").get_json()

    assert body["batch"]["current_status"] == "Received by Retailer"
    assert [event["event_type"] for event in body["events"]] == [
        "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]
    assert body["events"][-1]["actor_role"] == "retailer"
    timestamps = [event["timestamp"] for event in body["events"]]
    assert timestamps == sorted(timestamps)
    assert "user_id" not in str(body) and "created_by" not in str(body)


def test_qr_code_still_works_after_receipt(client):
    batch_id = _register(client)
    _deliver(client, batch_id)
    _receive(client, batch_id)
    assert sign_in(client, "farmer").status_code == 200

    batch = client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]

    assert batch["current_status"] == "Received by Retailer"
    assert client.get(batch["qr_code_url"]).status_code == 200
    assert batch["tracking_url"].endswith(f"/track/{batch_id}")


def test_history_and_receipt_views_agree(client):
    batch_id = _register(client)
    _deliver(client, batch_id)
    _receive(client, batch_id)

    history = client.get(f"/api/history/{batch_id}").get_json()["events"]

    assert [event["event_type"] for event in history][-1] == "RECEIPT_CONFIRMED"
    assert history[-1]["ledger_block_index"] is not None
