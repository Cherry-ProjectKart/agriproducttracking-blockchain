"""Public consumer tracking endpoint (US-08). Read-only.

GET /api/tracking/<batch ID>   batch details and chronological history for a QR code's batch

No session or role is required: the QR code is meant for anyone who scans it. The endpoint
only reads. Use it only for the fields listed in app/services/public_tracking.py.
"""

from flask import Blueprint, jsonify

from app.db import get_db
from app.errors import ApiError
from app.services.batch_identifiers import is_valid_batch_id
from app.services.public_tracking import public_tracking

tracking_bp = Blueprint("tracking", __name__)


@tracking_bp.get("/tracking/<batch_code>")
def public_tracking_route(batch_code: str):
    if not is_valid_batch_id(batch_code):
        raise ApiError(400, "Batch ID must look like PB-XXXX-XXXX.")
    view = public_tracking(get_db(), batch_code)
    if view is None:
        raise ApiError(404, "Batch not found.")
    response = jsonify(view)
    response.headers["Cache-Control"] = "no-store"
    return response, 200
