"""Demo role session handling and server-side role enforcement.

The active role is stored in Flask's signed session cookie. The cookie is signed with
SECRET_KEY, so the browser cannot change its role without the server rejecting it.

This is a localhost demonstration mechanism, not production authentication. See
README.md ("Demo role access") for the limitations.
"""

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import session

from app.errors import ApiError
from app.models.roles import SUPPORTED_ROLES

SESSION_KEY = "demo_access"


def start_demo_session(role: str, user_id: int, display_name: str) -> None:
    """Replace any existing session with one for the given supported role."""
    if role not in SUPPORTED_ROLES:
        raise ValueError(f"Unsupported role: {role!r}")
    session.clear()
    session[SESSION_KEY] = {"role": role, "user_id": user_id, "display_name": display_name}
    session.permanent = False


def end_demo_session() -> None:
    """Remove all session data, including the active role."""
    session.clear()


def current_demo_session() -> dict[str, Any] | None:
    """Return the active demo session, or None when there is none or its role is not supported."""
    raw = session.get(SESSION_KEY)
    if not isinstance(raw, dict):
        return None
    role = raw.get("role")
    if not isinstance(role, str) or role not in SUPPORTED_ROLES:
        return None
    return {
        "role": role,
        "user_id": raw.get("user_id"),
        "display_name": raw.get("display_name"),
    }


def require_role(*allowed_roles: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator: allow the request only when the active demo role is one of allowed_roles.

    Responds 401 when there is no active session and 403 when the active role is not allowed.
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
            active = current_demo_session()
            if active is None:
                raise ApiError(401, "Select a role to sign in to the demonstration.")
            if active["role"] not in allowed_roles:
                raise ApiError(403, "Your active role is not permitted to perform this action.")
            return view(*args, **kwargs)

        return wrapper

    return decorator
