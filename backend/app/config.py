"""Environment-based application configuration.

Values are read from environment variables (optionally loaded from backend/.env).
"""

import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_PATH = BACKEND_DIR / "instance" / "product_tracking.db"

load_dotenv(BACKEND_DIR / ".env")

# Used only when SECRET_KEY is not configured. A new random key per process means
# demo sessions do not survive a backend restart, which is the intended behaviour here.
_GENERATED_SECRET_KEY = secrets.token_urlsafe(32)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _tracking_base_url(raw: str) -> str:
    """Base URL that QR codes point at. Must be an absolute http(s) URL; trailing slashes are removed."""
    value = raw.strip().rstrip("/")
    if not (value.startswith("http://") or value.startswith("https://")) or len(value) <= len("https://"):
        raise ValueError("TRACKING_BASE_URL must be an absolute http:// or https:// URL, for example http://localhost:5173")
    return value


def _session_lifetime_seconds(raw: str) -> int:
    """Sign-in lifetime in seconds. Must be a number of hours between 0.1 and 168 (one week)."""
    try:
        hours = float(raw)
    except ValueError as exc:
        raise ValueError("SESSION_LIFETIME_HOURS must be a number of hours, for example 12") from exc
    if not 0.1 <= hours <= 168:
        raise ValueError("SESSION_LIFETIME_HOURS must be between 0.1 and 168")
    return int(hours * 3600)


def _resolve_database_path(raw: str) -> str:
    path = Path(raw)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return str(path)


def build_config() -> dict[str, object]:
    """Build the configuration mapping from the current environment."""
    lifetime_seconds = _session_lifetime_seconds(os.getenv("SESSION_LIFETIME_HOURS", "12"))
    return {
        "APP_NAME": os.getenv("APP_NAME", "Blockchain Product Tracking"),
        "DATABASE_PATH": _resolve_database_path(
            os.getenv("DATABASE_PATH", str(DEFAULT_DATABASE_PATH))
        ),
        "CORS_ORIGINS": _env_list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        "DEBUG": _env_bool("FLASK_DEBUG", False),
        "SECRET_KEY": os.getenv("SECRET_KEY") or _GENERATED_SECRET_KEY,
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        # Localhost runs over plain HTTP, so Secure cookies would not be sent. Enable behind HTTPS.
        "SESSION_COOKIE_SECURE": _env_bool("SESSION_COOKIE_SECURE", False),
        # Idle-independent lifetime of a sign-in. The browser cookie and the server check both use it.
        "SESSION_LIFETIME_SECONDS": lifetime_seconds,
        "PERMANENT_SESSION_LIFETIME": timedelta(seconds=lifetime_seconds),
        # Host used in QR codes. Use the host machine's LAN address when scanning from another device.
        "TRACKING_BASE_URL": _tracking_base_url(os.getenv("TRACKING_BASE_URL", "http://localhost:5173")),
    }
