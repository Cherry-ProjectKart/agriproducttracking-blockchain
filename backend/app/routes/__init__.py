"""REST API routing. All feature blueprints are nested under the /api prefix."""

from flask import Blueprint

from app.routes.accounts import accounts_bp
from app.routes.access import access_bp
from app.routes.batches import batches_bp
from app.routes.health import health_bp
from app.routes.profile import profile_bp
from app.routes.history import history_bp
from app.routes.ledger import ledger_bp
from app.routes.receipts import receipts_bp
from app.routes.shipments import shipments_bp
from app.routes.tracking import tracking_bp

api_bp = Blueprint("api", __name__)
api_bp.register_blueprint(health_bp)
api_bp.register_blueprint(access_bp)
api_bp.register_blueprint(accounts_bp)
api_bp.register_blueprint(profile_bp)
api_bp.register_blueprint(batches_bp)
api_bp.register_blueprint(ledger_bp)
api_bp.register_blueprint(shipments_bp)
api_bp.register_blueprint(receipts_bp)
api_bp.register_blueprint(history_bp)
api_bp.register_blueprint(tracking_bp)
