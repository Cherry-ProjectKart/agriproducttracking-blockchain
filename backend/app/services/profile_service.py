"""Profile, personal preference and password changes for the signed-in account (BPT-104).

Every function takes the account id from the caller, which the routes read from the server-side session.
No function accepts a user id from the request body or the URL, so a request can only change its own account.
This module does not import Flask.
"""

import sqlite3
from typing import Any

from werkzeug.security import check_password_hash

from app.models.account import GRID_DENSITY_VALUES, PASSWORD_MAX_LENGTH
from app.models.roles import ROLE_LABELS
from app.services.account_service import (
    DuplicateUsernameError,
    full_name_problem,
    hash_password,
    normalise_username,
    password_problem,
    username_problem,
)
from app.services.ledger_service import utc_timestamp

# The only fields a profile update may change. Role and every other column are never editable here.
PROFILE_FIELDS = ("full_name", "username")
ROLE_FIELD_MESSAGE = "Your role is set when the account is created and cannot be changed here."
UNKNOWN_FIELD_MESSAGE = "This field cannot be changed here."


class ProfileValidationError(ValueError):
    """Raised with per-field messages. Messages never include a submitted password."""

    def __init__(self, details: dict[str, str], message: str = "Please correct the highlighted fields."):
        super().__init__(message)
        self.message = message
        self.details = details


def _row_to_profile(row: sqlite3.Row) -> dict[str, Any]:
    """The account fields a signed-in user may see. Never includes the id, password hash or status."""
    return {
        "username": row["username"],
        "full_name": row["display_name"],
        "role": row["role"],
        "role_label": ROLE_LABELS[row["role"]],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "grid_density": row["grid_density"],
    }


_PROFILE_SQL = "SELECT username, display_name, role, created_at, updated_at, grid_density FROM users WHERE id = ?"


def get_profile(conn: sqlite3.Connection, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(_PROFILE_SQL, (user_id,)).fetchone()
    return _row_to_profile(row) if row is not None else None


def _username_taken(conn: sqlite3.Connection, username: str, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM users WHERE username = ? AND id != ?", (username, user_id)
    ).fetchone()
    return row is not None


def update_profile(conn: sqlite3.Connection, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Change the account's full name and/or username. Role and other fields are rejected, not ignored.

    Raises ProfileValidationError for invalid input and DuplicateUsernameError when the username is taken.
    """
    if not payload:
        raise ProfileValidationError({}, "Change at least one field.")

    details: dict[str, str] = {}
    for key in payload:
        if key == "role":
            details[key] = ROLE_FIELD_MESSAGE
        elif key not in PROFILE_FIELDS:
            details[key] = UNKNOWN_FIELD_MESSAGE

    updates: dict[str, str] = {}
    if "full_name" in payload and "full_name" not in details:
        value = payload["full_name"]
        if not isinstance(value, str) or not value.strip():
            details["full_name"] = "Enter your full name."
        else:
            name = value.strip()
            problem = full_name_problem(name)
            if problem:
                details["full_name"] = problem
            else:
                updates["display_name"] = name

    if "username" in payload and "username" not in details:
        value = payload["username"]
        if not isinstance(value, str) or not value.strip():
            details["username"] = "Enter a username."
        else:
            username = normalise_username(value)
            problem = username_problem(username)
            if problem:
                details["username"] = problem
            else:
                updates["username"] = username

    if details:
        raise ProfileValidationError(details)

    if "username" in updates and _username_taken(conn, updates["username"], user_id):
        raise DuplicateUsernameError

    # Column names come only from the fixed mapping above, never from the request.
    assignments = ", ".join(f"{column} = ?" for column in updates)
    try:
        conn.execute(
            f"UPDATE users SET {assignments}, updated_at = ? WHERE id = ?",
            [*updates.values(), utc_timestamp(), user_id],
        )
        conn.commit()
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        raise DuplicateUsernameError from exc
    return get_profile(conn, user_id)


def update_grid_density(conn: sqlite3.Connection, user_id: int, value: Any) -> dict[str, Any]:
    """Save the account's table density preference. Only the listed values are accepted."""
    if not isinstance(value, str) or value not in GRID_DENSITY_VALUES:
        raise ProfileValidationError(
            {"grid_density": "Choose comfortable or compact."},
        )
    conn.execute(
        "UPDATE users SET grid_density = ?, updated_at = ? WHERE id = ?",
        (value, utc_timestamp(), user_id),
    )
    conn.commit()
    return get_profile(conn, user_id)


def change_password(conn: sqlite3.Connection, user_id: int, payload: dict[str, Any]) -> None:
    """Change the signed-in account's password after checking the current one.

    The current password is checked against this account's own stored hash. The error for a wrong current
    password says nothing about any other account. New passwords are hashed; no plaintext is stored.
    """
    details: dict[str, str] = {}

    def text(field: str, label: str) -> str:
        value = payload.get(field)
        if not isinstance(value, str) or not value:
            details[field] = label
            return ""
        return value

    current = text("current_password", "Enter your current password.")
    new = text("new_password", "Enter a new password.")
    confirm = text("confirm_password", "Confirm your new password.")

    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if current and "current_password" not in details:
        stored = row["password_hash"] if row is not None else None
        if not stored or not check_password_hash(stored, current):
            details["current_password"] = "Your current password is incorrect."

    if new and "new_password" not in details:
        if len(new) > PASSWORD_MAX_LENGTH:
            details["new_password"] = f"Password must be at most {PASSWORD_MAX_LENGTH} characters."
        else:
            problem = password_problem(new)
            if problem:
                details["new_password"] = problem
            elif current and new == current:
                details["new_password"] = "Choose a password different from your current one."

    if confirm and new and confirm != new:
        details["confirm_password"] = "The passwords do not match."

    if details:
        raise ProfileValidationError(details)

    conn.execute(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (hash_password(new), utc_timestamp(), user_id),
    )
    conn.commit()
