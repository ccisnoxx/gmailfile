"""发布失败不能越过迁移/健康/溯源门禁；只用合成目录和命令替身。"""

import asyncio
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.release_attestation import (
    IMAGE_ATTESTATION_KIND,
    SOURCE_ATTESTATION_KIND,
    build_image_attestation_payload,
    build_source_attestation_payload,
    generate_ed25519_keypair_pem,
    sign_attestation,
)
from app.core.release_meta import (
    APP_VERSION,
    SCHEMA_VERSION,
    canonical_source_archive_sha256,
)

SPEC = importlib.util.spec_from_file_location(
    "gm_deploy", Path(__file__).resolve().parents[3] / "scripts/deploy.py"
)
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


@pytest.fixture
def release(tmp_path, monkeypatch):
    target = tmp_path / "releases" / "synthetic-release"
    target.mkdir(parents=True)
    (target / "README.md").write_text("synthetic source\n")
    sbom_path = target / "sbom.cdx.json"
    sbom_path.write_text('{"bomFormat":"CycloneDX","specVersion":"1.5","components":[]}\n')
    sbom_sha = hashlib.sha256(sbom_path.read_bytes()).hexdigest()
    source_sha = canonical_source_archive_sha256(target, ["README.md"])
    manifest = {
        "release_id": target.name,
        "app_version": APP_VERSION,
        "schema_version": SCHEMA_VERSION,
        "git_commit": "a" * 40,
        "git_tree": "b" * 40,
        "git_tag": "v0.1.0",
        "working_tree_clean": True,
        "source_archive_sha256": source_sha,
        "sbom_sha256": sbom_sha,
        "files": ["README.md"],
    }
    (target / "release.json").write_text(json.dumps(manifest))
    images = {
        name: {
            "tag": "synthetic:" + name,
            "id": name,
            "repo_digests": [f"{name}@sha256:{'1' * 64}"],
        }
        for name in ("api", "backup", "postgres", "restore", "test")
    }
    (target / "images.json").write_text(json.dumps(images))

    priv_pem, pub_pem = generate_ed25519_keypair_pem()
    (tmp_path / "release-signing.priv.pem").write_bytes(priv_pem)
    (tmp_path / "release-signing.pub.pem").write_bytes(pub_pem)
    source_att = sign_attestation(
        SOURCE_ATTESTATION_KIND,
        build_source_attestation_payload(
            manifest,
            gate_results=[{"name": "audit-deps-online-strict", "ok": True, "summary": "pass"}],
            build_tools={"python": "3.12.13"},
        ),
        priv_pem,
    )
    (target / "release.attestation.json").write_text(json.dumps(source_att))
    img_att = sign_attestation(
        IMAGE_ATTESTATION_KIND,
        build_image_attestation_payload(manifest, images, build_tools={"python": "3.12.13"}),
        priv_pem,
    )
    (target / "images.attestation.json").write_text(json.dumps(img_att))

    monkeypatch.setattr(deploy, "ROOT", tmp_path)
    return target


def commands(monkeypatch, release, failure=None, schema=SCHEMA_VERSION, label_override=None):
    calls = []
    manifest = json.loads((release / "release.json").read_text())
    labels = deploy.expected_image_labels(manifest)
    if label_override:
        labels.update(label_override)

    def run(command, *, capture=False):
        calls.append(command)
        if command[:3] == ["docker", "image", "inspect"]:
            if "{{json .Config.Labels}}" in command:
                return json.dumps(labels)
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
    calls = commands(monkeypatch, release, lambda command: command[-1] == "migrate")
    activated = []
    monkeypatch.setattr(deploy, "activate", activated.append)
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert any(c[-3:] == ["stop", "api", "backup"] for c in calls)
    assert not any("up" in c and c[-1] == "api" for c in calls)
    assert not activated


def test_database_unhealthy_never_runs_migration(release, monkeypatch):
    calls = commands(monkeypatch, release, lambda c: "up" in c and c[-1] == "postgres")
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert not any("run" in c for c in calls)


def test_unhealthy_candidate_is_stopped_not_left_at_fixed_upstream(release, monkeypatch):
    calls = commands(monkeypatch, release, lambda c: "up" in c and c[-1] == "api")
    with pytest.raises(subprocess.CalledProcessError):
        deploy.deploy(["compose"], release)
    assert calls[-1] == ["compose", "stop", "api"]
    assert not (deploy.ROOT / "current").exists()


def test_healthy_container_without_real_host_port_is_not_activated(release, monkeypatch):
    calls = commands(monkeypatch, release)

    def unavailable():
        raise OSError("synthetic connection refused")

    monkeypatch.setattr(deploy, "loopback_ready", unavailable)
    with pytest.raises(OSError):
        deploy.deploy(["compose"], release)
    assert calls[-1] == ["compose", "stop", "api"]
    assert not (deploy.ROOT / "current").exists()


def test_success_reexecutes_migration_and_only_then_publishes(release, monkeypatch):
    calls = commands(monkeypatch, release)
    deploy.deploy(["compose"], release)
    assert calls.index(["compose", "run", "--rm", "--no-deps", "migrate"]) < next(
        i for i, c in enumerate(calls) if "up" in c and c[-1] == "api"
    )
    assert (deploy.ROOT / "current").resolve() == release
    assert not any(c[-1] == "backup" and "up" in c for c in calls)
    record = json.loads((deploy.ROOT / "active-release.json").read_text())
    assert record["schema_version"] == SCHEMA_VERSION
    assert record["git_commit"] == "a" * 40
    assert record["git_tree"] == "b" * 40
    assert record["source_archive_sha256"]
    assert record["sbom_sha256"]
    assert calls.index(["compose", "stop", "api", "backup"]) < next(
        i for i, c in enumerate(calls) if "up" in c and c[-1] == "postgres"
    )


@pytest.mark.parametrize(
    "schema,compatible", [(f"{int(SCHEMA_VERSION) + 1:04d}", True), (SCHEMA_VERSION, False)]
)
def test_rollback_never_downgrades_or_starts_incompatible_api(
    release, monkeypatch, schema, compatible
):
    calls = commands(monkeypatch, release, schema=schema)
    with pytest.raises(ValueError):
        deploy.deploy(["compose"], release, rollback=True, compatible=compatible)
    assert not any("run" in c or "downgrade" in c for c in calls)
    assert not any("up" in c and c[-1] == "api" for c in calls)


def test_image_tag_drift_stops_before_any_service_change(release, monkeypatch):
    calls = commands(monkeypatch, release)
    value = json.loads((release / "images.json").read_text())
    value["api"]["id"] = "old-image"
    (release / "images.json").write_text(json.dumps(value))
    # 篡改 images.json 后先被镜像签名证明拦下；重签后若本地镜像漂移仍被 docker inspect 拦下
    with pytest.raises(ValueError, match="镜像签名证明与 images.json"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)

    deploy.sign_release_images(release, deploy.ROOT / "release-signing.priv.pem")
    with pytest.raises(ValueError, match="漂移"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)


def test_self_consistent_forged_release_and_key_reuse_are_rejected(release, monkeypatch):
    calls = commands(monkeypatch, release)

    # 1. 攻击者同时篡改源码并重写一致的 release.json / sbom.cdx.json 摘要，但没有受信私钥
    (release / "README.md").write_text("backdoored source\n")
    manifest = json.loads((release / "release.json").read_text())
    manifest["source_archive_sha256"] = canonical_source_archive_sha256(release, ["README.md"])
    (release / "release.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="发布签名证明字段与清单不一致"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)

    # 2. 攻击者使用自己的伪造密钥重签 release.attestation.json，仍被受信公钥拒绝
    attacker_priv, _ = generate_ed25519_keypair_pem()
    forged_att = sign_attestation(
        SOURCE_ATTESTATION_KIND,
        build_source_attestation_payload(manifest, build_tools={"python": "3.12.13"}),
        attacker_priv,
    )
    (release / "release.attestation.json").write_text(json.dumps(forged_att))
    with pytest.raises(ValueError, match="受信发布公钥不匹配"):
        deploy.deploy(["compose"], release)

    # 3. 删除签名证明文件直接拒绝部署
    (release / "release.attestation.json").unlink()
    with pytest.raises(ValueError, match="缺少独立的 Ed25519 签名证明"):
        deploy.deploy(["compose"], release)

    # 4. 复用审计公钥作为发布验签公钥时拒绝通过
    pub_path = deploy.ROOT / "release-signing.pub.pem"
    manifest_orig = json.loads((release / "release.json").read_text())
    valid_att = sign_attestation(
        SOURCE_ATTESTATION_KIND,
        build_source_attestation_payload(manifest_orig, build_tools={"python": "3.12.13"}),
        (deploy.ROOT / "release-signing.priv.pem").read_bytes(),
    )
    (release / "release.attestation.json").write_text(json.dumps(valid_att))
    with pytest.raises(ValueError, match="必须与审计检查点签名密钥分离"):
        deploy.deploy(["compose"], release, audit_public_key=pub_path)


def test_provenance_tampering_and_label_mismatch_stop_before_deploy(release, monkeypatch):
    calls = commands(
        monkeypatch,
        release,
        label_override={"org.opencontainers.image.revision": "c" * 40},
    )
    with pytest.raises(ValueError, match="溯源标签不匹配"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)

    calls = commands(monkeypatch, release)
    (release / "README.md").write_text("tampered source\n")
    with pytest.raises(ValueError, match="源码归档摘要校验失败"):
        deploy.deploy(["compose"], release)
    assert not any("up" in c or "stop" in c for c in calls)

    (release / "README.md").write_text("synthetic source\n")
    (release / "sbom.cdx.json").write_text('{"tampered":true}\n')
    with pytest.raises(ValueError, match="SBOM 摘要校验失败"):
        deploy.deploy(["compose"], release)

    manifest = json.loads((release / "release.json").read_text())
    manifest["working_tree_clean"] = False
    (release / "release.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="工作区不洁净"):
        deploy.deploy(["compose"], release)


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
