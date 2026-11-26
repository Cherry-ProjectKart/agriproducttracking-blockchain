import pytest

from app import create_app
from app.db import init_db


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "test_product_tracking.db")


@pytest.fixture
def app(db_path):
    application = create_app(
        {
            "TESTING": True,
            "DATABASE_PATH": db_path,
            "APP_NAME": "Test App",
            "SECRET_KEY": "test-secret-key-not-for-production",
        }
    )
    init_db(db_path)
    return application


@pytest.fixture
def client(app):
    return app.test_client()
