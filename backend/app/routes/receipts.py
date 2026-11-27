"""Retailer receipt endpoints (US-06).

GET  /api/receipts/awaiting   batches with status "Delivered to Retailer" (retailer only)
POST /api/receipts            confirm receipt of a batch (retailer only; Idempotency-Key header required)

Body for POST: {"batch_id": "PB-XXXX-XXXX"}
The retailer is taken from the signed session, never from the request body.
"""

import re

from flask import Blueprint, jsonify, request

from app.auth import current_account, require_role
from app.db import get_db
from app.errors import ApiError
from app.models.batch import IDEMPOTENCY_KEY_PATTERN
from app.services.batch_identifiers import is_valid_batch_id
from app.services.receipt_service import (
    ReceiptBatchNotFoundError,
    ReceiptConflictError,
    ReceiptNotAllowedError,
    confirm_receipt,
    list_awaiting_receipt,
    retailer_exists,
)

receipts_bp = Blueprint("receipts", __name__)

_KEY_RE = re.compile(IDEMPOTENCY_KEY_PATTERN)


def _active_retailer_ok() -> None:
    """Re-check the session's user in the database. A stale session gets 401."""
    active = current_account()
    user_id = active["user_id"] if active is not None else None
    if not isinstance(user_id, int) or not retailer_exists(get_db(), user_id):
        raise ApiError(401, "Your session is no longer valid. Sign in again to continue.")


def _submission_key() -> str:
    key = (request.headers.get("Idempotency-Key") or "").strip()
    if not _KEY_RE.match(key):
        raise ApiError(
            400,
            "An Idempotency-Key header of 8 to 64 letters, digits or hyphens is required, "
            "so that a repeated confirmation is not recorded twice.",
        )
    return key


@receipts_bp.get("/receipts/awaiting")
@require_role("retailer")
def awaiting_receipts():
    _active_retailer_ok()
    return jsonify({"batches": list_awaiting_receipt(get_db())}), 200


@receipts_bp.post("/receipts")
@require_role("retailer")
def create_receipt():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with batch_id.")

    submission_key = _submission_key()
    _active_retailer_ok()

    batch_id = body.get("batch_id")
    if batch_id is None or (isinstance(batch_id, str) and not batch_id.strip()):
        raise ApiError(400, "Please correct the highlighted fields.", {"batch_id": "Select a batch to confirm."})
    if not is_valid_batch_id(batch_id):
        raise ApiError(400, "Please correct the highlighted fields.", {"batch_id": "Batch ID must look like PB-XXXX-XXXX."})

    try:
        result, created = confirm_receipt(get_db(), submission_key, batch_id)
    except ReceiptBatchNotFoundError as exc:
        raise ApiError(404, "Batch not found.") from exc
    except ReceiptNotAllowedError as exc:
        raise ApiError(409, str(exc)) from exc
    except ReceiptConflictError as exc:
        raise ApiError(409, str(exc)) from exc

    return jsonify(result), (201 if created else 200)
