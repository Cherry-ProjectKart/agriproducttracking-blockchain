"""Distributor shipment endpoints (US-05).

GET  /api/shipments/batches   registered batches available for shipment updates (distributor only)
POST /api/shipments           record a shipment update (distributor only; Idempotency-Key header required)

Body for POST: {"batch_id": "PB-XXXX-XXXX", "status": "Shipped", "note": "optional text"}
The distributor is taken from the signed session, never from the request body.
"""

import re

from flask import Blueprint, jsonify, request

from app.auth import current_demo_session, require_role
from app.db import get_db
from app.errors import ApiError
from app.models.batch import IDEMPOTENCY_KEY_PATTERN
from app.services.shipment_service import (
    ShipmentBatchNotFoundError,
    ShipmentConflictError,
    ShipmentValidationError,
    distributor_exists,
    list_shipment_batches,
    record_shipment,
    validate_shipment_input,
)

shipments_bp = Blueprint("shipments", __name__)

_KEY_RE = re.compile(IDEMPOTENCY_KEY_PATTERN)


def _active_distributor_ok() -> None:
    """Re-check the session's user in the database. A stale session gets 401."""
    active = current_demo_session()
    user_id = active["user_id"] if active is not None else None
    if not isinstance(user_id, int) or not distributor_exists(get_db(), user_id):
        raise ApiError(401, "Your session is no longer valid. Select a role to sign in again.")


def _submission_key() -> str:
    key = (request.headers.get("Idempotency-Key") or "").strip()
    if not _KEY_RE.match(key):
        raise ApiError(
            400,
            "An Idempotency-Key header of 8 to 64 letters, digits or hyphens is required, "
            "so that a repeated shipment update is not saved twice.",
        )
    return key


@shipments_bp.get("/shipments/batches")
@require_role("distributor")
def list_batches_for_shipment():
    _active_distributor_ok()
    return jsonify({"batches": list_shipment_batches(get_db())}), 200


@shipments_bp.post("/shipments")
@require_role("distributor")
def create_shipment():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with batch_id, status and an optional note.")

    submission_key = _submission_key()
    _active_distributor_ok()

    try:
        clean = validate_shipment_input(body)
    except ShipmentValidationError as exc:
        raise ApiError(400, "Please correct the highlighted fields.", exc.details) from exc

    try:
        result, created = record_shipment(get_db(), submission_key, clean)
    except ShipmentBatchNotFoundError as exc:
        raise ApiError(404, "Batch not found.") from exc
    except ShipmentConflictError as exc:
        raise ApiError(409, str(exc)) from exc

    return jsonify(result), (201 if created else 200)
