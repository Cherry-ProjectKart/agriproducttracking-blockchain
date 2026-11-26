"""Environment-based application configuration.

Values are read from environment variables (optionally loaded from backend/.env).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_PATH = BACKEND_DIR / "instance" / "product_tracking.db"

load_dotenv(BACKEND_DIR / ".env")


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _resolve_database_path(raw: str) -> str:
    path = Path(raw)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    return str(path)


def build_config() -> dict[str, object]:
    """Build the configuration mapping from the current environment."""
    return {
        "APP_NAME": os.getenv("APP_NAME", "Blockchain Product Tracking"),
        "DATABASE_PATH": _resolve_database_path(
            os.getenv("DATABASE_PATH", str(DEFAULT_DATABASE_PATH))
        ),
        "CORS_ORIGINS": _env_list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        "DEBUG": _env_bool("FLASK_DEBUG", False),
    }
