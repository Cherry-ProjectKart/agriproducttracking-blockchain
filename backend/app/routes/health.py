"""Health-check endpoint: GET /api/health (blueprint prefix is applied in app/__init__.py)."""

from flask import Blueprint, current_app, jsonify

from app.services.health_service import get_health_status

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    payload, status_code = get_health_status(
        current_app.config["APP_NAME"],
        current_app.config["DATABASE_PATH"],
    )
    return jsonify(payload), status_code
