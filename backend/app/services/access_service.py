"""Role validation, role metadata and demonstration accounts (BPT-101).

Demo accounts are ordinary rows in the `users` table. Their passwords come from environment
variables (DEMO_*_PASSWORD) and are stored only as hashes. A demo account without a configured
password exists but cannot sign in.
"""

import os
import sqlite3
from collections.abc import Mapping

from app.models.account import DEMO_PASSWORD_ENV
from app.models.roles import (
    DEMO_ACCOUNTS,
    ROLE_ACTIONS,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    SUPPORTED_ROLES,
)
from app.services.account_service import hash_password, password_problem
from app.services.ledger_service import utc_timestamp


class UnsupportedRoleError(ValueError):
    """Raised when a supplied role is missing or not one of SUPPORTED_ROLES."""


def is_supported_role(value: object) -> bool:
    return isinstance(value, str) and value in SUPPORTED_ROLES


def validate_role(value: object) -> str:
    """Return the role if supported; otherwise raise UnsupportedRoleError. Matching is exact."""
    if value is None:
        raise UnsupportedRoleError("A role is required.")
    if not is_supported_role(value):
        raise UnsupportedRoleError(
            "Unsupported role. Supported roles are: " + ", ".join(SUPPORTED_ROLES) + "."
        )
    return str(value)


def role_label(role: str) -> str:
    return ROLE_LABELS[role]


def list_roles() -> list[dict[str, str]]:
    return [
        {"key": role, "label": ROLE_LABELS[role], "description": ROLE_DESCRIPTIONS[role]}
        for role in SUPPORTED_ROLES
    ]


def get_role_actions(role: str) -> list[dict[str, object]]:
    """Actions for a role, with whether each is available yet."""
    return [
        {"key": key, "label": label, "available": available}
        for key, label, available in ROLE_ACTIONS[role]
    ]


def demo_passwords_from_environment(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Role -> password for every DEMO_*_PASSWORD variable that is set and not blank."""
    source = os.environ if environ is None else environ
    return {
        role: source[env_name]
        for role, env_name in DEMO_PASSWORD_ENV.items()
        if source.get(env_name, "").strip()
    }


def seed_demo_users(conn: sqlite3.Connection, demo_passwords: Mapping[str, str] | None = None) -> list[str]:
    """Create the demo accounts if missing and set a configured password where none is stored yet.

    Idempotent. An account that already has a password hash is never changed, so a password changed
    after the first start is kept. Existing rows are never deleted. Returns the usernames whose
    password was set by this call.

    Raises ValueError, before any write, when a configured demo password breaks the password rules.
    """
    passwords = demo_passwords_from_environment() if demo_passwords is None else dict(demo_passwords)
    for role, password in passwords.items():
        problem = password_problem(password)
        if problem:
            raise ValueError(f"Demo password for {role} is not acceptable: {problem}")

    now = utc_timestamp()
    set_now: list[str] = []
    for role, (username, display_name) in DEMO_ACCOUNTS.items():
        password = passwords.get(role)
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO users (display_name, username, role, password_hash, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (display_name, username, role, hash_password(password) if password else None, now, now),
            )
            if password:
                set_now.append(username)
        elif row[1] is None and password:
            conn.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (hash_password(password), now, row[0]),
            )
            set_now.append(username)
    conn.commit()
    return set_now


def demo_accounts_missing_password(conn: sqlite3.Connection) -> list[str]:
    """Usernames of demo accounts that exist but have no password, so they cannot sign in."""
    rows = conn.execute(
        "SELECT username FROM users WHERE username IN (?, ?, ?) AND password_hash IS NULL ORDER BY username",
        tuple(username for username, _ in DEMO_ACCOUNTS.values()),
    ).fetchall()
    return [row[0] for row in rows]
