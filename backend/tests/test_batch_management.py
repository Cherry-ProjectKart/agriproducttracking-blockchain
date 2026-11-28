"""Farmer batch registration and management (BPT-105): registration checks, owner-only description edits,
immutability of ledger-recorded details, and preservation of IDs, QR codes, ledger, shipments and receipts."""

import sqlite3

import pytest

from tests.auth_helpers import sign_in

VALID = {
    "product_name": "Basmati Rice",
    "description": "Aged two years, hand-harvested.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm",
    "harvest_date": "2026-10-15",
}


def _key(prefix):
    return f"{prefix}-0000-4000-8000-000000000001"


def _register(client, body=None, key=None):
    return client.post(
        "/api/batches",
        json=dict(VALID if body is None else body),
        headers={"Idempotency-Key": key or _key("reg")},
    )


def _batch(client, body=None, key=None):
    response = _register(client, body, key)
    assert response.status_code == 201, response.get_json()
    return response.get_json()["batch"]


def _scalar(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    value = conn.execute(sql, params).fetchone()[0]
    conn.close()
    return value


def _row(db_path, batch_id):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM product_batches WHERE id = ?", (batch_id,)).fetchone()
    conn.close()
    return dict(row)


def _patch(client, batch_id, body):
    return client.patch(f"/api/batches/{batch_id}", json=body)


def _as_farmer(client):
    assert sign_in(client, "farmer").status_code == 200


def _ledger_state(client):
    body = client.get("/api/ledger").get_json()
    return {"count": body["count"], "hashes": [block["block_hash"] for block in body["blocks"]]}


def _history(client, batch_id):
    return client.get(f"/api/history/{batch_id}").get_json()


# --- Registration -----------------------------------------------------------------------


def test_authenticated_farmer_registers_a_valid_batch(client):
    _as_farmer(client)

    batch = _batch(client)

    assert batch["batch_id"].startswith("PB-")
    assert batch["current_status"] == "Registered"
    assert batch["tracking_url"].endswith(f"/track/{batch['batch_id']}")
    assert batch["qr_code_url"] == f"/api/batches/{batch['id']}/qr.png"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("product_name", ""),
        ("origin", "   "),
        ("unit", None),
        ("quantity", 0),
        ("quantity", -3),
        ("quantity", "lots"),
        ("quantity", 1_000_000_001),
        ("harvest_date", "15/10/2026"),
        ("harvest_date", "2026-13-40"),
        ("description", "x" * 501),
        ("product_name", "p" * 121),
    ],
)
def test_invalid_registration_fields_are_rejected_with_field_errors(client, db_path, field, value):
    _as_farmer(client)

    response = _register(client, dict(VALID, **{field: value}))

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0


def test_missing_required_fields_are_all_reported(client):
    _as_farmer(client)

    response = _register(client, {})

    details = response.get_json()["error"]["details"]
    assert {"product_name", "quantity", "unit", "origin", "harvest_date"} <= set(details)


def test_quantity_at_the_ceiling_is_accepted(client):
    _as_farmer(client)

    batch = _batch(client, dict(VALID, quantity=1_000_000_000))

    assert batch["quantity"] == 1_000_000_000


def test_repeated_submission_with_the_same_key_creates_one_batch(client, db_path):
    _as_farmer(client)
    first = _batch(client, key=_key("dup"))

    second = _register(client, key=_key("dup"))

    assert second.status_code == 200
    assert second.get_json()["batch"]["batch_id"] == first["batch_id"]
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 1
    assert _scalar(db_path, "SELECT COUNT(*) FROM ledger_blocks") == 2  # genesis + one registration


def test_each_registration_gets_a_distinct_batch_id(client):
    _as_farmer(client)

    first = _batch(client, key=_key("ids-a"))
    second = _batch(client, key=_key("ids-b"))

    assert first["batch_id"] != second["batch_id"]


def test_registration_keeps_the_qr_and_public_tracking_workflow(client):
    _as_farmer(client)
    batch = _batch(client)

    qr = client.get(f"/api/batches/{batch['id']}/qr.png")
    public = client.get(f"/api/tracking/{batch['batch_id']}")

    assert qr.status_code == 200 and qr.mimetype == "image/png"
    assert public.status_code == 200
    assert public.get_json()["batch"]["batch_id"] == batch["batch_id"]


# --- Ownership -------------------------------------------------------------------------


def _other_farmer(client, db_path):
    client.delete("/api/session")
    response = client.post(
        "/api/accounts",
        json={
            "full_name": "Other Farmer",
            "username": "other.grower",
            "password": "OtherGrower2026",
            "confirm_password": "OtherGrower2026",
            "role": "farmer",
        },
    )
    assert response.status_code == 201
    client.delete("/api/session")
    client.post("/api/session", json={"username": "other.grower", "password": "OtherGrower2026"})


def test_farmer_edits_own_batch_description(client):
    _as_farmer(client)
    batch = _batch(client)

    response = _patch(client, batch["id"], {"description": "  Now stored in a cool room.  "})

    assert response.status_code == 200
    updated = response.get_json()["batch"]
    assert updated["description"] == "Now stored in a cool room."
    assert updated["batch_id"] == batch["batch_id"]


def test_empty_description_removes_it(client):
    _as_farmer(client)
    batch = _batch(client)

    response = _patch(client, batch["id"], {"description": ""})

    assert response.status_code == 200
    assert response.get_json()["batch"]["description"] is None


def test_description_edit_preserves_batch_id_qr_and_tracking_url(client):
    _as_farmer(client)
    batch = _batch(client)

    updated = _patch(client, batch["id"], {"description": "Edited"}).get_json()["batch"]

    assert updated["batch_id"] == batch["batch_id"]
    assert updated["tracking_url"] == batch["tracking_url"]
    assert updated["qr_code_url"] == batch["qr_code_url"]
    assert client.get(f"/api/batches/{batch['id']}/qr.png").status_code == 200


def test_another_farmer_cannot_read_or_edit_the_batch(client, db_path):
    _as_farmer(client)
    batch = _batch(client)
    _other_farmer(client, db_path)

    response = _patch(client, batch["id"], {"description": "Hijacked"})

    assert response.status_code == 404
    assert _row(db_path, batch["id"])["description"] == VALID["description"]


@pytest.mark.parametrize("role", ["distributor", "retailer"])
def test_other_roles_cannot_edit_batches(client, db_path, role):
    _as_farmer(client)
    batch = _batch(client)
    client.delete("/api/session")
    sign_in(client, role)

    response = _patch(client, batch["id"], {"description": "Not mine"})

    assert response.status_code == 403
    assert _row(db_path, batch["id"])["description"] == VALID["description"]


def test_unauthenticated_edit_is_refused(client, db_path):
    _as_farmer(client)
    batch = _batch(client)
    client.delete("/api/session")

    assert _patch(client, batch["id"], {"description": "Anonymous"}).status_code == 401


def test_owner_cannot_reassign_a_batch_by_sending_an_owner_id(client, db_path):
    _as_farmer(client)
    batch = _batch(client)
    owner_before = _row(db_path, batch["id"])["created_by"]

    response = _patch(client, batch["id"], {"description": "Mine now", "created_by": 1})

    assert response.status_code == 400
    assert "created_by" in response.get_json()["error"]["details"]
    assert _row(db_path, batch["id"])["created_by"] == owner_before


# --- Immutable, ledger-recorded details ---------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("product_name", "Changed Name"),
        ("quantity", 999),
        ("unit", "crates"),
        ("origin", "Somewhere Else"),
        ("harvest_date", "2026-01-01"),
    ],
)
def test_ledger_recorded_details_cannot_be_changed(client, db_path, field, value):
    _as_farmer(client)
    batch = _batch(client)
    before = _row(db_path, batch["id"])

    response = _patch(client, batch["id"], {field: value})

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]
    assert _row(db_path, batch["id"]) == before


@pytest.mark.parametrize("field", ["batch_id", "batch_code", "status", "current_status", "id", "created_at"])
def test_identifiers_and_status_cannot_be_changed(client, db_path, field):
    _as_farmer(client)
    batch = _batch(client)
    before = _row(db_path, batch["id"])

    response = _patch(client, batch["id"], {field: "anything", "description": "Still fine"})

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]
    assert _row(db_path, batch["id"]) == before


@pytest.mark.parametrize("body", [{}, {"description": 42}, {"description": "x" * 501}, [], "text"])
def test_invalid_edit_bodies_are_rejected(client, db_path, body):
    _as_farmer(client)
    batch = _batch(client)
    before = _row(db_path, batch["id"])

    response = _patch(client, batch["id"], body)

    assert response.status_code == 400
    assert _row(db_path, batch["id"]) == before


# --- Data integrity: history, ledger, shipments and receipts ------------------------------


def _ship_and_receive(client, batch_id):
    client.delete("/api/session")
    sign_in(client, "distributor")
    for status, prefix in (("Shipped", "shipA"), ("In Transit", "shipB")):
        step = client.post(
            "/api/shipments",
            json={"batch_id": batch_id, "status": status},
            headers={"Idempotency-Key": _key(prefix)},
        )
        assert step.status_code == 201
    shipped = client.post(
        "/api/shipments",
        json={"batch_id": batch_id, "status": "Delivered to Retailer", "note": "Delivered in full."},
        headers={"Idempotency-Key": _key("ship")},
    )
    assert shipped.status_code == 201
    client.delete("/api/session")
    sign_in(client, "retailer")
    received = client.post(
        "/api/receipts",
        json={"batch_id": batch_id},
        headers={"Idempotency-Key": _key("recv")},
    )
    assert received.status_code == 201
    client.delete("/api/session")
    _as_farmer(client)


def test_edit_adds_no_ledger_block_and_rewrites_no_block(client, db_path):
    _as_farmer(client)
    batch = _batch(client)
    before = _ledger_state(client)

    _patch(client, batch["id"], {"description": "Only the description changes"})

    assert _ledger_state(client) == before
    assert client.get("/api/ledger/verify").get_json()["result"] == "valid"


def test_edit_adds_no_history_event(client):
    _as_farmer(client)
    batch = _batch(client)
    before = _history(client, batch["batch_id"])

    _patch(client, batch["id"], {"description": "Another note"})

    assert _history(client, batch["batch_id"]) == before


def test_edit_keeps_shipment_and_receipt_records_intact(client, db_path):
    _as_farmer(client)
    batch = _batch(client)
    _ship_and_receive(client, batch["batch_id"])
    before = _history(client, batch["batch_id"])
    events_before = _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events")

    _patch(client, batch["id"], {"description": "Edited after delivery"})

    assert _history(client, batch["batch_id"]) == before
    assert _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events") == events_before
    statuses = [event["status"] for event in before["events"]]
    assert "Received by Retailer" in statuses


def test_public_tracking_changes_only_the_description_after_an_edit(client, db_path):
    # BPT-110 shows the product description on the public page, so an edit now changes that one field.
    # The events, the status and every other batch field must stay exactly as they were.
    _as_farmer(client)
    batch = _batch(client)
    _ship_and_receive(client, batch["batch_id"])
    before = client.get(f"/api/tracking/{batch['batch_id']}").get_json()

    _as_farmer(client)
    _patch(client, batch["id"], {"description": "Updated product description"})
    after = client.get(f"/api/tracking/{batch['batch_id']}").get_json()

    assert after["events"] == before["events"]
    assert after["count"] == before["count"]
    assert {k: v for k, v in after["batch"].items() if k != "description"} == {
        k: v for k, v in before["batch"].items() if k != "description"
    }
    assert after["batch"]["description"] == "Updated product description"


def test_ledger_stays_valid_after_registration_edits_and_shipments(client):
    _as_farmer(client)
    batch = _batch(client)
    _patch(client, batch["id"], {"description": "Edit one"})
    _ship_and_receive(client, batch["batch_id"])
    _patch(client, batch["id"], {"description": "Edit two"})

    assert client.get("/api/ledger/verify").get_json()["result"] == "valid"


def test_edits_do_not_change_the_previous_batch_or_its_ledger(client, db_path):
    _as_farmer(client)
    first = _batch(client, key=_key("keep-a"))
    second = _batch(client, body=dict(VALID, product_name="Second"), key=_key("keep-b"))
    before = _row(db_path, first["id"])

    _patch(client, second["id"], {"description": "Only the second changes"})

    assert _row(db_path, first["id"]) == before
    assert _row(db_path, second["id"])["description"] == "Only the second changes"
