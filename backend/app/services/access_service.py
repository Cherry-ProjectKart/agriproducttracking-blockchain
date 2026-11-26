"""Role validation, role metadata and sample demonstration accounts."""

import sqlite3

from app.models.roles import (
    DEMO_ACCOUNTS,
    ROLE_ACTIONS,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    SUPPORTED_ROLES,
)


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
    """Actions available to a role. Every action is listed as not yet available in this story."""
    return [
        {"key": key, "label": label, "available": False}
        for key, label in ROLE_ACTIONS[role]
    ]


def seed_demo_users(conn: sqlite3.Connection) -> None:
    """Insert the sample farmer, distributor and retailer accounts if they are missing (idempotent)."""
    conn.executemany(
        "INSERT OR IGNORE INTO users (display_name, username, role) VALUES (?, ?, ?)",
        [
            (display_name, username, role)
            for role, (username, display_name) in DEMO_ACCOUNTS.items()
        ],
    )


def find_demo_account(conn: sqlite3.Connection, role: str) -> sqlite3.Row | None:
    """Return the sample account for a role, or None if it has not been seeded."""
    username, _display_name = DEMO_ACCOUNTS[role]
    return conn.execute(
        "SELECT id, display_name, role FROM users WHERE username = ? AND role = ?",
        (username, role),
    ).fetchone()
