import pytest

from app import create_app
from app.db import init_db
from app.services import account_service
from tests.auth_helpers import DEMO_ENV, DEMO_PASSWORDS

# Test-only, much cheaper scrypt cost. Hashes record their parameters, so verification is unchanged.
TEST_PASSWORD_HASH_METHOD = "scrypt:1024:8:1"


@pytest.fixture(autouse=True)
def demo_passwords_env(monkeypatch):
    """Every test gets known demo passwords from the environment, as a real installation would."""
    for role, env_name in DEMO_ENV.items():
        monkeypatch.setenv(env_name, DEMO_PASSWORDS[role])
    monkeypatch.setattr(account_service, "PASSWORD_HASH_METHOD", TEST_PASSWORD_HASH_METHOD)


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
