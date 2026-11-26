"""Farmer product batch endpoints (US-02).

POST /api/batches              register a batch (farmer only; Idempotency-Key header required)
GET  /api/batches              list the farmer's own batches (farmer only)
GET  /api/batches/<id>         one of the farmer's own batches (farmer only; 404 otherwise)

The farmer is identified from the signed demo session, never from the request body.
"""

import re

from flask import Blueprint, jsonify, request

from app.auth import current_demo_session, require_role
from app.db import get_db
from app.errors import ApiError
from app.models.batch import IDEMPOTENCY_KEY_PATTERN
from app.services.batch_service import (
    BatchConflictError,
    BatchValidationError,
    farmer_exists,
    get_batch,
    list_batches,
    register_batch,
    validate_batch_input,
)

batches_bp = Blueprint("batches", __name__)

_KEY_RE = re.compile(IDEMPOTENCY_KEY_PATTERN)


def _active_farmer_id() -> int:
    """The farmer behind the active session. Re-checked in the database on every request."""
    active = current_demo_session()
    farmer_id = active["user_id"] if active is not None else None
    if not isinstance(farmer_id, int) or not farmer_exists(get_db(), farmer_id):
        raise ApiError(401, "Your session is no longer valid. Select a role to sign in again.")
    return farmer_id


def _submission_key() -> str:
    key = (request.headers.get("Idempotency-Key") or "").strip()
    if not _KEY_RE.match(key):
        raise ApiError(
            400,
            "An Idempotency-Key header of 8 to 64 letters, digits or hyphens is required, "
            "so that a repeated submission is not saved twice.",
        )
    return key


@batches_bp.post("/batches")
@require_role("farmer")
def create_batch():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with the batch fields.")

    submission_key = _submission_key()
    farmer_id = _active_farmer_id()

    try:
        clean = validate_batch_input(body)
    except BatchValidationError as exc:
        raise ApiError(400, "Please correct the highlighted fields.", exc.details) from exc

    try:
        batch, created = register_batch(get_db(), farmer_id, submission_key, clean)
    except BatchConflictError as exc:
        raise ApiError(409, str(exc)) from exc

    return jsonify({"batch": batch}), (201 if created else 200)


@batches_bp.get("/batches")
@require_role("farmer")
def list_farmer_batches():
    return jsonify({"batches": list_batches(get_db(), _active_farmer_id())}), 200


@batches_bp.get("/batches/<int:batch_id>")
@require_role("farmer")
def get_farmer_batch(batch_id: int):
    batch = get_batch(get_db(), _active_farmer_id(), batch_id)
    if batch is None:
        raise ApiError(404, "Batch not found.")
    return jsonify({"batch": batch}), 200
