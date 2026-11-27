"""QR codes and tracking URLs (US-03).

The QR images are decoded with zxing-cpp, so these tests check what a phone's camera would read.
"""

import io
import re
import sqlite3

import pytest
import zxingcpp
from PIL import Image

from app import create_app
from app.config import build_config
from app.services.qr_service import build_tracking_url, render_qr_png

from tests.auth_helpers import sign_in

KEY = "77777777-aaaa-4bbb-8ccc-000000000001"
VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def decode_qr(png_bytes):
    """Decode every QR code in a PNG and return the list of (format, text) results."""
    image = Image.open(io.BytesIO(png_bytes))
    return [(str(result.format), result.text) for result in zxingcpp.read_barcodes(image)]


def _as_farmer(client):
    assert sign_in(client, "farmer").status_code == 200


def _register(client, key=KEY, **changes):
    response = client.post(
        "/api/batches",
        json=dict(VALID, **changes),
        headers={"Idempotency-Key": key},
    )
    assert response.status_code in (200, 201), response.get_data(as_text=True)
    return response.get_json()["batch"]


def _batch_row_id(db_path, batch_code):
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT id FROM product_batches WHERE batch_code = ?", (batch_code,)).fetchone()
    conn.close()
    return row[0]


# --- Tracking URL --------------------------------------------------------------


def test_tracking_url_combines_base_and_batch_id():
    assert build_tracking_url("http://localhost:5173", "PB-7K2M-9QXD") == "http://localhost:5173/track/PB-7K2M-9QXD"


def test_tracking_url_ignores_trailing_slash_on_base():
    assert build_tracking_url("http://192.168.1.20:5173/", "PB-7K2M-9QXD") == "http://192.168.1.20:5173/track/PB-7K2M-9QXD"


def test_default_tracking_base_is_the_local_frontend(monkeypatch):
    monkeypatch.delenv("TRACKING_BASE_URL", raising=False)

    assert build_config()["TRACKING_BASE_URL"] == "http://localhost:5173"


def test_tracking_base_url_from_environment_is_normalised(monkeypatch):
    monkeypatch.setenv("TRACKING_BASE_URL", " http://192.168.1.20:5173/ ")

    assert build_config()["TRACKING_BASE_URL"] == "http://192.168.1.20:5173"


@pytest.mark.parametrize("value", ["localhost:5173", "ftp://example.com", "http://", "   "])
def test_invalid_tracking_base_url_is_refused_at_startup(monkeypatch, value):
    monkeypatch.setenv("TRACKING_BASE_URL", value)

    with pytest.raises(ValueError, match="TRACKING_BASE_URL"):
        build_config()


# --- QR image generation and decoding --------------------------------------------


def test_qr_png_decodes_to_exactly_the_tracking_url():
    url = build_tracking_url("http://localhost:5173", "PB-7K2M-9QXD")

    png = render_qr_png(url)

    assert png.startswith(PNG_SIGNATURE)
    decoded = decode_qr(png)
    assert len(decoded) == 1
    assert decoded[0][0] == "QR Code"  # zxing-cpp's name for the QR format
    assert decoded[0][1] == url


def test_qr_generation_is_deterministic():
    url = build_tracking_url("http://localhost:5173", "PB-7K2M-9QXD")

    assert render_qr_png(url) == render_qr_png(url)


def test_different_batches_produce_different_qr_content():
    first = decode_qr(render_qr_png(build_tracking_url("http://localhost:5173", "PB-AAAA-0001")))[0][1]
    second = decode_qr(render_qr_png(build_tracking_url("http://localhost:5173", "PB-AAAA-0002")))[0][1]

    assert first != second
    assert first.endswith("PB-AAAA-0001")
    assert second.endswith("PB-AAAA-0002")


# --- API: batch responses carry the ID, URL and QR path --------------------------------


def test_registration_response_includes_batch_id_tracking_url_and_qr_path(client):
    _as_farmer(client)

    batch = _register(client)

    assert re.fullmatch(r"PB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}", batch["batch_id"])
    assert batch["tracking_url"] == f"http://localhost:5173/track/{batch['batch_id']}"
    assert batch["qr_code_url"] == f"/api/batches/{batch['id']}/qr.png"
    assert "batch_code" not in batch
    assert "created_by" not in batch


def test_listed_batches_include_their_batch_id(client):
    _as_farmer(client)
    batch = _register(client)

    listed = client.get("/api/batches").get_json()["batches"]

    assert listed[0]["batch_id"] == batch["batch_id"]
    assert listed[0]["tracking_url"] == batch["tracking_url"]


def test_tracking_url_uses_configured_base_url(tmp_path):
    db_path = str(tmp_path / "lan.db")
    app = create_app(
        {
            "TESTING": True,
            "DATABASE_PATH": db_path,
            "SECRET_KEY": "test-secret",
            "TRACKING_BASE_URL": "http://192.168.1.20:5173",
        }
    )
    init_db_for_test(db_path)
    client = app.test_client()
    _as_farmer(client)

    batch = _register(client)

    assert batch["tracking_url"].startswith("http://192.168.1.20:5173/track/")
    png = client.get(batch["qr_code_url"]).get_data()
    assert decode_qr(png)[0][1] == batch["tracking_url"]


def init_db_for_test(db_path):
    from app.db import init_db

    init_db(db_path)


def test_replayed_submission_returns_the_same_id_and_qr(client):
    _as_farmer(client)
    first = _register(client)
    second = _register(client)

    assert second["batch_id"] == first["batch_id"]
    assert second["tracking_url"] == first["tracking_url"]


# --- API: QR image endpoint -----------------------------------------------------------


def test_farmer_downloads_qr_that_decodes_to_the_batch_tracking_url(client):
    _as_farmer(client)
    batch = _register(client)

    response = client.get(batch["qr_code_url"])

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert response.headers.get("Cache-Control") == "no-store"
    assert "Content-Disposition" not in response.headers  # shown inline by default
    assert decode_qr(response.get_data()) == [("QR Code", batch["tracking_url"])]


def test_download_flag_sends_the_qr_as_an_attachment(client):
    _as_farmer(client)
    batch = _register(client)

    response = client.get(batch["qr_code_url"] + "?download=1")

    assert response.status_code == 200
    assert response.headers["Content-Disposition"] == f'attachment; filename="{batch["batch_id"]}-qr.png"'
    assert decode_qr(response.get_data())[0][1] == batch["tracking_url"]


def test_qr_contains_no_private_information(client):
    _as_farmer(client)
    batch = _register(client)

    text = decode_qr(client.get(batch["qr_code_url"]).get_data())[0][1]

    assert text == batch["tracking_url"]
    for private in ("demo", "farmer", KEY, "session", "@", "Basmati"):
        assert private not in text


def test_qr_for_unknown_batch_is_not_found(client):
    _as_farmer(client)

    response = client.get("/api/batches/999999/qr.png")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


def test_qr_path_with_a_non_numeric_id_is_not_found(client):
    _as_farmer(client)

    assert client.get("/api/batches/abc/qr.png").status_code == 404


def test_another_farmers_qr_is_not_found(client, db_path):
    from app.services.batch_service import register_batch, validate_batch_input
    import sqlite3 as _sqlite

    conn = _sqlite.connect(db_path)
    conn.row_factory = _sqlite.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("INSERT INTO users (display_name, username, role) VALUES ('Other', 'other.farmer', 'farmer')")
    other_id = conn.execute("SELECT id FROM users WHERE username = 'other.farmer'").fetchone()[0]
    other_batch, _ = register_batch(conn, other_id, "88888888-aaaa-4bbb-8ccc-000000000001", validate_batch_input(VALID))
    conn.close()

    _as_farmer(client)

    assert client.get(f"/api/batches/{other_batch['id']}/qr.png").status_code == 404


@pytest.mark.parametrize("role", ["distributor", "retailer"])
def test_other_roles_cannot_get_qr_codes(client, role):
    _as_farmer(client)
    batch = _register(client)
    sign_in(client, role)

    assert client.get(batch["qr_code_url"]).status_code == 403


def test_qr_requires_a_session(client):
    _as_farmer(client)
    batch = _register(client)
    client.delete("/api/session")

    assert client.get(batch["qr_code_url"]).status_code == 401


# --- API: lookup by batch ID ------------------------------------------------------------


def test_lookup_by_batch_id_returns_the_correct_batch(client):
    _as_farmer(client)
    first = _register(client, key="99999999-aaaa-4bbb-8ccc-000000000001")
    second = _register(client, key="99999999-aaaa-4bbb-8ccc-000000000002", product_name="Wheat")

    response = client.get(f"/api/batches/by-batch-id/{second['batch_id']}")

    assert response.status_code == 200
    batch = response.get_json()["batch"]
    assert batch["batch_id"] == second["batch_id"]
    assert batch["product_name"] == "Wheat"
    assert batch["batch_id"] != first["batch_id"]


@pytest.mark.parametrize("code", ["PB-7K2M9QXD", "pb-7k2m-9qxd", "PB-7K2M-9QXI", "not-a-batch", "PB-%20-0001"])
def test_lookup_with_invalid_batch_id_is_a_bad_request(client, code):
    _as_farmer(client)

    response = client.get(f"/api/batches/by-batch-id/{code}")

    assert response.status_code == 400
    assert "PB-XXXX-XXXX" in response.get_json()["error"]["message"]


def test_lookup_with_unknown_batch_id_is_not_found(client):
    _as_farmer(client)

    response = client.get("/api/batches/by-batch-id/PB-ZZZZ-ZZZZ")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


def test_lookup_by_batch_id_is_farmer_only(client):
    _as_farmer(client)
    batch = _register(client)
    sign_in(client, "distributor")

    assert client.get(f"/api/batches/by-batch-id/{batch['batch_id']}").status_code == 403
    client.delete("/api/session")
    assert client.get(f"/api/batches/by-batch-id/{batch['batch_id']}").status_code == 401


# --- Existing endpoints remain compatible ----------------------------------------------


def test_detail_endpoint_still_returns_the_batch_by_row_id(client):
    _as_farmer(client)
    batch = _register(client)

    response = client.get(f"/api/batches/{batch['id']}")

    assert response.status_code == 200
    assert response.get_json()["batch"]["batch_id"] == batch["batch_id"]


def test_health_and_session_still_work_with_qr_support(client):
    _as_farmer(client)

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/session").get_json()["role"] == "farmer"


def test_qr_download_is_a_valid_png_file(client):
    _as_farmer(client)
    batch = _register(client)

    body = client.get(batch["qr_code_url"] + "?download=1").get_data()

    assert body.startswith(PNG_SIGNATURE)
    assert Image.open(io.BytesIO(body)).format == "PNG"


def _table_counts(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return tuple(
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("product_batches", "supply_chain_events", "ledger_blocks")
        )
    finally:
        conn.close()


def test_repeated_qr_views_and_downloads_change_no_records(client, db_path):
    _as_farmer(client)
    batch = _register(client)
    before = _table_counts(db_path)

    for _ in range(3):
        assert client.get(batch["qr_code_url"]).status_code == 200
        assert client.get(batch["qr_code_url"] + "?download=1").status_code == 200
    client.get("/api/batches")

    assert _table_counts(db_path) == before


def test_qr_and_tracking_url_are_the_same_in_a_new_session(client):
    _as_farmer(client)
    batch = _register(client)
    client.delete("/api/session")

    _as_farmer(client)
    listed = client.get("/api/batches").get_json()["batches"][0]
    png = client.get(listed["qr_code_url"]).get_data()

    assert listed["batch_id"] == batch["batch_id"]
    assert listed["tracking_url"] == batch["tracking_url"]
    assert decode_qr(png) == [("QR Code", batch["tracking_url"])]
