"""Read-only ledger endpoints (US-04).

GET /api/ledger                   all blocks in index order, plus the latest block and the count
GET /api/ledger/latest            the latest block
GET /api/ledger/blocks/<index>    one block by index

Any active demonstration session (Farmer, Distributor or Retailer) may read the ledger, because
the SRS gives demonstration participants access to it. No endpoint writes to the ledger: blocks
are created only by the registration flow. Responses contain no user names or session values.
"""

from flask import Blueprint, jsonify

from app.auth import require_role
from app.db import get_db
from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES
from app.services.ledger_service import get_block, get_latest_block, list_blocks

ledger_bp = Blueprint("ledger", __name__)


@ledger_bp.get("/ledger")
@require_role(*SUPPORTED_ROLES)
def ledger_blocks():
    conn = get_db()
    blocks = list_blocks(conn)
    return jsonify(
        {
            "count": len(blocks),
            "latest": blocks[-1] if blocks else None,
            "blocks": blocks,
        }
    ), 200


@ledger_bp.get("/ledger/latest")
@require_role(*SUPPORTED_ROLES)
def latest_block():
    block = get_latest_block(get_db())
    if block is None:
        raise ApiError(404, "The ledger has no blocks.")
    return jsonify({"block": block}), 200


@ledger_bp.get("/ledger/blocks/<int:index>")
@require_role(*SUPPORTED_ROLES)
def block_by_index(index: int):
    block = get_block(get_db(), index)
    if block is None:
        raise ApiError(404, "Block not found.")
    return jsonify({"block": block}), 200
