"""Public consumer tracking (US-08): access without a session, exposed fields, read-only behaviour, QR flow."""

import io
import sqlite3

import pytest
import zxingcpp
from PIL import Image

from app.services.batch_service import register_batch, validate_batch_input

from tests.auth_helpers import sign_in

FARMER_KEY = "aaaa1111-bbbb-4ccc-8ddd-000000000301"
VALID_BATCH = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}
PUBLIC_BATCH_KEYS = {"batch_id", "product_name", "origin", "current_status", "description", "quantity", "unit", "harvest_date"}
PUBLIC_EVENT_KEYS = {"event_type", "label", "actor_role", "status", "note", "timestamp", "ledger_block_index"}


def _role(client, role):
    assert sign_in(client, role).status_code == 200


def _connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _register(client, key=FARMER_KEY, **changes):
    _role(client, "farmer")
    response = client.post("/api/batches", json=dict(VALID_BATCH, **changes), headers={"Idempotency-Key": key})
    assert response.status_code == 201
    return response.get_json()["batch"]["batch_id"]


def _complete_flow(client):
    """Farmer registers, distributor ships to the retailer, retailer confirms receipt. Returns the batch ID."""
    batch_id = _register(client)
    _role(client, "distributor")
    client.post("/api/shipments", json={"batch_id": batch_id, "status": "Shipped", "note": "Left the farm"},
                headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000301"})
    client.post("/api/shipments", json={"batch_id": batch_id, "status": "In Transit"},
                headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000303"})
    client.post("/api/shipments", json={"batch_id": batch_id, "status": "Delivered to Retailer"},
                headers={"Idempotency-Key": "bbbb2222-cccc-4ddd-8eee-000000000302"})
    _role(client, "retailer")
    client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": "cccc3333-dddd-4eee-8fff-000000000301"})
    return batch_id


def _decode_qr(png_bytes):
    image = Image.open(io.BytesIO(png_bytes))
    results = zxingcpp.read_barcodes(image)
    assert len(results) == 1
    assert str(results[0].format) == "QR Code"
    return results[0].text


def _tables(db_path):
    conn = _connect(db_path)
    try:
        return {
            name: [tuple(row) for row in conn.execute(f"SELECT * FROM {name} ORDER BY 1")]
            for name in ("users", "product_batches", "supply_chain_events", "ledger_blocks")
        }
    finally:
        conn.close()


# --- Public access ---------------------------------------------------------------------------


def test_tracking_works_without_any_session(client):
    batch_id = _register(client)
    client.delete("/api/session")

    response = client.get(f"/api/tracking/{batch_id}")

    assert response.status_code == 200
    assert response.get_json()["batch"]["batch_id"] == batch_id


def test_tracking_resolves_the_correct_batch_among_several(client):
    first = _register(client, key="aaaa1111-bbbb-4ccc-8ddd-000000000311")
    second = _register(client, key="aaaa1111-bbbb-4ccc-8ddd-000000000312", product_name="Wheat", origin="North Field")
    client.delete("/api/session")

    body = client.get(f"/api/tracking/{second}").get_json()

    assert body["batch"]["batch_id"] == second
    assert body["batch"]["product_name"] == "Wheat"
    assert body["batch"]["origin"] == "North Field"
    assert first != second


def test_tracking_returns_product_origin_and_current_status(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    batch = client.get(f"/api/tracking/{batch_id}").get_json()["batch"]

    assert set(batch.keys()) == PUBLIC_BATCH_KEYS
    assert batch["batch_id"] == batch_id
    assert batch["product_name"] == "Basmati Rice"
    assert batch["origin"] == "Green Valley Farm"
    assert batch["current_status"] == "Received by Retailer"
    assert batch["quantity"] == 250
    assert batch["unit"] == "kg"
    assert batch["harvest_date"] == "2026-10-15"


def test_registration_shipment_and_receipt_events_appear_in_order(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    body = client.get(f"/api/tracking/{batch_id}").get_json()

    types = [event["event_type"] for event in body["events"]]
    assert types == [
        "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]
    assert body["count"] == 5
    timestamps = [event["timestamp"] for event in body["events"]]
    assert timestamps == sorted(timestamps)


def test_events_show_actor_status_note_and_ledger_block_index(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    registration, shipped, in_transit, delivered, receipt = client.get(f"/api/tracking/{batch_id}").get_json()["events"]

    assert (registration["actor_role"], registration["status"]) == ("farmer", "Registered")
    assert (shipped["actor_role"], shipped["status"], shipped["note"]) == ("distributor", "Shipped", "Left the farm")
    assert delivered["note"] is None
    assert (receipt["actor_role"], receipt["status"]) == ("retailer", "Received by Retailer")
    assert [event["ledger_block_index"] for event in (registration, shipped, in_transit, delivered, receipt)] == [1, 2, 3, 4, 5]


def test_unknown_batch_returns_not_found(client):
    response = client.get("/api/tracking/PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


@pytest.mark.parametrize("batch_id", ["not-a-batch", "pb-7k2m-9qxd", "PB-7K2M9QXD", "PB-7K2M-9QXI"])
def test_malformed_batch_id_is_a_bad_request(client, batch_id):
    response = client.get(f"/api/tracking/{batch_id}")

    assert response.status_code == 400
    assert response.get_json()["error"]["message"] == "Batch ID must look like PB-XXXX-XXXX."


# --- Exposure ------------------------------------------------------------------------------------


def test_response_exposes_only_the_whitelisted_fields(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    body = client.get(f"/api/tracking/{batch_id}").get_json()

    assert set(body.keys()) == {"batch", "count", "events"}
    assert set(body["batch"].keys()) == PUBLIC_BATCH_KEYS
    for event in body["events"]:
        assert set(event.keys()) == PUBLIC_EVENT_KEYS


def test_response_contains_no_farmer_identity_or_internal_identifiers(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    text = client.get(f"/api/tracking/{batch_id}").get_data(as_text=True)

    for forbidden in ("demo.", "Demo ", "created_by", "user_id", "username", "display_name",
                      "client_request_id", "event_id", "event_payload", "block_hash", "previous_hash",
                      "submission", "demo_access", "session", "Idempotency"):
        assert forbidden not in text, forbidden


def test_response_sets_no_cookie_and_no_session(client):
    batch_id = _complete_flow(client)
    client.delete("/api/session")

    response = client.get(f"/api/tracking/{batch_id}")

    assert "Set-Cookie" not in response.headers
    assert response.headers.get("Cache-Control") == "no-store"


def test_tracking_does_not_reveal_a_session_role(client):
    batch_id = _complete_flow(client)

    with_retailer = client.get(f"/api/tracking/{batch_id}").get_json()
    client.delete("/api/session")
    without_session = client.get(f"/api/tracking/{batch_id}").get_json()

    assert with_retailer == without_session


# --- Read-only ---------------------------------------------------------------------------------


def test_tracking_requests_do_not_modify_the_database(client, db_path):
    batch_id = _complete_flow(client)
    client.delete("/api/session")
    before = _tables(db_path)

    for _ in range(3):
        client.get(f"/api/tracking/{batch_id}")
        client.get("/api/tracking/PB-ZZZZ-ZZZZ")

    assert _tables(db_path) == before


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_tracking_accepts_no_write_methods(client, method):
    response = getattr(client, method)("/api/tracking/PB-AAAA-0001", json={"status": "Received by Retailer"})

    assert response.status_code == 405


# --- Existing protected operations ------------------------------------------------------------


def test_existing_authenticated_endpoints_remain_protected(client):
    client.delete("/api/session")

    assert client.get("/api/batches").status_code == 401
    assert client.get("/api/shipments/batches").status_code == 401
    assert client.get("/api/receipts/awaiting").status_code == 401
    assert client.get("/api/ledger").status_code == 401
    assert client.get("/api/history/PB-AAAA-0001").status_code == 401


def test_public_access_does_not_weaken_role_checks(client):
    batch_id = _complete_flow(client)
    _role(client, "farmer")

    assert client.get(f"/api/tracking/{batch_id}").status_code == 200
    assert client.get("/api/receipts/awaiting").status_code == 403
    assert client.post("/api/receipts", json={"batch_id": batch_id}, headers={"Idempotency-Key": "dddd4444-eeee-4fff-8000-000000000301"}).status_code == 403


def test_history_endpoint_now_also_reports_the_origin(client):
    batch_id = _complete_flow(client)

    batch = client.get(f"/api/history/{batch_id}").get_json()["batch"]

    assert batch["origin"] == "Green Valley Farm"


# --- QR code to tracking page -----------------------------------------------------------------


def test_qr_code_decodes_to_the_tracking_url_for_the_batch(client):
    batch_id = _register(client)
    response = client.get(f"/api/batches/by-batch-id/{batch_id}")
    qr_path = response.get_json()["batch"]["qr_code_url"]

    png = client.get(qr_path).get_data()
    decoded = _decode_qr(png)

    assert decoded == f"http://localhost:5173/track/{batch_id}"


def test_scanning_the_qr_opens_the_tracking_page_without_a_session(client):
    batch_id = _complete_flow(client)
    _role(client, "farmer")  # the QR image is the farmer's; the scanner needs no session
    qr_path = client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["qr_code_url"]
    decoded = _decode_qr(client.get(qr_path).get_data())
    client.delete("/api/session")

    scanned_batch_id = decoded.rsplit("/track/", 1)[1]
    body = client.get(f"/api/tracking/{scanned_batch_id}").get_json()

    assert scanned_batch_id == batch_id
    assert body["batch"]["current_status"] == "Received by Retailer"
    assert [event["event_type"] for event in body["events"]] == [
        "PRODUCT_REGISTERED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "SHIPMENT_UPDATED", "RECEIPT_CONFIRMED",
    ]


def test_decoded_url_uses_the_configured_tracking_base(db_path):
    from app import create_app
    from app.db import init_db

    init_db(db_path)
    app = create_app({"TESTING": True, "DATABASE_PATH": db_path, "SECRET_KEY": "t", "TRACKING_BASE_URL": "http://192.168.1.20:5173"})
    client = app.test_client()
    sign_in(client, "farmer")
    batch_id = client.post("/api/batches", json=VALID_BATCH, headers={"Idempotency-Key": "eeee5555-ffff-4000-8111-000000000301"}).get_json()["batch"]["batch_id"]
    qr_path = client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["qr_code_url"]

    decoded = _decode_qr(client.get(qr_path).get_data())

    assert decoded == f"http://192.168.1.20:5173/track/{batch_id}"


def test_qr_generation_still_returns_png_for_the_farmer(client):
    batch_id = _register(client)
    qr_path = client.get(f"/api/batches/by-batch-id/{batch_id}").get_json()["batch"]["qr_code_url"]

    response = client.get(qr_path)

    assert response.status_code == 200
    assert response.mimetype == "image/png"


def test_direct_tracking_service_matches_the_database_content(db_path):
    init_db_for_test(db_path)
    conn = _connect(db_path)
    farmer_id = conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]
    batch, _ = register_batch(conn, farmer_id, "ffff6666-0000-4111-8222-000000000301", validate_batch_input(VALID_BATCH))
    conn.close()

    from app.services.public_tracking import public_tracking

    conn = _connect(db_path)
    view = public_tracking(conn, batch["batch_id"])
    conn.close()

    assert view["batch"]["batch_id"] == batch["batch_id"]
    assert view["events"][0]["event_type"] == "PRODUCT_REGISTERED"


def init_db_for_test(db_path):
    from app.db import init_db

    init_db(db_path)
