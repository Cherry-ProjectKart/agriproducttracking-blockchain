"""Profile, preferences and password for the signed-in account (BPT-104)."""

import sqlite3

import pytest
from werkzeug.security import check_password_hash

from app.db import init_db
from tests.auth_helpers import DEMO_PASSWORDS, DEMO_USERNAMES, sign_in

ROLES = ("farmer", "distributor", "retailer")
PROFILE_KEYS = {"username", "full_name", "role", "role_label", "created_at", "updated_at", "grid_density"}
NEW_PASSWORD = "BrandNew2027"


def _register(client, username, role="farmer", password="Sunrise2026"):
    client.delete("/api/session")
    response = client.post(
        "/api/accounts",
        json={
            "full_name": f"Person {username}",
            "username": username,
            "password": password,
            "confirm_password": password,
            "role": role,
        },
    )
    assert response.status_code == 201
    client.delete("/api/session")
    return response


def _stored_hash(db_path, username):
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT password_hash FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row[0]


def _user_id(db_path, username):
    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row[0]


# --- Reading the own profile -------------------------------------------------------


@pytest.mark.parametrize("role", ROLES)
def test_each_role_retrieves_its_own_profile(client, role):
    sign_in(client, role)

    response = client.get("/api/account")

    assert response.status_code == 200
    account = response.get_json()["account"]
    assert set(account) == PROFILE_KEYS
    assert account["username"] == DEMO_USERNAMES[role]
    assert account["role"] == role
    assert account["full_name"].startswith("Demo ")
    assert account["created_at"]
    assert account["grid_density"] == "comfortable"


def test_profile_never_exposes_hash_session_or_internal_ids(client):
    sign_in(client, "farmer")

    text = client.get("/api/account").get_data(as_text=True)

    for forbidden in ("password", "scrypt", "password_hash", "session", "user_id", '"id"', "status", "demo_access", "account_session"):
        assert forbidden not in text, forbidden


def test_profile_shows_the_role_as_read_only_label(client):
    sign_in(client, "retailer")

    account = client.get("/api/account").get_json()["account"]

    assert account["role_label"] == "Retailer"


def test_profile_requires_a_session(client):
    response = client.get("/api/account")

    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == 401


# --- Updating the own profile --------------------------------------------------------


@pytest.mark.parametrize("role", ROLES)
def test_each_role_updates_its_own_full_name(client, role):
    sign_in(client, role)

    response = client.patch("/api/account", json={"full_name": "  Renamed Person  "})

    assert response.status_code == 200
    assert response.get_json()["account"]["full_name"] == "Renamed Person"
    assert client.get("/api/session").get_json()["display_name"] == "Renamed Person"


def test_username_is_changed_lower_case_and_the_new_name_signs_in(client, db_path):
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={"username": "  Demo.Grower  "})

    assert response.status_code == 200
    assert response.get_json()["account"]["username"] == "demo.grower"
    client.delete("/api/session")
    assert client.post("/api/session", json={"username": "demo.grower", "password": DEMO_PASSWORDS["farmer"]}).status_code == 200
    assert client.post("/api/session", json={"username": "demo.farmer", "password": DEMO_PASSWORDS["farmer"]}).status_code == 401


def test_keeping_your_own_username_is_not_a_duplicate(client):
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={"username": "DEMO.FARMER"})

    assert response.status_code == 200


def test_updated_at_moves_forward_after_a_change(client):
    sign_in(client, "distributor")
    before = client.get("/api/account").get_json()["account"]["updated_at"]

    client.patch("/api/account", json={"full_name": "Changed Name"})

    after = client.get("/api/account").get_json()["account"]["updated_at"]
    assert after is not None and after != before


# --- Duplicates and validation ---------------------------------------------------------


def test_taken_username_is_rejected_in_any_letter_case(client):
    _register(client, "asha.grower")
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={"username": "ASHA.Grower"})

    assert response.status_code == 409
    assert response.get_json()["error"]["details"]["username"]
    assert client.get("/api/account").get_json()["account"]["username"] == "demo.farmer"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"full_name": ""}, "full_name"),
        ({"full_name": "   "}, "full_name"),
        ({"full_name": 42}, "full_name"),
        ({"full_name": "A"}, "full_name"),
        ({"full_name": "x" * 81}, "full_name"),
        ({"username": ""}, "username"),
        ({"username": "ab"}, "username"),
        ({"username": "has space"}, "username"),
        ({"username": None}, "username"),
    ],
)
def test_invalid_profile_fields_get_field_errors(client, payload, field):
    sign_in(client, "retailer")

    response = client.patch("/api/account", json=payload)

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]


def test_empty_update_is_rejected(client):
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={})

    assert response.status_code == 400
    assert response.get_json()["error"]["message"] == "Change at least one field."


def test_non_object_body_is_rejected(client):
    sign_in(client, "farmer")

    response = client.patch("/api/account", data="Renamed", content_type="text/plain")

    assert response.status_code == 400


# --- Role cannot be changed through profile editing ------------------------------------


@pytest.mark.parametrize("role", ROLES)
def test_role_change_through_profile_is_rejected_for_every_role(client, db_path, role):
    sign_in(client, role)
    other = "farmer" if role != "farmer" else "retailer"

    response = client.patch("/api/account", json={"role": other, "full_name": "Sneaky Change"})

    assert response.status_code == 400
    assert "role" in response.get_json()["error"]["details"]
    conn = sqlite3.connect(db_path)
    stored_role = conn.execute("SELECT role FROM users WHERE username = ?", (DEMO_USERNAMES[role],)).fetchone()[0]
    stored_name = conn.execute("SELECT display_name FROM users WHERE username = ?", (DEMO_USERNAMES[role],)).fetchone()[0]
    conn.close()
    assert stored_role == role
    assert stored_name != "Sneaky Change"


@pytest.mark.parametrize("field", ["id", "user_id", "status", "password_hash", "created_at", "grid_density_admin"])
def test_unlisted_fields_are_rejected_not_silently_ignored(client, field):
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={"full_name": "Fine Name", field: "x"})

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]


# --- Ownership: no way to reach another account ---------------------------------------


def test_another_users_profile_cannot_be_read_by_changing_an_id(client, db_path):
    _register(client, "other.grower")
    other_id = _user_id(db_path, "other.grower")
    sign_in(client, "farmer")

    for url in (f"/api/account?id={other_id}", f"/api/account/{other_id}", f"/api/account?user_id={other_id}"):
        response = client.get(url)
        if response.status_code == 200:
            assert response.get_json()["account"]["username"] == "demo.farmer", url
        else:
            assert response.status_code == 404, url


def test_another_users_profile_cannot_be_changed_by_sending_an_id(client, db_path):
    _register(client, "other.grower")
    other_id = _user_id(db_path, "other.grower")
    sign_in(client, "farmer")

    response = client.patch("/api/account", json={"id": other_id, "full_name": "Hijacked"})

    assert response.status_code == 400
    conn = sqlite3.connect(db_path)
    name = conn.execute("SELECT display_name FROM users WHERE id = ?", (other_id,)).fetchone()[0]
    conn.close()
    assert name == "Person other.grower"


def test_profile_changes_touch_only_the_signed_in_account(client, db_path):
    _register(client, "other.grower")
    sign_in(client, "farmer")
    client.patch("/api/account", json={"full_name": "Only Me"})
    client.delete("/api/session")

    sign_in(client, "retailer")

    assert client.get("/api/account").get_json()["account"]["full_name"] == "Demo Retailer"
    conn = sqlite3.connect(db_path)
    other = conn.execute("SELECT display_name FROM users WHERE username = 'other.grower'").fetchone()[0]
    conn.close()
    assert other == "Person other.grower"


# --- Preferences ------------------------------------------------------------------------


def test_grid_density_preference_is_saved_and_returned(client):
    sign_in(client, "farmer")

    response = client.patch("/api/account/preferences", json={"grid_density": "compact"})

    assert response.status_code == 200
    assert response.get_json()["account"]["grid_density"] == "compact"
    assert client.get("/api/account").get_json()["account"]["grid_density"] == "compact"


def test_preferences_are_isolated_per_user(client, db_path):
    _register(client, "other.grower")
    sign_in(client, "farmer")
    client.patch("/api/account/preferences", json={"grid_density": "compact"})
    client.delete("/api/session")

    sign_in(client, "distributor")
    assert client.get("/api/account").get_json()["account"]["grid_density"] == "comfortable"
    client.delete("/api/session")

    client.post("/api/session", json={"username": "other.grower", "password": "Sunrise2026"})
    assert client.get("/api/account").get_json()["account"]["grid_density"] == "comfortable"


@pytest.mark.parametrize("role", ROLES)
def test_each_role_can_save_its_preference(client, role):
    sign_in(client, role)

    assert client.patch("/api/account/preferences", json={"grid_density": "compact"}).status_code == 200
    assert client.patch("/api/account/preferences", json={"grid_density": "comfortable"}).status_code == 200


@pytest.mark.parametrize("value", ["dense", "COMPACT", "", None, 3, ["compact"]])
def test_invalid_density_values_are_rejected(client, value):
    sign_in(client, "farmer")

    response = client.patch("/api/account/preferences", json={"grid_density": value})

    assert response.status_code == 400
    assert "grid_density" in response.get_json()["error"]["details"]


def test_other_settings_cannot_be_written_through_preferences(client):
    sign_in(client, "farmer")

    response = client.patch("/api/account/preferences", json={"grid_density": "compact", "role": "retailer"})

    assert response.status_code == 400
    assert client.get("/api/session").get_json()["role"] == "farmer"


def test_preferences_require_a_session(client):
    response = client.patch("/api/account/preferences", json={"grid_density": "compact"})

    assert response.status_code == 401


# --- Password change --------------------------------------------------------------------


def _change(client, **overrides):
    body = {
        "current_password": DEMO_PASSWORDS["farmer"],
        "new_password": NEW_PASSWORD,
        "confirm_password": NEW_PASSWORD,
    }
    body.update(overrides)
    return client.post("/api/account/password", json=body)


def test_password_change_requires_the_correct_current_password(client, db_path):
    sign_in(client, "farmer")
    before = _stored_hash(db_path, "demo.farmer")

    response = _change(client, current_password="NotMyPassword1")

    assert response.status_code == 400
    assert response.get_json()["error"]["details"]["current_password"] == "Your current password is incorrect."
    assert _stored_hash(db_path, "demo.farmer") == before


def test_password_change_succeeds_and_the_new_password_signs_in(client, db_path):
    sign_in(client, "farmer")

    response = _change(client)

    assert response.status_code == 200
    assert response.get_json()["message"] == "Your password has been changed."
    client.delete("/api/session")
    assert client.post("/api/session", json={"username": "demo.farmer", "password": NEW_PASSWORD}).status_code == 200
    assert client.post("/api/session", json={"username": "demo.farmer", "password": DEMO_PASSWORDS["farmer"]}).status_code == 401


def test_new_password_is_stored_only_as_a_hash(client, db_path):
    sign_in(client, "farmer")

    _change(client)

    stored = _stored_hash(db_path, "demo.farmer")
    assert stored.startswith("scrypt:")
    assert NEW_PASSWORD not in stored
    assert check_password_hash(stored, NEW_PASSWORD)


def test_password_change_response_never_contains_a_password_or_hash(client, db_path):
    sign_in(client, "farmer")

    text = _change(client).get_data(as_text=True)

    assert NEW_PASSWORD not in text
    assert DEMO_PASSWORDS["farmer"] not in text
    assert _stored_hash(db_path, "demo.farmer") not in text


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"current_password": ""}, "current_password"),
        ({"new_password": ""}, "new_password"),
        ({"confirm_password": ""}, "confirm_password"),
        ({"new_password": "short1", "confirm_password": "short1"}, "new_password"),
        ({"new_password": "allletters", "confirm_password": "allletters"}, "new_password"),
        ({"confirm_password": "Different2027"}, "confirm_password"),
        ({"new_password": DEMO_PASSWORDS["farmer"], "confirm_password": DEMO_PASSWORDS["farmer"]}, "new_password"),
    ],
)
def test_password_change_validation(client, overrides, field):
    sign_in(client, "farmer")

    response = _change(client, **overrides)

    assert response.status_code == 400
    assert field in response.get_json()["error"]["details"]


def test_password_change_rejects_a_non_object_body(client):
    sign_in(client, "farmer")

    response = client.post("/api/account/password", data="x", content_type="text/plain")

    assert response.status_code == 400


def test_password_change_requires_a_session(client):
    response = _change(client)

    assert response.status_code == 401


def test_password_change_cannot_change_another_account(client, db_path):
    _register(client, "other.grower", password="OtherPass2026")
    other_hash = _stored_hash(db_path, "other.grower")
    sign_in(client, "farmer")

    _change(client, username="other.grower", user_id=_user_id(db_path, "other.grower"))

    assert _stored_hash(db_path, "other.grower") == other_hash


def test_session_stays_valid_after_a_password_change(client):
    sign_in(client, "farmer")

    _change(client)

    assert client.get("/api/account").status_code == 200


# --- Migration of an existing database ----------------------------------------------------


def test_existing_database_gains_grid_density_with_its_default(db_path):
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('farmer', 'distributor', 'retailer')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            password_hash TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            updated_at TEXT
        );
        INSERT INTO users (id, display_name, username, role) VALUES (9, 'Kept Farmer', 'kept.farmer', 'farmer');
        """
    )
    conn.commit()
    conn.close()

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT display_name, grid_density FROM users WHERE id = 9").fetchone()
    conn.close()
    assert row == ("Kept Farmer", "comfortable")


def test_signed_in_session_reports_the_saved_density_for_the_app(client):
    sign_in(client, "retailer")
    client.patch("/api/account/preferences", json={"grid_density": "compact"})

    state = client.get("/api/session").get_json()

    assert state["active"] is True
    assert state["grid_density"] == "compact"


def test_signed_out_session_reports_no_account_details(client):
    state = client.get("/api/session").get_json()

    assert "grid_density" not in state
    assert state["username"] is None
