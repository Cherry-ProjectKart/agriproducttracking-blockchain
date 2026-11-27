"""Session-based sign-in and server-side role enforcement (BPT-101).

The session is Flask's signed cookie. It stores only the account id and the time it was issued.
Every request re-reads the account from the database, so the role always comes from the persisted
account record, never from the browser. An account that is missing, disabled or whose role is no
longer supported is treated as signed out.

require_role(...) is unchanged in contract: 401 without a valid session, 403 for a disallowed role.
"""

import time
from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import current_app, session

from app.db import get_db
from app.errors import ApiError
from app.models.account import ACCOUNT_STATUS_ACTIVE
from app.models.roles import SUPPORTED_ROLES
from app.services.account_service import get_user_by_id

SESSION_KEY = "account_session"


def start_account_session(user_id: int) -> None:
    """Replace any existing session with one for this account. Session fixation is prevented by clearing first."""
    session.clear()
    session[SESSION_KEY] = {"user_id": user_id, "issued_at": int(time.time())}
    session.permanent = True


def end_account_session() -> None:
    """Remove all session data. Idempotent."""
    session.clear()


def _lifetime_seconds() -> int:
    return int(current_app.config["SESSION_LIFETIME_SECONDS"])


def current_account() -> dict[str, Any] | None:
    """Return the signed-in account as stored in the database, or None.

    Returns None (and clears the cookie data) when the session is missing, malformed, expired, or
    its account no longer exists, is disabled, or has an unsupported role.
    """
    raw = session.get(SESSION_KEY)
    if not isinstance(raw, dict):
        return None
    user_id = raw.get("user_id")
    issued_at = raw.get("issued_at")
    if not isinstance(user_id, int) or isinstance(user_id, bool) or not isinstance(issued_at, int):
        session.clear()
        return None
    if time.time() - issued_at > _lifetime_seconds():
        session.clear()
        return None

    user = get_user_by_id(get_db(), user_id)
    if (
        user is None
        or user["status"] != ACCOUNT_STATUS_ACTIVE
        or user["role"] not in SUPPORTED_ROLES
    ):
        session.clear()
        return None
    return {
        "user_id": user["id"],
        "role": user["role"],
        "display_name": user["display_name"],
        "username": user["username"],
    }


def require_role(*allowed_roles: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator: allow the request only when the signed-in account's role is one of allowed_roles.

    Responds 401 when there is no valid sign-in and 403 when the account's role is not allowed.
    Misconfigured decorators (no roles, or unsupported role names) fail at import time.
    """
    if not allowed_roles:
        raise ValueError("require_role needs at least one role.")
    unsupported = [role for role in allowed_roles if role not in SUPPORTED_ROLES]
    if unsupported:
        raise ValueError(f"require_role received unsupported roles: {unsupported}")

    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            active = current_account()
            if active is None:
                raise ApiError(401, "Sign in to continue.")
            if active["role"] not in allowed_roles:
                raise ApiError(403, "Your account's role is not permitted to perform this action.")
            return view(*args, **kwargs)

        return wrapper

    return decorator
