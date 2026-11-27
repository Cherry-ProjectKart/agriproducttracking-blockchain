"""Account registration, password hashing and sign-in verification (BPT-101).

Passwords are hashed with werkzeug.security (salted scrypt by default in Werkzeug 3.x), which is
already a Flask dependency. No custom cryptography is used. This module does not import Flask.
"""

import sqlite3
from typing import Any

from werkzeug.security import check_password_hash, generate_password_hash

from app.models.account import (
    ACCOUNT_STATUS_ACTIVE,
    FULL_NAME_MAX_LENGTH,
    FULL_NAME_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    USERNAME_PATTERN,
)
from app.models.roles import SUPPORTED_ROLES
from app.services.ledger_service import utc_timestamp


class AccountValidationError(ValueError):
    """Raised with per-field messages. The messages never contain a submitted password."""

    def __init__(self, details: dict[str, str]):
        super().__init__("Please correct the highlighted fields.")
        self.details = details


class DuplicateUsernameError(Exception):
    """The username is already registered (usernames are stored lower-case, so this is case-insensitive)."""


class AccountDisabledError(Exception):
    """The password was correct, but the account is disabled."""


_REQUIRED_MESSAGES = {
    "full_name": "Enter your full name.",
    "username": "Enter a username.",
    "password": "Enter a password.",
    "confirm_password": "Confirm your password.",
    "role": "Choose a role: Farmer, Distributor or Retailer.",
}


def normalise_username(value: str) -> str:
    return value.strip().lower()


def _required_string(payload: dict[str, Any], field: str, details: dict[str, str]) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        details[field] = _REQUIRED_MESSAGES[field]
        return ""
    return value


def full_name_problem(full_name: str) -> str | None:
    """Return the rule a full name breaks, or None. The value must already be trimmed."""
    if not (FULL_NAME_MIN_LENGTH <= len(full_name) <= FULL_NAME_MAX_LENGTH):
        return f"Full name must be {FULL_NAME_MIN_LENGTH} to {FULL_NAME_MAX_LENGTH} characters."
    return None


def username_problem(username: str) -> str | None:
    """Return the rule a username breaks, or None. The value must already be normalised (trimmed, lower-case)."""
    if not (USERNAME_MIN_LENGTH <= len(username) <= USERNAME_MAX_LENGTH):
        return f"Username must be {USERNAME_MIN_LENGTH} to {USERNAME_MAX_LENGTH} characters."
    if not USERNAME_PATTERN.match(username):
        return "Use letters, numbers, dots, underscores or hyphens. Start with a letter or number."
    return None


def password_problem(password: str) -> str | None:
    """Return the first password rule the value breaks, or None when it is acceptable."""
    if not (PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH):
        return f"Password must be {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters."
    if not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
        return "Password must include at least one letter and one number."
    return None


def validate_registration(payload: dict[str, Any]) -> dict[str, str]:
    """Validate a registration body and return the cleaned values. Raises AccountValidationError."""
    details: dict[str, str] = {}

    full_name = _required_string(payload, "full_name", details).strip()
    if full_name:
        problem = full_name_problem(full_name)
        if problem:
            details["full_name"] = problem

    username = normalise_username(_required_string(payload, "username", details))
    if username and "username" not in details:
        problem = username_problem(username)
        if problem:
            details["username"] = problem

    password = _required_string(payload, "password", details)
    if password:
        problem = password_problem(password)
        if problem:
            details["password"] = problem

    confirm = _required_string(payload, "confirm_password", details)
    if password and confirm and confirm != password:
        details["confirm_password"] = "The passwords do not match."

    role = payload.get("role")
    if "role" not in details and (not isinstance(role, str) or role not in SUPPORTED_ROLES):
        details["role"] = _REQUIRED_MESSAGES["role"]

    if details:
        raise AccountValidationError(details)
    return {"full_name": full_name, "username": username, "password": password, "role": role}


# Werkzeug's default is salted scrypt. The method string records its cost parameters in each hash, so
# the cost can be changed later without invalidating stored passwords. Tests lower it for speed.
PASSWORD_HASH_METHOD = "scrypt"


def hash_password(password: str) -> str:
    return generate_password_hash(password, method=PASSWORD_HASH_METHOD)


# Checked when the username is unknown, so an unknown username takes about as long as a wrong password.
_DUMMY_HASH = generate_password_hash("timing-equaliser-not-a-real-password")

_PUBLIC_COLUMNS = "id, username, display_name, role, status, created_at, updated_at"


def _user_view(row: sqlite3.Row) -> dict[str, Any]:
    """Public view of an account. It never includes password_hash."""
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_user_by_id(conn: sqlite3.Connection, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(f"SELECT {_PUBLIC_COLUMNS} FROM users WHERE id = ?", (user_id,)).fetchone()
    return _user_view(row) if row is not None else None


def register_account(conn: sqlite3.Connection, clean: dict[str, str]) -> dict[str, Any]:
    """Insert an account with a hashed password in one transaction.

    Raises DuplicateUsernameError when the username already exists. The UNIQUE constraint on
    users.username settles races between two identical requests.
    """
    now = utc_timestamp()
    try:
        cursor = conn.execute(
            "INSERT INTO users (display_name, username, role, password_hash, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                clean["full_name"],
                clean["username"],
                clean["role"],
                hash_password(clean["password"]),
                ACCOUNT_STATUS_ACTIVE,
                now,
                now,
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise DuplicateUsernameError from exc
    return get_user_by_id(conn, cursor.lastrowid)


def authenticate(conn: sqlite3.Connection, username: str, password: str) -> dict[str, Any] | None:
    """Return the account when the username and password match, otherwise None.

    Unknown usernames, accounts without a configured password and wrong passwords all return None,
    so the caller can give one generic message. A correct password on a disabled account raises
    AccountDisabledError, which is only reachable after the password has been verified.
    """
    row = conn.execute(
        f"SELECT {_PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?",
        (normalise_username(username),),
    ).fetchone()
    stored = row["password_hash"] if row is not None else None
    # check_password_hash compares in constant time. The dummy hash keeps unknown usernames slow too.
    matches = check_password_hash(stored or _DUMMY_HASH, password)
    if row is None or not stored or not matches:
        return None
    if row["status"] != ACCOUNT_STATUS_ACTIVE:
        raise AccountDisabledError
    return _user_view(row)
