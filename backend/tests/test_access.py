import sqlite3

import pytest

from app.auth import require_role
from app.db import init_db
from app.models.roles import SUPPORTED_ROLES
from app.services.access_service import UnsupportedRoleError, validate_role
from tests.auth_helpers import DEMO_PASSWORDS, DEMO_USERNAMES, sign_in


# --- Role validation -------------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_supported_roles_are_accepted(role):
    assert validate_role(role) == role


@pytest.mark.parametrize("value", ["admin", "Farmer", " farmer", "", 123, ["farmer"], None])
def test_unsupported_roles_are_rejected(value):
    with pytest.raises(UnsupportedRoleError):
        validate_role(value)


def test_roles_endpoint_lists_three_roles_without_session(client):
    response = client.get("/api/roles")

    assert response.status_code == 200
    roles = response.get_json()["roles"]
    assert [item["key"] for item in roles] == list(SUPPORTED_ROLES)
    assert [item["label"] for item in roles] == ["Farmer", "Distributor", "Retailer"]
    assert all(item["description"] for item in roles)


# --- Session state ---------------------------------------------------------


def test_session_is_inactive_initially(client):
    response = client.get("/api/session")

    assert response.status_code == 200
    assert response.get_json() == {
        "active": False,
        "role": None,
        "role_label": None,
        "display_name": None,
        "username": None,
    }


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_signing_in_as_each_demo_account_starts_session_with_its_role(client, role):
    response = sign_in(client, role)

    assert response.status_code == 200
    body = response.get_json()
    assert body["active"] is True
    assert body["role"] == role
    assert body["username"] == DEMO_USERNAMES[role]
    assert body["display_name"].startswith("Demo ")

    state = client.get("/api/session").get_json()
    assert state["role"] == role


def test_session_cookie_is_http_only_and_same_site(client):
    response = sign_in(client, "farmer")

    cookie_header = response.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie_header
    assert "SameSite=Lax" in cookie_header


def test_session_cookie_has_a_lifetime(client):
    response = sign_in(client, "farmer")

    assert "Expires=" in response.headers.get("Set-Cookie", "")


def test_session_is_kept_across_requests(client):
    sign_in(client, "retailer")

    assert client.get("/api/session").get_json()["role"] == "retailer"
    assert client.get("/api/session").get_json()["role"] == "retailer"


def test_sign_in_does_not_accept_a_role_in_the_body(client):
    # A caller cannot choose a role. The role is whatever the account stores.
    response = client.post(
        "/api/session",
        json={"username": DEMO_USERNAMES["farmer"], "password": DEMO_PASSWORDS["farmer"], "role": "retailer"},
    )

    assert response.status_code == 200
    assert response.get_json()["role"] == "farmer"


def test_switching_accounts_replaces_the_previous_session(client):
    sign_in(client, "farmer")
    sign_in(client, "retailer")

    assert client.get("/api/session").get_json()["role"] == "retailer"


def test_sign_out_clears_the_session(client):
    sign_in(client, "distributor")

    response = client.delete("/api/session")

    assert response.status_code == 200
    assert response.get_json()["active"] is False
    assert client.get("/api/session").get_json()["active"] is False


def test_sign_out_is_idempotent_without_session(client):
    response = client.delete("/api/session")

    assert response.status_code == 200
    assert response.get_json()["active"] is False


def test_forged_session_cookie_is_not_accepted(client):
    client.set_cookie("session", "forged-value-without-valid-signature")

    response = client.get("/api/session")

    assert response.get_json()["active"] is False


def test_session_for_a_deleted_account_is_rejected(client, db_path):
    sign_in(client, "farmer")
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM users WHERE username = 'demo.farmer'")
    conn.commit()
    conn.close()

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/role-actions").status_code == 401


# --- Invalid sign-in -------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"username": "demo.farmer"},
        {"password": DEMO_PASSWORDS["farmer"]},
        {"username": "", "password": DEMO_PASSWORDS["farmer"]},
        {"username": "   ", "password": DEMO_PASSWORDS["farmer"]},
        {"username": "demo.farmer", "password": ""},
        {"username": 42, "password": DEMO_PASSWORDS["farmer"]},
        {"username": "demo.farmer", "password": ["x"]},
    ],
)
def test_incomplete_sign_in_is_rejected_with_field_errors(client, payload):
    response = client.post("/api/session", json=payload)

    assert response.status_code == 400
    assert response.get_json()["error"]["details"]
    assert client.get("/api/session").get_json()["active"] is False


def test_non_object_sign_in_body_is_rejected(client):
    response = client.post("/api/session", data="demo.farmer", content_type="text/plain")

    assert response.status_code == 400


def test_wrong_password_and_unknown_username_get_the_same_message(client):
    wrong_password = client.post(
        "/api/session", json={"username": "demo.farmer", "password": "WrongPassword1"}
    )
    unknown_user = client.post(
        "/api/session", json={"username": "nobody.here", "password": "WrongPassword1"}
    )

    assert wrong_password.status_code == 401
    assert unknown_user.status_code == 401
    assert wrong_password.get_json()["error"]["message"] == unknown_user.get_json()["error"]["message"]
    assert client.get("/api/session").get_json()["active"] is False


# --- Server-side role enforcement -----------------------------------------


def test_role_actions_requires_sign_in(client):
    response = client.get("/api/role-actions")

    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == 401


@pytest.mark.parametrize(
    ("role", "expected_action_key", "expected_available"),
    [
        ("farmer", "register_batch", True),  # available from BPT-003 (US-02)
        ("distributor", "record_shipment", True),  # available from BPT-006 (US-05)
        ("retailer", "confirm_receipt", True),  # available from BPT-007 (US-06)
    ],
)
def test_role_actions_returns_actions_for_signed_in_role(client, role, expected_action_key, expected_available):
    sign_in(client, role)

    response = client.get("/api/role-actions")

    assert response.status_code == 200
    body = response.get_json()
    assert body["role"] == role
    assert [action["key"] for action in body["actions"]] == [expected_action_key]
    assert [action["available"] for action in body["actions"]] == [expected_available]


def test_role_actions_is_unauthorised_after_sign_out(client):
    sign_in(client, "farmer")
    client.delete("/api/session")

    assert client.get("/api/role-actions").status_code == 401


def test_require_role_rejects_wrong_role_and_allows_matching_role(app, client):
    @app.route("/api/test-retailer-only")
    @require_role("retailer")
    def retailer_only():
        return {"ok": True}

    assert client.get("/api/test-retailer-only").status_code == 401

    sign_in(client, "farmer")
    wrong = client.get("/api/test-retailer-only")
    assert wrong.status_code == 403
    assert wrong.get_json()["error"]["code"] == 403

    sign_in(client, "retailer")
    assert client.get("/api/test-retailer-only").status_code == 200


def test_require_role_uses_the_role_stored_in_the_database(app, client, db_path):
    @app.route("/api/test-farmer-only")
    @require_role("farmer")
    def farmer_only():
        return {"ok": True}

    sign_in(client, "farmer")
    assert client.get("/api/test-farmer-only").status_code == 200

    # The session stores only the account id. Changing the stored role changes what the session may do.
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET role = 'retailer' WHERE username = 'demo.farmer'")
    conn.commit()
    conn.close()

    assert client.get("/api/test-farmer-only").status_code == 403
    assert client.get("/api/session").get_json()["role"] == "retailer"


def test_require_role_rejects_misconfiguration_at_definition_time():
    with pytest.raises(ValueError):
        require_role()
    with pytest.raises(ValueError):
        require_role("admin")


# --- Demo accounts and initialisation -------------------------------------


def test_demo_accounts_are_seeded_into_users_table(db_path):
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT username, role, display_name FROM users WHERE username LIKE 'demo.%' ORDER BY role"
    ).fetchall()
    conn.close()

    assert rows == [
        ("demo.distributor", "distributor", "Demo Distributor"),
        ("demo.farmer", "farmer", "Demo Farmer"),
        ("demo.retailer", "retailer", "Demo Retailer"),
    ]


def test_seeding_is_idempotent(db_path):
    init_db(db_path)
    init_db(db_path)

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%'").fetchone()[0]
    conn.close()
    assert count == 3
