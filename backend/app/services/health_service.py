"""Health reporting for the API and its database."""

from app.db import check_database


def get_health_status(app_name: str, database_path: str) -> tuple[dict[str, object], int]:
    """Return the health payload and the matching HTTP status code.

    The API is considered healthy (200) only when the database is connected and
    its schema is initialised; otherwise the payload reports the problem with 503.
    """
    database = check_database(database_path)
    healthy = database["status"] == "connected" and database["schema_initialized"] is True
    payload: dict[str, object] = {
        "status": "ok" if healthy else "degraded",
        "application": app_name,
        "database": database,
    }
    return payload, 200 if healthy else 503
