"""REST API routing. All feature blueprints are nested under the /api prefix."""

from flask import Blueprint

from app.routes.health import health_bp

api_bp = Blueprint("api", __name__)
api_bp.register_blueprint(health_bp)
