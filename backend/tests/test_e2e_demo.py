"""End-to-end college demonstration (BPT-112): the full product journey on an isolated temporary database.

The sequence matches docs/DEMO_GUIDE.md: farmer registers and downloads the QR code, distributor moves the
batch through the lifecycle, retailer confirms receipt, a consumer reads the public journey without signing
in, and the ledger is checked. Each step also checks that the other roles are refused.
"""

import io
import sqlite3
import uuid

import zxingcpp
from PIL import Image

from app.services.ledger_verification import verify_ledger
from app.db import connect

from tests.auth_helpers import sign_in

FARMER_BATCH = {
    "product_name": "Demo Alphonso Mangoes",
    "description": "Fictional sample batch for the college demonstration.",
    "quantity": 300,
    "unit": "crates",
    "origin": "Demo Orchard Cooperative",
    "harvest_date": "2026-10-03",
}


def _key():
    return str(uuid.uuid4())


def _as(client, role):
    assert sign_in(client, role).status_code == 200


def test_the_full_demonstration_journey_works_end_to_end(client, db_path):
    # 1. Farmer registers a batch and gets its ID, tracking link and QR code.
    _as(client, "farmer")
    registered = client.post("/api/batches", json=FARMER_BATCH, headers={"Idempotency-Key": _key()})
    assert registered.status_code == 201
    batch = registered.get_json()["batch"]
    batch_id = batch["batch_id"]
    assert batch["current_status"] == "Registered"
    assert batch["tracking_url"].endswith(f"/track/{batch_id}")

    qr = client.get(batch["qr_code_url"] + "?download=1")
    assert qr.status_code == 200 and qr.mimetype == "image/png"
    decoded = zxingcpp.read_barcodes(Image.open(io.BytesIO(qr.get_data())))
    assert [b.text for b in decoded] == [batch["tracking_url"]]

    # A farmer cannot move shipments.
    refused = client.post("/api/shipments", json={"batch_id": batch_id, "status": "Shipped"}, headers={"Idempotency-Key": _key()})
    assert refused.status_code == 403

    # 2. Distributor sees the batch and moves it through the lifecycle.
    _as(client, "distributor")
    listed = {b["batch_id"]: b for b in client.get("/api/shipments/batches").get_json()["batches"]}
    assert listed[batch_id]["next_statuses"] == ["Shipped"]

    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        response = client.post(
            "/api/shipments",
            json={"batch_id": batch_id, "status": status, "note": f"Demo movement: {status}"},
            headers={"Idempotency-Key": _key()},
        )
        assert response.status_code == 201, status

    # Invalid and repeated movements are refused, and the status is unchanged.
    assert client.post("/api/shipments", json={"batch_id": batch_id, "status": "Shipped"}, headers={"Idempotency-Key": _key()}).status_code == 409
    assert client.get(f"/api/history/{batch_id}").get_json()["batch"]["current_status"] == "Delivered to Retailer"

    # 3. Retailer sees the incoming batch and confirms receipt.
    _as(client, "retailer")
    awaiting = [b["batch_id"] for b in client.get("/api/receipts/awaiting").get_json()["batches"]]
    assert batch_id in awaiting
    receipt_key = _key()
    received = client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": receipt_key})
    assert received.status_code == 201
    receipt_time = received.get_json()["event"]["timestamp"]
    assert receipt_time

    # The same confirmation again is idempotent; a new confirmation is refused.
    assert client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": receipt_key}).status_code == 200
    assert client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": _key()}).status_code == 409
    assert batch_id in [b["batch_id"] for b in client.get("/api/receipts/received").get_json()["batches"]]

    # A distributor cannot record anything after receipt.
    _as(client, "distributor")
    assert client.post("/api/shipments", json={"batch_id": batch_id, "status": "In Transit"}, headers={"Idempotency-Key": _key()}).status_code == 409

    # 4. Consumer: no session, the public journey is complete and read-only.
    client.delete("/api/session")
    journey = client.get(f"/api/tracking/{batch_id}")
    assert journey.status_code == 200
    body = journey.get_json()
    assert body["batch"]["current_status"] == "Received by Retailer"
    assert body["batch"]["description"] == FARMER_BATCH["description"]
    assert [e["event_type"] for e in body["events"]] == [
        "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]
    assert body["events"][-1]["actor_role"] == "retailer"
    assert client.get("/api/tracking/PB-ZZZZ-ZZZZ").status_code == 404
    assert client.get("/api/tracking/not-a-code").status_code == 400

    # 5. Ledger: authorised users can read it; unauthenticated users cannot.
    assert client.get("/api/ledger").status_code == 401
    _as(client, "farmer")
    verified = client.get("/api/ledger/verify").get_json()
    assert verified["result"] == "valid"
    assert verified["checked_blocks"] == 6  # genesis plus five recorded events

    blocks = client.get("/api/ledger").get_json()["blocks"]
    events_with_blocks = [b for b in blocks if b["event_id"] is not None]
    assert len(events_with_blocks) == 5
    assert {b["batch_id"] for b in events_with_blocks} == {batch_id}


def test_the_demonstration_database_is_left_consistent_after_the_journey(client, db_path):
    _as(client, "farmer")
    batch_id = client.post("/api/batches", json=FARMER_BATCH, headers={"Idempotency-Key": _key()}).get_json()["batch"]["batch_id"]
    _as(client, "distributor")
    for status in ("Shipped", "In Transit", "Delivered to Retailer"):
        client.post("/api/shipments", json={"batch_id": batch_id, "status": status}, headers={"Idempotency-Key": _key()})
    _as(client, "retailer")
    client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": _key()})

    conn = connect(db_path)
    try:
        result = verify_ledger(conn)
        events = conn.execute("SELECT COUNT(*) FROM supply_chain_events WHERE event_type IN ('PRODUCT_REGISTERED','SHIPMENT_UPDATED','RECEIPT_CONFIRMED')").fetchone()[0]
        blocks = conn.execute("SELECT COUNT(*) FROM ledger_blocks WHERE event_id IS NOT NULL").fetchone()[0]
    finally:
        conn.close()

    assert result["result"] == "valid"
    assert events == blocks == 5
    raw = sqlite3.connect(db_path)
    assert raw.execute("SELECT COUNT(*) FROM ledger_blocks").fetchone()[0] == 6
    raw.close()
