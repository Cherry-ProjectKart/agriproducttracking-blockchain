import sqlite3

import pytest

from app.db import init_db
from app.services.access_service import seed_demo_users
from app.services.batch_service import register_batch, validate_batch_input

KEY = "11111111-aaaa-4bbb-8ccc-000000000001"
OTHER_KEY = "22222222-aaaa-4bbb-8ccc-000000000002"

VALID = {
    "product_name": "Basmati Rice",
    "description": "Long-grain rice harvested in October.",
    "quantity": 250,
    "unit": "kg",
    "origin": "Green Valley Farm, Plot 4",
    "harvest_date": "2026-10-15",
}


def _select_role(client, role):
    return client.post("/api/session", json={"role": role})


def _as_farmer(client):
    response = _select_role(client, "farmer")
    assert response.status_code == 201


def _post(client, payload, key=KEY):
    headers = {} if key is None else {"Idempotency-Key": key}
    return client.post("/api/batches", json=payload, headers=headers)


def _scalar(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        conn.close()


def _rows(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _farmer_user_id(db_path):
    return _scalar(db_path, "SELECT id FROM users WHERE username = 'demo.farmer'")


# --- Registration: success and persistence ----------------------------------


def test_farmer_registers_valid_batch(client):
    _as_farmer(client)

    response = _post(client, VALID)

    assert response.status_code == 201
    batch = response.get_json()["batch"]
    assert batch["product_name"] == "Basmati Rice"
    assert batch["description"] == "Long-grain rice harvested in October."
    assert batch["quantity"] == 250.0
    assert batch["unit"] == "kg"
    assert batch["origin"] == "Green Valley Farm, Plot 4"
    assert batch["harvest_date"] == "2026-10-15"
    assert batch["current_status"] == "Registered"
    assert batch["created_at"]
    assert isinstance(batch["id"], int)


def test_response_does_not_expose_owner_or_batch_code(client):
    _as_farmer(client)

    batch = _post(client, VALID).get_json()["batch"]

    assert "created_by" not in batch
    assert "batch_code" not in batch


def test_registered_batch_is_persisted_with_registration_event(client, db_path):
    _as_farmer(client)

    batch_id = _post(client, VALID).get_json()["batch"]["id"]

    row = _rows(db_path, "SELECT * FROM product_batches WHERE id = ?", (batch_id,))[0]
    assert row["product_name"] == "Basmati Rice"
    assert row["description"] == "Long-grain rice harvested in October."
    assert row["quantity"] == 250.0
    assert row["unit"] == "kg"
    assert row["origin"] == "Green Valley Farm, Plot 4"
    assert row["harvest_date"] == "2026-10-15"
    assert row["current_status"] == "Registered"
    assert row["created_by"] == _farmer_user_id(db_path)
    assert row["client_request_id"] == KEY
    assert row["batch_code"] is None  # assigned by US-03, not this story
    assert row["created_at"]

    events = _rows(db_path, "SELECT * FROM supply_chain_events WHERE batch_id = ?", (batch_id,))
    assert len(events) == 1
    assert events[0]["event_type"] == "PRODUCT_REGISTERED"
    assert events[0]["actor_role"] == "farmer"
    assert events[0]["status"] == "Registered"


def test_optional_description_may_be_omitted(client, db_path):
    _as_farmer(client)
    payload = {key: value for key, value in VALID.items() if key != "description"}

    response = _post(client, payload)

    assert response.status_code == 201
    assert response.get_json()["batch"]["description"] is None
    assert _scalar(db_path, "SELECT description IS NULL FROM product_batches") == 1


def test_client_cannot_set_owner_or_status(client, db_path):
    _as_farmer(client)
    payload = dict(VALID, created_by=999, current_status="Shipped", role="retailer")

    response = _post(client, payload)

    assert response.status_code == 201
    assert response.get_json()["batch"]["current_status"] == "Registered"
    assert _scalar(db_path, "SELECT created_by FROM product_batches") == _farmer_user_id(db_path)


def test_decimal_quantity_is_accepted(client, db_path):
    _as_farmer(client)

    response = _post(client, dict(VALID, quantity="12.5"))

    assert response.status_code == 201
    assert _scalar(db_path, "SELECT quantity FROM product_batches") == 12.5


def test_leap_day_is_a_valid_harvest_date(client):
    _as_farmer(client)

    response = _post(client, dict(VALID, harvest_date="2028-02-29"))

    assert response.status_code == 201


def test_validation_failure_persists_nothing(client, db_path):
    _as_farmer(client)

    _post(client, dict(VALID, quantity=0))

    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0
    assert _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events") == 0


# --- Validation ----------------------------------------------------------------


@pytest.mark.parametrize("field", ["product_name", "unit", "origin", "quantity", "harvest_date"])
def test_missing_required_field_is_rejected(client, field):
    _as_farmer(client)
    payload = {key: value for key, value in VALID.items() if key != field}

    response = _post(client, payload)

    assert response.status_code == 400
    error = response.get_json()["error"]
    assert error["code"] == 400
    assert field in error["details"]


@pytest.mark.parametrize("field", ["product_name", "unit", "origin", "harvest_date"])
@pytest.mark.parametrize("value", ["", "   ", None])
def test_blank_required_text_is_rejected(client, field, value):
    _as_farmer(client)

    response = _post(client, dict(VALID, **{field: value}))

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]


@pytest.mark.parametrize(
    ("field", "length"),
    [("product_name", 121), ("unit", 21), ("origin", 201), ("description", 501)],
)
def test_text_longer_than_limit_is_rejected(client, field, length):
    _as_farmer(client)

    response = _post(client, dict(VALID, **{field: "x" * length}))

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]


@pytest.mark.parametrize(
    "quantity",
    [0, -1, -2.5, True, [], "0", "-5", "+5", "1e3", "abc", "NaN", "Infinity", "", None],
)
def test_invalid_quantity_is_rejected(client, quantity):
    _as_farmer(client)

    response = _post(client, dict(VALID, quantity=quantity))

    assert response.status_code == 400
    assert "quantity" in response.get_json()["error"]["details"]


@pytest.mark.parametrize(
    "harvest_date",
    ["2026-02-30", "15-10-2026", "2026/10/15", "2026-1-5", "2026-10-15T00:00:00", "20261015", 20261015],
)
def test_invalid_harvest_date_is_rejected(client, harvest_date):
    _as_farmer(client)

    response = _post(client, dict(VALID, harvest_date=harvest_date))

    assert response.status_code == 400
    assert "harvest_date" in response.get_json()["error"]["details"]


def test_several_invalid_fields_are_reported_together(client):
    _as_farmer(client)

    response = _post(client, {"quantity": -1, "harvest_date": "bad"})

    details = response.get_json()["error"]["details"]
    assert {"product_name", "unit", "origin", "quantity", "harvest_date"} <= set(details)


def test_validate_batch_input_normalises_text(client):
    clean = validate_batch_input(dict(VALID, product_name="  Basmati Rice  ", description="   "))

    assert clean["product_name"] == "Basmati Rice"
    assert clean["description"] is None


def test_non_object_body_is_rejected(client):
    _as_farmer(client)

    response = client.post(
        "/api/batches", data="not json", content_type="text/plain", headers={"Idempotency-Key": KEY}
    )

    assert response.status_code == 400


# --- Idempotency ---------------------------------------------------------------


def test_missing_idempotency_key_is_rejected(client, db_path):
    _as_farmer(client)

    response = _post(client, VALID, key=None)

    assert response.status_code == 400
    assert "Idempotency-Key" in response.get_json()["error"]["message"]
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0


@pytest.mark.parametrize("key", ["short", "bad key!", "x" * 65, "under_score_key"])
def test_malformed_idempotency_key_is_rejected(client, key):
    _as_farmer(client)

    assert _post(client, VALID, key=key).status_code == 400


def test_repeated_submission_returns_original_batch_without_duplicate(client, db_path):
    _as_farmer(client)

    first = _post(client, VALID)
    second = _post(client, VALID)

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.get_json()["batch"]["id"] == first.get_json()["batch"]["id"]
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 1
    assert _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events") == 1


def test_same_key_with_different_details_is_a_conflict(client, db_path):
    _as_farmer(client)
    _post(client, VALID)

    response = _post(client, dict(VALID, quantity=999))

    assert response.status_code == 409
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 1


def test_same_key_from_another_farmer_is_a_conflict(client, db_path):
    _as_farmer(client)
    _post(client, VALID)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (display_name, username, role) VALUES ('Other Farmer', 'other.farmer', 'farmer')"
    )
    other_id = conn.execute("SELECT id FROM users WHERE username = 'other.farmer'").fetchone()[0]
    conn.commit()
    conn.close()
    with client.session_transaction() as session:
        session["demo_access"] = {"role": "farmer", "user_id": other_id, "display_name": "Other Farmer"}

    response = _post(client, VALID)

    assert response.status_code == 409
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 1


def test_register_batch_service_returns_existing_batch_for_repeated_key(db_path):
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    farmer_id = conn.execute("SELECT id FROM users WHERE username = 'demo.farmer'").fetchone()[0]
    clean = validate_batch_input(VALID)

    first, created_first = register_batch(conn, farmer_id, KEY, clean)
    second, created_second = register_batch(conn, farmer_id, KEY, clean)
    conn.close()

    assert created_first is True
    assert created_second is False
    assert second["id"] == first["id"]


# --- Role and session restrictions -----------------------------------------------


@pytest.mark.parametrize("role", ["distributor", "retailer"])
def test_other_roles_cannot_register_batches(client, db_path, role):
    _select_role(client, role)

    response = _post(client, VALID)

    assert response.status_code == 403
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0


def test_request_without_session_is_rejected(client, db_path):
    response = _post(client, VALID)

    assert response.status_code == 401
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0


def test_session_for_missing_user_is_rejected(client, db_path):
    with client.session_transaction() as session:
        session["demo_access"] = {"role": "farmer", "user_id": 9999, "display_name": "Ghost"}

    response = _post(client, VALID)

    assert response.status_code == 401
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches") == 0


def test_body_role_is_ignored_in_favour_of_session(client, db_path):
    _select_role(client, "distributor")

    response = _post(client, dict(VALID, role="farmer"))

    assert response.status_code == 403


def test_list_and_detail_require_farmer_role(client):
    _select_role(client, "distributor")
    assert client.get("/api/batches").status_code == 403
    assert client.get("/api/batches/1").status_code == 403

    _select_role(client, "retailer")
    assert client.get("/api/batches").status_code == 403

    client.delete("/api/session")
    assert client.get("/api/batches").status_code == 401
    assert client.get("/api/batches/1").status_code == 401


# --- Retrieval -----------------------------------------------------------------


def test_list_returns_only_the_farmers_batches_newest_first(app, client, db_path):
    _as_farmer(client)
    first_id = _post(client, VALID, key=KEY).get_json()["batch"]["id"]
    second_id = _post(client, dict(VALID, product_name="Wheat"), key=OTHER_KEY).get_json()["batch"]["id"]

    # A batch owned by a different farmer must not appear in this farmer's list.
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("INSERT INTO users (display_name, username, role) VALUES ('Other', 'other.farmer', 'farmer')")
    other_id = conn.execute("SELECT id FROM users WHERE username = 'other.farmer'").fetchone()[0]
    register_batch(conn, other_id, "33333333-aaaa-4bbb-8ccc-000000000003", validate_batch_input(VALID))
    conn.close()

    batches = client.get("/api/batches").get_json()["batches"]

    assert [batch["id"] for batch in batches] == [second_id, first_id]
    assert all(batch["product_name"] in {"Basmati Rice", "Wheat"} for batch in batches)


def test_list_is_empty_for_farmer_without_batches(client):
    _as_farmer(client)

    assert client.get("/api/batches").get_json() == {"batches": []}


def test_get_batch_returns_expected_data(client):
    _as_farmer(client)
    batch_id = _post(client, VALID).get_json()["batch"]["id"]

    response = client.get(f"/api/batches/{batch_id}")

    assert response.status_code == 200
    batch = response.get_json()["batch"]
    assert batch["id"] == batch_id
    assert batch["product_name"] == "Basmati Rice"
    assert batch["quantity"] == 250.0
    assert batch["origin"] == "Green Valley Farm, Plot 4"
    assert batch["harvest_date"] == "2026-10-15"
    assert batch["current_status"] == "Registered"
    assert "created_by" not in batch


def test_get_unknown_batch_returns_not_found(client):
    _as_farmer(client)

    response = client.get("/api/batches/424242")

    assert response.status_code == 404
    assert response.get_json()["error"]["message"] == "Batch not found."


def test_get_batch_owned_by_another_farmer_returns_not_found(client, db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("INSERT INTO users (display_name, username, role) VALUES ('Other', 'other.farmer', 'farmer')")
    other_id = conn.execute("SELECT id FROM users WHERE username = 'other.farmer'").fetchone()[0]
    batch, _ = register_batch(conn, other_id, KEY, validate_batch_input(VALID))
    conn.close()

    _as_farmer(client)

    assert client.get(f"/api/batches/{batch['id']}").status_code == 404


# --- Existing data and foundation behaviour ---------------------------------------


def test_existing_data_survives_reinitialisation(client, db_path):
    _as_farmer(client)
    batch_id = _post(client, VALID).get_json()["batch"]["id"]
    users_before = _rows(db_path, "SELECT id, username, role FROM users ORDER BY id")

    init_db(db_path)
    init_db(db_path)

    assert _rows(db_path, "SELECT id, username, role FROM users ORDER BY id") == users_before
    assert _scalar(db_path, "SELECT COUNT(*) FROM product_batches WHERE id = ?", (batch_id,)) == 1
    assert _scalar(db_path, "SELECT COUNT(*) FROM supply_chain_events WHERE batch_id = ?", (batch_id,)) == 1
    assert _scalar(db_path, "SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%'") == 3


def test_seed_demo_users_does_not_duplicate_accounts(db_path):
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    seed_demo_users(conn)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%'").fetchone()[0]
    conn.close()

    assert count == 3


def test_health_still_reports_ok_after_batch_changes(client):
    _as_farmer(client)
    _post(client, VALID)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json()["database"]["schema_initialized"] is True
