"""Sign-in, sign-out and session state (BPT-101).

GET    /api/roles          list the three operational roles (public)
GET    /api/session        current sign-in state (public; active=false when signed out)
POST   /api/session        sign in with {"username": "...", "password": "..."}; the role comes from the account
DELETE /api/session        sign out (idempotent; the account is not changed)
GET    /api/role-actions   role-specific actions for the signed-in role (requires sign-in)

Account registration is in routes/accounts.py (POST /api/accounts).
"""

from flask import Blueprint, jsonify, request

from app.auth import current_account, end_account_session, require_role, start_account_session
from app.db import get_db
from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES
from app.services.account_service import AccountDisabledError, authenticate
from app.services.profile_service import get_profile
from app.services.access_service import (
    get_role_actions,
    list_roles,
    role_label,
)

access_bp = Blueprint("access", __name__)

# Generic on purpose: the same message for an unknown username and a wrong password.
INVALID_CREDENTIALS_MESSAGE = "Username or password is incorrect."
_MAX_USERNAME_INPUT = 128
_MAX_PASSWORD_INPUT = 1024


def session_payload() -> dict[str, object]:
    active = current_account()
    if active is None:
        return {
            "active": False,
            "role": None,
            "role_label": None,
            "display_name": None,
            "username": None,
        }
    profile = get_profile(get_db(), active["user_id"])
    return {
        "active": True,
        "role": active["role"],
        "role_label": role_label(active["role"]),
        "display_name": active["display_name"],
        "username": active["username"],
        "grid_density": profile["grid_density"] if profile else "comfortable",
    }


def _credentials_from(body: dict) -> tuple[str, str]:
    details: dict[str, str] = {}
    username = body.get("username")
    password = body.get("password")
    if not isinstance(username, str) or not username.strip():
        details["username"] = "Enter your username."
    elif len(username) > _MAX_USERNAME_INPUT:
        details["username"] = "Username is too long."
    if not isinstance(password, str) or not password:
        details["password"] = "Enter your password."
    elif len(password) > _MAX_PASSWORD_INPUT:
        details["password"] = "Password is too long."
    if details:
        raise ApiError(400, "Please correct the highlighted fields.", details)
    return username.strip(), password


@access_bp.get("/roles")
def roles():
    return jsonify({"roles": list_roles()}), 200


@access_bp.get("/session")
def get_session():
    return jsonify(session_payload()), 200


@access_bp.post("/session")
def sign_in():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with username and password.")
    username, password = _credentials_from(body)

    try:
        user = authenticate(get_db(), username, password)
    except AccountDisabledError as exc:
        raise ApiError(403, "This account is disabled. Ask the demonstration administrator to enable it.") from exc
    if user is None:
        raise ApiError(401, INVALID_CREDENTIALS_MESSAGE)

    start_account_session(user["id"])
    return jsonify(session_payload()), 200


@access_bp.delete("/session")
def sign_out():
    end_account_session()
    return jsonify(session_payload()), 200


@access_bp.get("/role-actions")
@require_role(*SUPPORTED_ROLES)
def role_actions():
    active = current_account()
    role = active["role"]
    return jsonify(
        {"role": role, "role_label": role_label(role), "actions": get_role_actions(role)}
    ), 200
