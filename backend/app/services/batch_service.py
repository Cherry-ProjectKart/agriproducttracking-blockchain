"""Product batch validation, registration and retrieval (US-02, US-03).

Writes are idempotent: each registration carries a client-supplied submission key, which is
stored in product_batches.client_request_id. Repeating the same request returns the original
batch instead of creating another one.

Each new batch also receives a unique batch ID (product_batches.batch_code, US-03). The ID is
generated here and stored in the same transaction as the batch and its registration event.
"""

import math
import re
import sqlite3
from datetime import date
from typing import Any

from app.models.batch import (
    DESCRIPTION_MAX_LENGTH,
    ORIGIN_MAX_LENGTH,
    PRODUCT_NAME_MAX_LENGTH,
    REGISTERED_STATUS,
    REGISTRATION_EVENT_NOTE,
    REGISTRATION_EVENT_TYPE,
    UNIT_MAX_LENGTH,
)
from app.services.batch_identifiers import (
    MAX_ID_ATTEMPTS,
    BatchIdAllocationError,
    generate_batch_id,
    is_unique_violation,
)

_DATE_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
# Plain decimal numbers only: "12", "12.5". Rejects signs, exponents and empty values.
_NUMBER_PATTERN = re.compile(r"^[0-9]+(\.[0-9]+)?$")

_BATCH_COLUMNS = (
    "id, batch_code, product_name, description, quantity, unit, origin, harvest_date, "
    "current_status, created_at"
)


class BatchValidationError(ValueError):
    """Raised when one or more fields fail validation. details maps field name to message."""

    def __init__(self, details: dict[str, str]):
        super().__init__("Batch validation failed.")
        self.details = details


class BatchConflictError(Exception):
    """Raised when a submission key is reused for a different batch or a different owner."""


def _required_text(value: object, field: str, label: str, max_length: int, details: dict[str, str]) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        details[field] = f"{label} is required."
        return None
    if not isinstance(value, str):
        details[field] = f"{label} must be text."
        return None
    text = value.strip()
    if len(text) > max_length:
        details[field] = f"{label} must be {max_length} characters or fewer."
        return None
    return text


def _optional_text(value: object, field: str, label: str, max_length: int, details: dict[str, str]) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        details[field] = f"{label} must be text."
        return None
    text = value.strip()
    if len(text) > max_length:
        details[field] = f"{label} must be {max_length} characters or fewer."
        return None
    return text or None


def _quantity(value: object, details: dict[str, str]) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        details["quantity"] = "Quantity is required."
        return None
    if isinstance(value, bool):
        details["quantity"] = "Quantity must be a positive number."
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str) and _NUMBER_PATTERN.match(value.strip()):
        number = float(value.strip())
    else:
        details["quantity"] = "Quantity must be a positive number, for example 25 or 12.5."
        return None
    if not math.isfinite(number) or number <= 0:
        details["quantity"] = "Quantity must be greater than zero."
        return None
    return number


def _harvest_date(value: object, details: dict[str, str]) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        details["harvest_date"] = "Harvest or registration date is required."
        return None
    if not isinstance(value, str) or not _DATE_PATTERN.match(value):
        details["harvest_date"] = "Date must use the format YYYY-MM-DD."
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        details["harvest_date"] = "Enter a valid calendar date."
        return None
    return value


def validate_batch_input(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalise a registration payload.

    Only the six product fields are read. Any other key, including created_by, current_status
    or batch_id, is ignored, so clients cannot set ownership, status or identifiers.
    """
    details: dict[str, str] = {}
    clean: dict[str, Any] = {
        "product_name": _required_text(
            payload.get("product_name"), "product_name", "Product name", PRODUCT_NAME_MAX_LENGTH, details
        ),
        "description": _optional_text(
            payload.get("description"), "description", "Description", DESCRIPTION_MAX_LENGTH, details
        ),
        "quantity": _quantity(payload.get("quantity"), details),
        "unit": _required_text(payload.get("unit"), "unit", "Unit", UNIT_MAX_LENGTH, details),
        "origin": _required_text(payload.get("origin"), "origin", "Origin or farm location", ORIGIN_MAX_LENGTH, details),
        "harvest_date": _harvest_date(payload.get("harvest_date"), details),
    }
    if details:
        raise BatchValidationError(details)
    return clean


def _to_response(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "batch_id": row["batch_code"],
        "product_name": row["product_name"],
        "description": row["description"],
        "quantity": row["quantity"],
        "unit": row["unit"],
        "origin": row["origin"],
        "harvest_date": row["harvest_date"],
        "current_status": row["current_status"],
        "created_at": row["created_at"],
    }


def _find_by_submission_key(conn: sqlite3.Connection, submission_key: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM product_batches WHERE client_request_id = ?", (submission_key,)
    ).fetchone()


def _matches_submission(row: sqlite3.Row, farmer_id: int, clean: dict[str, Any]) -> bool:
    return (
        row["created_by"] == farmer_id
        and row["product_name"] == clean["product_name"]
        and row["description"] == clean["description"]
        and row["quantity"] == clean["quantity"]
        and row["unit"] == clean["unit"]
        and row["origin"] == clean["origin"]
        and row["harvest_date"] == clean["harvest_date"]
    )


def farmer_exists(conn: sqlite3.Connection, user_id: int) -> bool:
    """True when the user exists and has the farmer role (checked against the database, not the cookie alone)."""
    return conn.execute(
        "SELECT 1 FROM users WHERE id = ? AND role = 'farmer'", (user_id,)
    ).fetchone() is not None


def register_batch(
    conn: sqlite3.Connection, farmer_id: int, submission_key: str, clean: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Persist a validated batch with its unique batch ID and registration event.

    Returns (batch, created). created is False when the submission key was already used by
    the same farmer for the same details; the existing batch is returned without a new write.
    BatchIdAllocationError is raised only if MAX_ID_ATTEMPTS new IDs all collide.
    """
    existing = _find_by_submission_key(conn, submission_key)
    if existing is not None:
        if not _matches_submission(existing, farmer_id, clean):
            raise BatchConflictError("This submission key was already used for a different batch.")
        return _to_response(existing), False

    for _ in range(MAX_ID_ATTEMPTS):
        batch_code = generate_batch_id()
        try:
            cursor = conn.execute(
                """
                INSERT INTO product_batches
                    (batch_code, client_request_id, product_name, description, quantity, unit,
                     origin, harvest_date, current_status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    batch_code,
                    submission_key,
                    clean["product_name"],
                    clean["description"],
                    clean["quantity"],
                    clean["unit"],
                    clean["origin"],
                    clean["harvest_date"],
                    REGISTERED_STATUS,
                    farmer_id,
                ),
            )
            batch_row_id = cursor.lastrowid
            conn.execute(
                """
                INSERT INTO supply_chain_events (batch_id, event_type, actor_role, status, note)
                VALUES (?, ?, 'farmer', ?, ?)
                """,
                (batch_row_id, REGISTRATION_EVENT_TYPE, REGISTERED_STATUS, REGISTRATION_EVENT_NOTE),
            )
            conn.commit()
            break
        except sqlite3.IntegrityError as error:
            conn.rollback()
            # A concurrent request with the same key may have won the race; return its result if it matches.
            raced = _find_by_submission_key(conn, submission_key)
            if raced is not None:
                if not _matches_submission(raced, farmer_id, clean):
                    raise BatchConflictError("This submission key was already used for a different batch.")
                return _to_response(raced), False
            if is_unique_violation(error):
                continue  # the random ID was already taken: try another one
            raise
    else:
        raise BatchIdAllocationError("Could not allocate a unique batch ID. Please try again.")

    row = conn.execute(
        f"SELECT {_BATCH_COLUMNS} FROM product_batches WHERE id = ?", (batch_row_id,)
    ).fetchone()
    return _to_response(row), True


def list_batches(conn: sqlite3.Connection, farmer_id: int) -> list[dict[str, Any]]:
    """Batches registered by this farmer, newest first."""
    rows = conn.execute(
        f"SELECT {_BATCH_COLUMNS} FROM product_batches WHERE created_by = ? ORDER BY created_at DESC, id DESC",
        (farmer_id,),
    ).fetchall()
    return [_to_response(row) for row in rows]


def get_batch(conn: sqlite3.Connection, farmer_id: int, batch_id: int) -> dict[str, Any] | None:
    """One batch owned by this farmer, by internal row id. Other farmers' batches are not found."""
    row = conn.execute(
        f"SELECT {_BATCH_COLUMNS} FROM product_batches WHERE id = ? AND created_by = ?",
        (batch_id, farmer_id),
    ).fetchone()
    return _to_response(row) if row is not None else None


def get_batch_by_batch_id(conn: sqlite3.Connection, farmer_id: int, batch_code: str) -> dict[str, Any] | None:
    """One batch owned by this farmer, by its public batch ID (PB-XXXX-XXXX)."""
    row = conn.execute(
        f"SELECT {_BATCH_COLUMNS} FROM product_batches WHERE batch_code = ? AND created_by = ?",
        (batch_code, farmer_id),
    ).fetchone()
    return _to_response(row) if row is not None else None
