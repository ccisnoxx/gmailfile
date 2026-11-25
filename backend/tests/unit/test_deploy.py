"""发布失败不能越过迁移/健康门禁；只用合成目录和命令替身。"""

import asyncio
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

SPEC = importlib.util.spec_from_file_location(
    "gm_deploy", Path(__file__).resolve().parents[3] / "scripts/deploy.py"
)
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


@pytest.fixture
def release(tmp_path, monkeypatch):
    target = tmp_path / "releases" / "synthetic-release"
    target.mkdir(parents=True)
    (target / "release.json").write_text(
        json.dumps(
            {
                "release_id": target.name,
                "schema_version": "0003",
            }
        )
    )
    (target / "images.json").write_text(
        json.dumps(
            {
                name: {"tag": "synthetic:" + name, "id": name}
                for name in ("api", "backup", "postgres", "restore", "test")
            }
        )
    )
    monkeypatch.setattr(deploy, "ROOT", tmp_path)
    return target


def commands(monkeypatch, failure=None, schema="0003"):
    calls = []

    def run(command, *, capture=False):
        calls.append(command)
        if command[:3] == ["docker", "image", "inspect"]:
            return command[-1].split(":")[1]
        if failure and failure(command):
            raise subprocess.CalledProcessError(1, command)
        if "SELECT version_num FROM alembic_version" in command:
            return schema
        return ""

    monkeypatch.setattr(deploy, "run", run)
    monkeypatch.setattr(deploy, "loopback_ready", lambda: None)
    return calls


def test_migration_failure_never_starts_candidate_or_changes_current(release, monkeypatch):
    calls = commands(monkeypatch, lambda command: command[-1] == "migrate")
    activated = []
    monkeypatch.setattr(deploy, "activate", activated.append)
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert any(c[-3:] == ["stop", "api", "backup"] for c in calls)
    assert not any("up" in c and c[-1] == "api" for c in calls)
    assert not activated


def test_database_unhealthy_never_runs_migration(release, monkeypatch):
    calls = commands(monkeypatch, lambda c: "up" in c and c[-1] == "postgres")
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert not any("run" in c for c in calls)


def test_unhealthy_candidate_is_stopped_not_left_at_fixed_upstream(release, monkeypatch):
    calls = commands(monkeypatch, lambda c: "up" in c and c[-1] == "api")
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert calls[-1] == ["compose", "stop", "api"]
    assert not (deploy.ROOT / "current").exists()


def test_healthy_container_without_real_host_port_is_not_activated(release, monkeypatch):
    calls = commands(monkeypatch)

    def unavailable():
        raise OSError("synthetic connection refused")

    monkeypatch.setattr(deploy, "loopback_ready", unavailable)
    with pytest.raises(OSError):
        deploy.deploy(["compose"], release)
    assert calls[-1] == ["compose", "stop", "api"]
    assert not (deploy.ROOT / "current").exists()


def test_success_reexecutes_migration_and_only_then_publishes(release, monkeypatch):
    calls = commands(monkeypatch)
    deploy.deploy(["compose"], release)
    assert calls.index(["compose", "run", "--rm", "--no-deps", "migrate"]) < next(
        i for i, c in enumerate(calls) if "up" in c and c[-1] == "api"
    )
    assert (deploy.ROOT / "current").resolve() == release
    assert not any(c[-1] == "backup" and "up" in c for c in calls)
    record = json.loads((deploy.ROOT / "active-release.json").read_text())
    assert record["schema_version"] == "0003"
    assert calls.index(["compose", "stop", "api", "backup"]) < next(
        i for i, c in enumerate(calls) if "up" in c and c[-1] == "postgres"
    )


@pytest.mark.parametrize("schema,compatible", [("0004", True), ("0003", False)])
def test_rollback_never_downgrades_or_starts_incompatible_api(
    release, monkeypatch, schema, compatible
):
    calls = commands(monkeypatch, schema=schema)
    with pytest.raises(ValueError):
        deploy.deploy(["compose"], release, rollback=True, compatible=compatible)
    assert not any("run" in c or "downgrade" in c for c in calls)
    assert not any("up" in c and c[-1] == "api" for c in calls)


def test_image_tag_drift_stops_before_any_service_change(release, monkeypatch):
    calls = commands(monkeypatch)
    value = json.loads((release / "images.json").read_text())
    value["api"]["id"] = "old-image"
    (release / "images.json").write_text(json.dumps(value))
    with pytest.raises(ValueError, match="漂移"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)


@pytest.mark.parametrize(
    "source,expected,scheme",
    [
        ("10.203.1.1", "198.51.100.77", "https"),
        ("10.203.0.5", "10.203.0.5", "http"),
        ("203.0.113.8", "203.0.113.8", "http"),
    ],
)
def test_only_exact_production_gateway_can_supply_client_ip(source, expected, scheme):
    observed = []

    async def app(scope, receive, send):
        observed.append((scope["client"][0], scope["scheme"]))

    middleware = ProxyHeadersMiddleware(app, trusted_hosts="10.203.1.1")
    scope = {
        "type": "http",
        "client": (source, 50000),
        "scheme": "http",
        "headers": [
            (b"x-forwarded-for", b"198.51.100.77"),
            (b"x-forwarded-proto", b"https"),
        ],
    }
    asyncio.run(middleware(scope, None, None))
    assert observed == [(expected, scheme)]
