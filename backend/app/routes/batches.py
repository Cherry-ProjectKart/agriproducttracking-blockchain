"""Farmer product batch endpoints (US-02, US-03).

POST /api/batches                    register a batch (farmer only; Idempotency-Key header required)
GET  /api/batches                    list the farmer's own batches (farmer only)
GET  /api/batches/<id>               one of the farmer's batches by row id (farmer only; 404 otherwise)
GET  /api/batches/by-batch-id/<code> one of the farmer's batches by its batch ID, e.g. PB-7K2M-9QXD
GET  /api/batches/<id>/qr.png        QR code PNG for the batch (farmer only; add ?download=1 to download)

The farmer is identified from the signed demo session, never from the request body.
The QR code encodes the tracking URL only. The tracking page itself is US-08.
"""

import re

from flask import Blueprint, Response, current_app, jsonify, request

from app.auth import current_account, require_role
from app.db import get_db
from app.errors import ApiError
from app.models.batch import IDEMPOTENCY_KEY_PATTERN
from app.services.batch_identifiers import BatchIdAllocationError, is_valid_batch_id
from app.services.batch_service import (
    BatchConflictError,
    BatchValidationError,
    farmer_exists,
    get_batch,
    get_batch_by_batch_id,
    list_batches,
    register_batch,
    update_batch_description,
    validate_batch_input,
)
from app.services.qr_service import build_tracking_url, render_qr_png

batches_bp = Blueprint("batches", __name__)

_KEY_RE = re.compile(IDEMPOTENCY_KEY_PATTERN)


def _active_farmer_id() -> int:
    """The farmer behind the active session. Re-checked in the database on every request."""
    active = current_account()
    farmer_id = active["user_id"] if active is not None else None
    if not isinstance(farmer_id, int) or not farmer_exists(get_db(), farmer_id):
        raise ApiError(401, "Your session is no longer valid. Sign in again to continue.")
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


def _with_links(batch: dict) -> dict:
    """Add the tracking URL and the QR image path. Both are derived from the batch's own ID."""
    linked = dict(batch)
    linked["tracking_url"] = (
        build_tracking_url(current_app.config["TRACKING_BASE_URL"], batch["batch_id"])
        if batch["batch_id"]
        else None
    )
    linked["qr_code_url"] = f"/api/batches/{batch['id']}/qr.png"
    return linked


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
    except BatchIdAllocationError as exc:
        raise ApiError(503, str(exc)) from exc

    return jsonify({"batch": _with_links(batch)}), (201 if created else 200)


@batches_bp.get("/batches")
@require_role("farmer")
def list_farmer_batches():
    batches = [_with_links(batch) for batch in list_batches(get_db(), _active_farmer_id())]
    return jsonify({"batches": batches}), 200


@batches_bp.get("/batches/by-batch-id/<batch_code>")
@require_role("farmer")
def get_farmer_batch_by_batch_id(batch_code: str):
    if not is_valid_batch_id(batch_code):
        raise ApiError(400, "Batch ID must look like PB-XXXX-XXXX.")
    batch = get_batch_by_batch_id(get_db(), _active_farmer_id(), batch_code)
    if batch is None:
        raise ApiError(404, "Batch not found.")
    return jsonify({"batch": _with_links(batch)}), 200


@batches_bp.get("/batches/<int:batch_id>")
@require_role("farmer")
def get_farmer_batch(batch_id: int):
    batch = get_batch(get_db(), _active_farmer_id(), batch_id)
    if batch is None:
        raise ApiError(404, "Batch not found.")
    return jsonify({"batch": _with_links(batch)}), 200


@batches_bp.patch("/batches/<int:batch_id>")
@require_role("farmer")
def update_farmer_batch(batch_id: int):
    """Change a batch description. Other batch details are recorded on the ledger and are refused."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with the fields to change.")

    try:
        batch = update_batch_description(get_db(), _active_farmer_id(), batch_id, body)
    except BatchValidationError as exc:
        raise ApiError(400, "Please correct the highlighted fields.", exc.details) from exc
    if batch is None:
        raise ApiError(404, "Batch not found.")
    return jsonify({"batch": _with_links(batch)}), 200


@batches_bp.get("/batches/<int:batch_id>/qr.png")
@require_role("farmer")
def get_batch_qr(batch_id: int):
    batch = get_batch(get_db(), _active_farmer_id(), batch_id)
    if batch is None:
        raise ApiError(404, "Batch not found.")
    if not batch["batch_id"]:
        raise ApiError(409, "This batch has no batch ID yet, so a QR code cannot be made.")

    tracking_url = build_tracking_url(current_app.config["TRACKING_BASE_URL"], batch["batch_id"])
    response = Response(render_qr_png(tracking_url), mimetype="image/png")
    response.headers["Cache-Control"] = "no-store"
    if request.args.get("download") in {"1", "true"}:
        response.headers["Content-Disposition"] = f'attachment; filename="{batch["batch_id"]}-qr.png"'
    return response
