"""Signed-in user's profile, preferences and password (BPT-104).

GET    /api/account               the signed-in account's profile and preferences
PATCH  /api/account               change full_name and/or username  {"full_name": "...", "username": "..."}
PATCH  /api/account/preferences   change grid_density               {"grid_density": "compact"}
POST   /api/account/password      change password                   {"current_password", "new_password", "confirm_password"}

Every endpoint needs a valid sign-in and works only on that account. The account is read from the server-side
session, never from the URL or the body, so there is no user id to tamper with. Unknown fields are rejected,
and the role cannot be changed here. Responses never include the password hash or session data.
"""

from flask import Blueprint, jsonify, request

from app.auth import current_account, require_role
from app.db import get_db
from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES
from app.services.account_service import DuplicateUsernameError
from app.services.profile_service import (
    ProfileValidationError,
    change_password,
    get_profile,
    update_grid_density,
    update_profile,
)

profile_bp = Blueprint("profile", __name__)


def _signed_in_user_id() -> int:
    active = current_account()
    if active is None:  # require_role has already answered 401 for this case
        raise ApiError(401, "Sign in to continue.")
    return active["user_id"]


def _json_object() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object.")
    return body


def _profile_response(user_id: int, status: int = 200):
    profile = get_profile(get_db(), user_id)
    if profile is None:
        # The session names an account that no longer exists.
        raise ApiError(401, "Sign in to continue.")
    return jsonify({"account": profile}), status


def _validation_error(exc: ProfileValidationError) -> ApiError:
    return ApiError(400, exc.message, exc.details or None)


@profile_bp.get("/account")
@require_role(*SUPPORTED_ROLES)
def get_account():
    return _profile_response(_signed_in_user_id())


@profile_bp.patch("/account")
@require_role(*SUPPORTED_ROLES)
def patch_account():
    body = _json_object()
    user_id = _signed_in_user_id()
    try:
        update_profile(get_db(), user_id, body)
    except ProfileValidationError as exc:
        raise _validation_error(exc) from exc
    except DuplicateUsernameError as exc:
        raise ApiError(
            409,
            "That username is already taken.",
            {"username": "This username is already taken. Choose another."},
        ) from exc
    return _profile_response(user_id)


@profile_bp.patch("/account/preferences")
@require_role(*SUPPORTED_ROLES)
def patch_preferences():
    body = _json_object()
    user_id = _signed_in_user_id()
    unknown = [key for key in body if key != "grid_density"]
    if unknown:
        raise ApiError(400, "Please correct the highlighted fields.", {key: "This setting cannot be changed here." for key in unknown})
    try:
        update_grid_density(get_db(), user_id, body.get("grid_density"))
    except ProfileValidationError as exc:
        raise _validation_error(exc) from exc
    return _profile_response(user_id)


@profile_bp.post("/account/password")
@require_role(*SUPPORTED_ROLES)
def post_password():
    body = _json_object()
    user_id = _signed_in_user_id()
    try:
        change_password(get_db(), user_id, body)
    except ProfileValidationError as exc:
        raise _validation_error(exc) from exc
    return jsonify({"message": "Your password has been changed."}), 200
