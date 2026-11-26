"""Demo role-access endpoints.

GET    /api/roles          list supported roles (public)
GET    /api/session        current demo session state (public)
POST   /api/session        select a role and start a session  {"role": "farmer"}
DELETE /api/session        exit the session (idempotent)
GET    /api/role-actions   role-specific actions for the active role (requires a session)
"""

from flask import Blueprint, jsonify, request

from app.auth import current_demo_session, end_demo_session, require_role, start_demo_session
from app.db import get_db
from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES
from app.services.access_service import (
    UnsupportedRoleError,
    find_demo_account,
    get_role_actions,
    list_roles,
    role_label,
    validate_role,
)

access_bp = Blueprint("access", __name__)


def _session_payload() -> dict[str, object]:
    active = current_demo_session()
    if active is None:
        return {"active": False, "role": None, "role_label": None, "display_name": None}
    return {
        "active": True,
        "role": active["role"],
        "role_label": role_label(active["role"]),
        "display_name": active["display_name"],
    }


@access_bp.get("/roles")
def roles():
    return jsonify({"roles": list_roles()}), 200


@access_bp.get("/session")
def get_session():
    return jsonify(_session_payload()), 200


@access_bp.post("/session")
def start_session():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with a 'role' field.")

    try:
        role = validate_role(body.get("role"))
    except UnsupportedRoleError as exc:
        raise ApiError(400, str(exc)) from exc

    account = find_demo_account(get_db(), role)
    if account is None:
        raise ApiError(503, "Demonstration accounts are not initialised. Run scripts/init_db.py.")

    start_demo_session(role, account["id"], account["display_name"])
    return jsonify(_session_payload()), 201


@access_bp.delete("/session")
def end_session():
    end_demo_session()
    return jsonify(_session_payload()), 200


@access_bp.get("/role-actions")
@require_role(*SUPPORTED_ROLES)
def role_actions():
    active = current_demo_session()
    role = active["role"]
    return jsonify(
        {"role": role, "role_label": role_label(role), "actions": get_role_actions(role)}
    ), 200
