"""Account registration (BPT-101).

POST /api/accounts   create an account and sign it in

Body: {"full_name", "username", "password", "confirm_password", "role"}
The role must be Farmer, Distributor or Retailer. The server validates every field and never trusts
the frontend. The response contains the signed-in account view and never the password or its hash.
"""

from flask import Blueprint, jsonify, request

from app.auth import start_account_session
from app.db import get_db
from app.errors import ApiError
from app.routes.access import session_payload
from app.services.account_service import (
    AccountValidationError,
    DuplicateUsernameError,
    register_account,
    validate_registration,
)

accounts_bp = Blueprint("accounts", __name__)


@accounts_bp.post("/accounts")
def create_account():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object with the registration fields.")

    try:
        clean = validate_registration(body)
    except AccountValidationError as exc:
        raise ApiError(400, exc.args[0], exc.details) from exc

    try:
        user = register_account(get_db(), clean)
    except DuplicateUsernameError as exc:
        raise ApiError(
            409,
            "That username is already taken.",
            {"username": "This username is already taken. Choose another."},
        ) from exc

    start_account_session(user["id"])
    return jsonify(session_payload()), 201
