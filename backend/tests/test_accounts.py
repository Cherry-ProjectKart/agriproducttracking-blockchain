"""Registration, sign-in, sign-out, password hashing and demo accounts (BPT-101)."""

import sqlite3
import time

import pytest
from werkzeug.security import check_password_hash

from app.auth import SESSION_KEY
from app.db import init_db
from app.services import account_service
from app.services.access_service import demo_accounts_missing_password, seed_demo_users
from tests.auth_helpers import DEMO_PASSWORDS, DEMO_USERNAMES, sign_in

PASSWORD = "Sunrise2026"


def _registration(**overrides):
    body = {
        "full_name": "Asha Farmer",
        "username": "asha.farmer",
        "password": PASSWORD,
        "confirm_password": PASSWORD,
        "role": "farmer",
    }
    body.update(overrides)
    return body


def _register(client, **overrides):
    return client.post("/api/accounts", json=_registration(**overrides))


def _row(db_path, username):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return row


def _count(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    value = conn.execute(sql, params).fetchone()[0]
    conn.close()
    return value


# --- Registration: success -------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_each_role_can_register(client, db_path, role):
    response = _register(client, username=f"new.{role}", role=role, full_name="New Person")

    assert response.status_code == 201
    body = response.get_json()
    assert body["active"] is True
    assert body["role"] == role
    assert body["username"] == f"new.{role}"
    assert body["display_name"] == "New Person"
    assert _row(db_path, f"new.{role}")["role"] == role


def test_registration_signs_the_new_account_in(client):
    _register(client)

    state = client.get("/api/session").get_json()

    assert state["active"] is True
    assert state["role"] == "farmer"


def test_registration_stores_a_hash_and_never_the_password(client, db_path):
    _register(client)

    row = _row(db_path, "asha.farmer")

    assert row["password_hash"] != PASSWORD
    assert PASSWORD not in row["password_hash"]
    assert row["password_hash"].startswith("scrypt:")
    assert check_password_hash(row["password_hash"], PASSWORD)
    assert row["status"] == "active"
    assert row["created_at"] and row["updated_at"]


def test_username_is_stored_lower_case_and_trimmed(client, db_path):
    response = _register(client, username="  Asha.Farmer  ")

    assert response.status_code == 201
    assert response.get_json()["username"] == "asha.farmer"
    assert _row(db_path, "asha.farmer") is not None


def test_full_name_is_trimmed(client, db_path):
    _register(client, full_name="   Asha Farmer   ")

    assert _row(db_path, "asha.farmer")["display_name"] == "Asha Farmer"


# --- Registration: validation ----------------------------------------------


@pytest.mark.parametrize(
    ("field", "value", "expected_key"),
    [
        ("full_name", "", "full_name"),
        ("full_name", "   ", "full_name"),
        ("full_name", "A", "full_name"),
        ("full_name", "x" * 81, "full_name"),
        ("username", "", "username"),
        ("username", "ab", "username"),
        ("username", "a" * 33, "username"),
        ("username", "1bad name", "username"),
        ("username", "has space", "username"),
        ("username", "-starts-with-dash", "username"),
        ("username", "bad@mail", "username"),
        ("password", "", "password"),
        ("password", "short1", "password"),
        ("password", "allletters", "password"),
        ("password", "12345678", "password"),
        ("password", "p" * 129, "password"),
        ("confirm_password", "", "confirm_password"),
        ("confirm_password", "Different2026", "confirm_password"),
        ("role", "admin", "role"),
        ("role", "consumer", "role"),
        ("role", "Farmer", "role"),
        ("role", "", "role"),
        ("role", None, "role"),
        ("role", ["farmer"], "role"),
    ],
)
def test_invalid_registration_fields_are_rejected_with_field_errors(client, db_path, field, value, expected_key):
    response = _register(client, **{field: value})

    assert response.status_code == 400
    error = response.get_json()["error"]
    assert expected_key in error["details"]
    assert _count(db_path, "SELECT COUNT(*) FROM users WHERE username = 'asha.farmer'") == 0


def test_missing_fields_are_all_reported(client):
    response = client.post("/api/accounts", json={})

    assert response.status_code == 400
    details = response.get_json()["error"]["details"]
    assert set(details) == {"full_name", "username", "password", "confirm_password", "role"}


def test_non_object_registration_body_is_rejected(client):
    response = client.post("/api/accounts", data="farmer", content_type="text/plain")

    assert response.status_code == 400


def test_password_mismatch_message_is_clear(client):
    response = _register(client, confirm_password="Different2026")

    assert response.get_json()["error"]["details"]["confirm_password"] == "The passwords do not match."


def test_validation_errors_never_echo_the_password(client):
    response = _register(client, password="short", confirm_password="short")

    assert "short" not in response.get_data(as_text=True)


def test_consumer_cannot_register_as_a_role(client):
    response = _register(client, role="consumer")

    assert response.status_code == 400
    assert "role" in response.get_json()["error"]["details"]


# --- Registration: duplicates -----------------------------------------------


def test_duplicate_username_is_rejected(client, db_path):
    _register(client)
    client.delete("/api/session")

    response = _register(client, full_name="Someone Else", role="retailer")

    assert response.status_code == 409
    assert response.get_json()["error"]["details"]["username"]
    assert _count(db_path, "SELECT COUNT(*) FROM users WHERE username = 'asha.farmer'") == 1


def test_duplicate_username_check_ignores_letter_case(client, db_path):
    _register(client)
    client.delete("/api/session")

    response = _register(client, username="ASHA.FARMER")

    assert response.status_code == 409
    assert _count(db_path, "SELECT COUNT(*) FROM users WHERE username = 'asha.farmer'") == 1


def test_username_of_a_demo_account_is_taken(client):
    response = _register(client, username="demo.farmer")

    assert response.status_code == 409


def test_duplicate_registration_does_not_replace_the_existing_session(client):
    _register(client)

    _register(client, username="asha.farmer", role="retailer")

    assert client.get("/api/session").get_json()["role"] == "farmer"


# --- Password hashing --------------------------------------------------------


def test_hash_password_produces_a_salted_hash_that_verifies():
    first = account_service.hash_password(PASSWORD)
    second = account_service.hash_password(PASSWORD)

    assert first != second
    assert check_password_hash(first, PASSWORD)
    assert not check_password_hash(first, "WrongPassword1")


def test_product_hash_method_is_werkzeugs_salted_scrypt_default():
    # The test fixture lowers the cost, so check the library default that the product setting names.
    from werkzeug.security import generate_password_hash

    assert generate_password_hash(PASSWORD).startswith("scrypt:")


# --- Sign-in ------------------------------------------------------------------


def test_sign_in_with_username_and_password_succeeds(client):
    _register(client)
    client.delete("/api/session")

    response = client.post("/api/session", json={"username": "asha.farmer", "password": PASSWORD})

    assert response.status_code == 200
    assert response.get_json()["role"] == "farmer"


def test_sign_in_username_is_case_insensitive(client):
    _register(client)
    client.delete("/api/session")

    response = client.post("/api/session", json={"username": "  ASHA.Farmer ", "password": PASSWORD})

    assert response.status_code == 200


def test_sign_in_with_wrong_password_is_rejected(client):
    _register(client)
    client.delete("/api/session")

    response = client.post("/api/session", json={"username": "asha.farmer", "password": "WrongPassword1"})

    assert response.status_code == 401
    assert response.get_json()["error"]["message"] == "Username or password is incorrect."
    assert client.get("/api/session").get_json()["active"] is False


def test_sign_in_with_unknown_username_is_rejected_generically(client):
    response = client.post("/api/session", json={"username": "nobody", "password": PASSWORD})

    assert response.status_code == 401
    assert response.get_json()["error"]["message"] == "Username or password is incorrect."


def test_sign_in_error_never_echoes_the_password(client):
    response = client.post("/api/session", json={"username": "nobody", "password": "SecretValue9"})

    assert "SecretValue9" not in response.get_data(as_text=True)


def test_sign_in_to_a_disabled_account_is_refused_after_the_password_is_checked(client, db_path):
    _register(client)
    client.delete("/api/session")
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET status = 'disabled' WHERE username = 'asha.farmer'")
    conn.commit()
    conn.close()

    refused = client.post("/api/session", json={"username": "asha.farmer", "password": PASSWORD})
    wrong = client.post("/api/session", json={"username": "asha.farmer", "password": "WrongPassword1"})

    assert refused.status_code == 403
    assert wrong.status_code == 401
    assert client.get("/api/session").get_json()["active"] is False


def test_existing_session_of_a_disabled_account_is_ended(client, db_path):
    _register(client)
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET status = 'disabled' WHERE username = 'asha.farmer'")
    conn.commit()
    conn.close()

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/role-actions").status_code == 401


def test_demo_account_without_a_password_cannot_sign_in(client, db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET password_hash = NULL WHERE username = 'demo.retailer'")
    conn.commit()
    conn.close()

    response = client.post("/api/session", json={"username": "demo.retailer", "password": "anything1"})

    assert response.status_code == 401


def test_a_stored_hash_is_never_returned_by_any_endpoint(client, db_path):
    _register(client)
    bodies = [
        client.get("/api/session").get_data(as_text=True),
        client.post("/api/session", json={"username": "asha.farmer", "password": PASSWORD}).get_data(as_text=True),
        client.get("/api/role-actions").get_data(as_text=True),
        _register(client, username="asha.two", role="retailer").get_data(as_text=True),
    ]
    stored = _row(db_path, "asha.farmer")["password_hash"]

    for text in bodies:
        assert stored not in text
        assert "password" not in text.lower()
        assert "scrypt:" not in text


# --- Session persistence, sign-out and expiry ---------------------------------


def test_session_survives_a_reload_style_request_sequence(client):
    _register(client)

    for _ in range(3):
        assert client.get("/api/session").get_json()["active"] is True


def test_sign_out_then_refresh_stays_signed_out(client):
    sign_in(client, "farmer")
    client.delete("/api/session")

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/role-actions").status_code == 401


def test_sign_out_keeps_the_account_and_its_records(client, db_path):
    _register(client)
    before = _count(db_path, "SELECT COUNT(*) FROM users")

    client.delete("/api/session")

    assert _count(db_path, "SELECT COUNT(*) FROM users") == before
    assert _row(db_path, "asha.farmer") is not None


def test_expired_session_is_rejected(client, monkeypatch):
    sign_in(client, "farmer")
    lifetime = client.application.config["SESSION_LIFETIME_SECONDS"]
    real_time = time.time()
    monkeypatch.setattr(time, "time", lambda: real_time + lifetime + 60)

    assert client.get("/api/session").get_json()["active"] is False
    assert client.get("/api/role-actions").status_code == 401


def test_session_is_valid_just_before_its_lifetime_ends(client, monkeypatch):
    sign_in(client, "farmer")
    lifetime = client.application.config["SESSION_LIFETIME_SECONDS"]
    real_time = time.time()
    monkeypatch.setattr(time, "time", lambda: real_time + lifetime - 60)

    assert client.get("/api/session").get_json()["active"] is True


def test_malformed_session_values_are_rejected(client):
    with client.session_transaction() as session:
        session[SESSION_KEY] = {"user_id": "1; DROP TABLE users", "issued_at": int(time.time())}

    assert client.get("/api/session").get_json()["active"] is False


def test_session_without_issue_time_is_rejected(client):
    with client.session_transaction() as session:
        session[SESSION_KEY] = {"user_id": 1}

    assert client.get("/api/session").get_json()["active"] is False


def test_session_naming_a_missing_account_is_rejected(client):
    with client.session_transaction() as session:
        session[SESSION_KEY] = {"user_id": 9999, "issued_at": int(time.time())}

    assert client.get("/api/session").get_json()["active"] is False


def test_session_cookie_does_not_contain_password_or_hash(client, db_path):
    response = _register(client)
    stored = _row(db_path, "asha.farmer")["password_hash"]

    cookie = response.headers.get("Set-Cookie", "")

    assert PASSWORD not in cookie
    assert stored not in cookie


def test_cookie_settings_are_http_only_and_lax(client):
    response = sign_in(client, "farmer")

    cookie = response.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
    assert "Secure" not in cookie  # localhost is plain HTTP; SESSION_COOKIE_SECURE opts in


# --- Demo accounts -----------------------------------------------------------


@pytest.mark.parametrize("role", ["farmer", "distributor", "retailer"])
def test_demo_accounts_sign_in_with_configured_passwords(client, role):
    response = client.post(
        "/api/session",
        json={"username": DEMO_USERNAMES[role], "password": DEMO_PASSWORDS[role]},
    )

    assert response.status_code == 200
    assert response.get_json()["role"] == role


def test_demo_passwords_are_stored_as_hashes(db_path):
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT username, password_hash FROM users WHERE username LIKE 'demo.%'").fetchall()
    conn.close()

    assert len(rows) == 3
    for username, stored in rows:
        assert stored and DEMO_PASSWORDS[username.split(".")[1]] not in stored
        assert check_password_hash(stored, DEMO_PASSWORDS[username.split(".")[1]])


def test_demo_password_is_not_overwritten_by_restarting(db_path, monkeypatch):
    init_db(db_path)
    monkeypatch.setenv("DEMO_FARMER_PASSWORD", "ChangedLater2026")

    init_db(db_path)

    stored = _row(db_path, "demo.farmer")["password_hash"]
    assert check_password_hash(stored, DEMO_PASSWORDS["farmer"])
    assert not check_password_hash(stored, "ChangedLater2026")


def test_demo_account_without_configured_password_is_created_without_one(db_path, monkeypatch):
    monkeypatch.delenv("DEMO_RETAILER_PASSWORD")
    init_db(db_path)

    assert _row(db_path, "demo.retailer") is not None
    assert _row(db_path, "demo.retailer")["password_hash"] is None
    assert demo_accounts_missing_password(sqlite3.connect(db_path)) == ["demo.retailer"]


def test_later_configuration_sets_a_missing_demo_password(db_path, monkeypatch):
    monkeypatch.delenv("DEMO_RETAILER_PASSWORD")
    init_db(db_path)
    assert _row(db_path, "demo.retailer")["password_hash"] is None

    monkeypatch.setenv("DEMO_RETAILER_PASSWORD", "LaterSet2026")
    init_db(db_path)

    assert check_password_hash(_row(db_path, "demo.retailer")["password_hash"], "LaterSet2026")


def test_weak_configured_demo_password_fails_before_writing(db_path):
    init_db(db_path)
    conn = sqlite3.connect(db_path)

    with pytest.raises(ValueError, match="not acceptable"):
        seed_demo_users(conn, {"farmer": "weak"})
    conn.close()


def test_demo_password_is_never_in_an_api_response(client):
    bodies = [
        client.post("/api/session", json={"username": "demo.farmer", "password": DEMO_PASSWORDS["farmer"]}).get_data(as_text=True),
        client.get("/api/roles").get_data(as_text=True),
        client.get("/api/session").get_data(as_text=True),
    ]

    for text in bodies:
        assert DEMO_PASSWORDS["farmer"] not in text


def test_demo_accounts_exist_after_init_db_on_an_empty_database(db_path, monkeypatch):
    monkeypatch.delenv("DEMO_FARMER_PASSWORD", raising=False)
    monkeypatch.delenv("DEMO_DISTRIBUTOR_PASSWORD", raising=False)
    monkeypatch.delenv("DEMO_RETAILER_PASSWORD", raising=False)

    init_db(db_path)

    assert _count(db_path, "SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%'") == 3


# --- Migration of an existing database ----------------------------------------


def test_existing_database_gains_account_columns_and_keeps_its_rows(db_path):
    # A database as created before BPT-101: users has no password, status or update columns.
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK (role IN ('farmer', 'distributor', 'retailer')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO users (id, display_name, username, role) VALUES (7, 'Old Farmer', 'old.farmer', 'farmer');
        """
    )
    conn.commit()
    conn.close()

    init_db(db_path)

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    old = conn.execute("SELECT id, display_name, username, role, password_hash, status FROM users WHERE id = 7").fetchone()
    conn.close()
    assert {"password_hash", "status", "updated_at"} <= columns
    assert old == (7, "Old Farmer", "old.farmer", "farmer", None, "active")


def test_account_column_migration_is_idempotent(db_path):
    init_db(db_path)
    init_db(db_path)

    conn = sqlite3.connect(db_path)
    columns = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
    conn.close()
    assert columns.count("password_hash") == 1
    assert columns.count("status") == 1


def test_existing_demo_database_without_passwords_is_backfilled(db_path, monkeypatch):
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE users SET password_hash = NULL WHERE username LIKE 'demo.%'")
    conn.commit()
    conn.close()

    init_db(db_path)

    assert _count(db_path, "SELECT COUNT(*) FROM users WHERE username LIKE 'demo.%' AND password_hash IS NULL") == 0
