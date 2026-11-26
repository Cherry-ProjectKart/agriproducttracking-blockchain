"""Batch history endpoint (US-07). Read-only.

GET /api/history/<batch ID>   chronological registration, shipment and receipt events for one batch

Any active demonstration session may read history (the SRS gives demonstration participants access to
the record). Responses contain no user names or session values.
"""

from flask import Blueprint, jsonify

from app.auth import require_role
from app.db import get_db
from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES
from app.services.batch_identifiers import is_valid_batch_id
from app.services.history_service import batch_history

history_bp = Blueprint("history", __name__)


@history_bp.get("/history/<batch_code>")
@require_role(*SUPPORTED_ROLES)
def batch_history_route(batch_code: str):
    if not is_valid_batch_id(batch_code):
        raise ApiError(400, "Batch ID must look like PB-XXXX-XXXX.")
    history = batch_history(get_db(), batch_code)
    if history is None:
        raise ApiError(404, "Batch not found.")
    return jsonify(history), 200
