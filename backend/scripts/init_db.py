"""Create the SQLite database and schema.

Usage (from the backend/ folder):
    python scripts/init_db.py

Safe to run repeatedly; existing tables, rows and demo passwords are left in place.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.config import build_config  # noqa: E402
from app.db import connect, init_db  # noqa: E402
from app.services.access_service import demo_accounts_missing_password  # noqa: E402


def main() -> int:
    database_path = str(build_config()["DATABASE_PATH"])
    tables = init_db(database_path)
    print(f"Database ready: {database_path}")
    print("Tables: " + ", ".join(tables))
    missing = demo_accounts_missing_password(connect(database_path))
    if missing:
        print(
            "Demo accounts without a password (they cannot sign in): " + ", ".join(missing)
            + ". Set DEMO_FARMER_PASSWORD, DEMO_DISTRIBUTOR_PASSWORD and DEMO_RETAILER_PASSWORD in backend/.env, then run this script again."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
