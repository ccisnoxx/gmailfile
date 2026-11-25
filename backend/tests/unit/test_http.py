from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(settings, monkeypatch):
    monkeypatch.setattr("app.main.schema_is_current", lambda engine: True)
    with TestClient(create_app(settings)) as client:
        yield client


def test_live_and_request_id(client):
    response = client.get("/api/v1/health/live")
    assert response.json() == {"status": "ok"}
    UUID(response.headers["X-Request-ID"])
    assert response.headers["Cache-Control"] == "no-store"
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("path", ["/register", "/api/docs", "/api/openapi.json"])
def test_unimplemented_and_private_routes_not_exposed(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_host_validation(client):
    response = client.get("/api/v1/health/live", headers={"host": "attacker.example"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_HOST"


def test_method_error_preserves_protocol_headers(client):
    response = client.post("/api/v1/health/live")
    assert response.status_code == 405
    assert "GET" in response.headers["Allow"]
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_unexpected_errors_do_not_leak(client):
    @client.app.get("/test-error")
    def fail():
        raise RuntimeError("private-password-do-not-log")

    response = client.get("/test-error")
    assert response.status_code == 500
    assert "private-password" not in response.text


def test_validation_errors_do_not_echo_input(client):
    @client.app.get("/test-validation")
    def validate(code: int):
        return {"code": code}

    response = client.get("/test-validation?code=private-password-do-not-log")
    assert response.status_code == 422
    assert "private-password" not in response.text


def test_ready_database_failure_is_generic(client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    def unavailable(engine):
        raise OperationalError("private SQL", {}, Exception("private detail"))

    monkeypatch.setattr("app.api.v1.system.schema_is_current", unavailable)
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert "private" not in response.text


def test_api_refuses_unmigrated_database(settings, monkeypatch):
    monkeypatch.setattr("app.main.schema_is_current", lambda engine: False)
    with pytest.raises(RuntimeError, match="迁移未完成"), TestClient(create_app(settings)):
        pass


def test_openapi_uses_declared_response_schemas(settings):
    schema = create_app(settings).openapi()
    assert schema["openapi"].startswith("3.1")
    assert {"/api/v1/health/live", "/api/v1/health/ready", "/api/v1/auth/login"} <= set(
        schema["paths"]
    )
    assert not any("register" in path or "create-admin" in path for path in schema["paths"])
    assert "SessionResponse" in schema["components"]["schemas"]
    assert "HealthResponse" in schema["components"]["schemas"]
