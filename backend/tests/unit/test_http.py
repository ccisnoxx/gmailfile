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


def test_csv_upload_middleware_order_host_request_id_and_mime(settings, monkeypatch, caplog):
    settings.max_import_size_mb = 1
    monkeypatch.setattr("app.main.schema_is_current", lambda engine: True)

    with (
        caplog.at_level("INFO", logger="gmail_manager"),
        TestClient(create_app(settings)) as client,
    ):
        # 1. Host validation executes BEFORE CsvUploadLimit.
        bad_host = client.post(
            "/api/v1/imports/csv/preview",
            content=b"a,b\n1,2\n",
            headers={"host": "attacker.example", "content-type": "application/pdf"},
        )
        assert bad_host.status_code == 400
        assert bad_host.json()["error"]["code"] == "INVALID_HOST"
        assert bad_host.headers["X-Request-ID"] == bad_host.json()["request_id"]
        assert bad_host.headers["Cache-Control"] == "no-store"

        # 2. Unauthenticated request is rejected with 401 before buffering body.
        unauth = client.post(
            "/api/v1/imports/csv/preview",
            content=b"x" * (1024 * 1024 + 16),
            headers={"content-type": "text/csv"},
        )
        assert unauth.status_code == 401
        assert unauth.json()["error"]["code"] == "AUTH_REQUIRED"
        assert unauth.headers["X-Request-ID"] == unauth.json()["request_id"]
        assert unauth.headers["Cache-Control"] == "no-store"

        # 3. Authenticated cookie + wrong MIME -> 415 with consistent X-Request-ID and no-store.
        bad_mime = client.post(
            "/api/v1/imports/csv/preview",
            content=b"a,b\n",
            headers={
                "cookie": "__Host-gm_session=synthetic",
                "content-type": "application/json",
            },
        )
        assert bad_mime.status_code == 415
        assert bad_mime.json()["error"]["code"] == "CSV_TYPE_INVALID"
        assert bad_mime.headers["X-Request-ID"] == bad_mime.json()["request_id"]
        assert bad_mime.headers["Cache-Control"] == "no-store"

        # 4. Authenticated cookie + oversized payload -> 413 with X-Request-ID and no-store.
        too_large = client.post(
            "/api/v1/imports/csv/preview",
            content=b"x" * (1024 * 1024 + 1),
            headers={
                "cookie": "__Host-gm_session=synthetic",
                "content-type": "text/csv; charset=utf-8",
            },
        )
        assert too_large.status_code == 413
        assert too_large.json()["error"]["code"] == "CSV_TOO_LARGE"
        assert too_large.headers["X-Request-ID"] == too_large.json()["request_id"]
        assert too_large.headers["Cache-Control"] == "no-store"

        # 5. Media type with whitespace before ';' passes CsvUploadLimit (not 415).
        spaced_mime = client.post(
            "/api/v1/imports/csv/preview",
            content=b"gmail_email,password,recovery_email\n",
            headers={
                "cookie": "__Host-gm_session=synthetic",
                "content-type": "text/csv ; charset=utf-8",
            },
        )
        assert spaced_mime.status_code != 415
        assert spaced_mime.headers["Cache-Control"] == "no-store"

    completed_statuses = [
        record.safe_fields["status_code"]
        for record in caplog.records
        if record.getMessage() == "request_completed" and hasattr(record, "safe_fields")
    ]
    assert {400, 401, 415, 413}.issubset(set(completed_statuses))
