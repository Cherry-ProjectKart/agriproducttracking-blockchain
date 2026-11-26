"""Flask application factory."""

from flask import Flask
from flask_cors import CORS

from app.config import build_config
from app.db import register_db
from app.errors import register_error_handlers
from app.routes import api_bp


def create_app(test_config: dict[str, object] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(build_config())
    if test_config:
        app.config.update(test_config)

    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})
    register_db(app)
    register_error_handlers(app)
    app.register_blueprint(api_bp, url_prefix="/api")
    return app
