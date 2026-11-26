import sqlite3

import pytest

from app.auth import require_role
from app.db import init_db
from app.models.roles import SUPPORTED_ROLES
from app.services.access_service import UnsupportedRoleError, validate_role


def _select_role(client, role):
    return client.post("/api/session", json={"role": role})


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


# --- Session start / state / exit -----------------------------------------


def test_session_is_inactive_initially(client):
    response = client.get("/api/session")

    assert response.status_code == 200
    assert response.get_json() == {
        "active": False,
        "role": None,
        "role_label": None,
        "display_name": None,
    }


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_selecting_each_supported_role_starts_session(client, role):
    response = _select_role(client, role)

    assert response.status_code == 201
    body = response.get_json()
    assert body["active"] is True
    assert body["role"] == role
    assert body["role_label"] in {"Farmer", "Distributor", "Retailer"}
    assert body["display_name"].startswith("Demo ")

    state = client.get("/api/session").get_json()
    assert state["role"] == role


@pytest.mark.parametrize(
    "payload",
    [
        {"role": "admin"},
        {"role": "Farmer"},
        {"role": ""},
        {"role": 42},
        {"role": ["farmer"]},
        {},
        {"other": "farmer"},
    ],
)
def test_invalid_role_payloads_are_rejected(client, payload):
    response = client.post("/api/session", json=payload)

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == 400
    assert client.get("/api/session").get_json()["active"] is False


def test_missing_role_message_is_clear(client):
    response = client.post("/api/session", json={})

    assert response.get_json()["error"]["message"] == "A role is required."


def test_non_object_body_is_rejected(client):
    response = client.post("/api/session", data="farmer", content_type="text/plain")

    assert response.status_code == 400


def test_switching_role_replaces_previous_role(client):
    _select_role(client, "farmer")
    _select_role(client, "retailer")

    assert client.get("/api/session").get_json()["role"] == "retailer"


def test_session_fails_clearly_when_demo_accounts_are_missing(app, client, db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM users WHERE username LIKE 'demo.%'")
    conn.commit()
    conn.close()

    response = _select_role(client, "farmer")

    assert response.status_code == 503
    assert client.get("/api/session").get_json()["active"] is False


def test_exit_clears_active_session(client):
    _select_role(client, "distributor")

    response = client.delete("/api/session")

    assert response.status_code == 200
    assert response.get_json()["active"] is False
    assert client.get("/api/session").get_json()["active"] is False


def test_exit_is_idempotent_without_session(client):
    response = client.delete("/api/session")

    assert response.status_code == 200
    assert response.get_json()["active"] is False


def test_forged_session_cookie_is_not_accepted(client):
    client.set_cookie("session", "forged-value-without-valid-signature")

    response = client.get("/api/session")

    assert response.get_json()["active"] is False


def test_session_cookie_is_http_only_and_same_site(client):
    response = _select_role(client, "farmer")

    cookie_header = response.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie_header
    assert "SameSite=Lax" in cookie_header


# --- Server-side role enforcement -----------------------------------------


def test_role_actions_requires_active_session(client):
    response = client.get("/api/role-actions")

    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == 401


@pytest.mark.parametrize(
    ("role", "expected_action_key", "expected_available"),
    [
        ("farmer", "register_batch", True),  # available from BPT-003 (US-02)
        ("distributor", "record_shipment", True),  # available from BPT-006 (US-05)
        ("retailer", "confirm_receipt", False),
    ],
)
def test_role_actions_returns_actions_for_active_role(client, role, expected_action_key, expected_available):
    _select_role(client, role)

    response = client.get("/api/role-actions")

    assert response.status_code == 200
    body = response.get_json()
    assert body["role"] == role
    assert [action["key"] for action in body["actions"]] == [expected_action_key]
    assert [action["available"] for action in body["actions"]] == [expected_available]


def test_role_actions_is_unauthorised_after_exit(client):
    _select_role(client, "farmer")
    client.delete("/api/session")

    assert client.get("/api/role-actions").status_code == 401


def test_require_role_rejects_wrong_role_and_allows_matching_role(app, client):
    @app.route("/api/test-retailer-only")
    @require_role("retailer")
    def retailer_only():
        return {"ok": True}

    assert client.get("/api/test-retailer-only").status_code == 401

    _select_role(client, "farmer")
    wrong = client.get("/api/test-retailer-only")
    assert wrong.status_code == 403
    assert wrong.get_json()["error"]["code"] == 403

    _select_role(client, "retailer")
    assert client.get("/api/test-retailer-only").status_code == 200


def test_require_role_rejects_misconfiguration_at_definition_time():
    with pytest.raises(ValueError):
        require_role()
    with pytest.raises(ValueError):
        require_role("admin")


# --- Sample accounts and initialisation -----------------------------------


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
