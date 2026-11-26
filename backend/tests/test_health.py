from app import create_app


def test_health_reports_ok_when_database_initialised(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    assert body["application"] == "Test App"
    assert body["database"]["status"] == "connected"
    assert body["database"]["schema_initialized"] is True


def test_health_reports_degraded_when_database_missing(tmp_path):
    missing_db = str(tmp_path / "missing.db")
    app = create_app({"TESTING": True, "DATABASE_PATH": missing_db})
    response = app.test_client().get("/api/health")

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "degraded"
    assert body["database"]["status"] == "disconnected"
    assert body["database"]["schema_initialized"] is False
    # The health check must not create the database file as a side effect.
    assert not (tmp_path / "missing.db").exists()


def test_unknown_api_route_returns_json_error(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == 404


def test_cors_allows_configured_frontend_origin(client):
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
