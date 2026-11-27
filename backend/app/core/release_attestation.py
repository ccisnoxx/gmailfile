"""独立 Ed25519 发布签名证明：覆盖源码归档、SBOM、门禁结果、构建工具版本与最终镜像摘要。

本模块与审计检查点密钥严格分离，并通过独立域分离前缀防止跨用途签名重放。
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

ATTESTATION_VERSION = 1
SOURCE_ATTESTATION_KIND = "release-source-attestation"
ARCHIVE_ATTESTATION_KIND = "release-archive-attestation"
IMAGE_ATTESTATION_KIND = "release-image-attestation"

_DOMAIN_PREFIXES: dict[str, bytes] = {
    SOURCE_ATTESTATION_KIND: b"gmail-manager-release-source-attestation-v1\n",
    ARCHIVE_ATTESTATION_KIND: b"gmail-manager-release-archive-attestation-v1\n",
    IMAGE_ATTESTATION_KIND: b"gmail-manager-release-image-attestation-v1\n",
}


def generate_ed25519_keypair_pem() -> tuple[bytes, bytes]:
    """生成一对独立的 Ed25519 PEM 私钥与公钥（仅用于发布证明，不得与审计密钥复用）。"""
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem


def load_ed25519_private_key(pem_bytes: bytes) -> Ed25519PrivateKey:
    try:
        key = serialization.load_pem_private_key(pem_bytes, password=None)
    except (ValueError, TypeError) as exc:
        raise ValueError("无效的发布签名 Ed25519 PEM 私钥文件") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("发布签名私钥必须是 Ed25519 私钥")
    return key


def load_ed25519_public_key(pem_bytes: bytes) -> Ed25519PublicKey:
    try:
        key = serialization.load_pem_public_key(pem_bytes)
    except (ValueError, TypeError) as exc:
        raise ValueError("无效的发布验签 Ed25519 PEM 公钥文件") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("发布验签公钥必须是 Ed25519 公钥")
    return key


def ed25519_key_id(public_key: Ed25519PublicKey) -> str:
    raw_pub = public_key.public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    return hashlib.sha256(raw_pub).hexdigest()[:16]


def _extract_ed25519_key_id_from_pem(pem_bytes: bytes) -> str | None:
    stripped = pem_bytes.lstrip()
    if not stripped.startswith(b"-----BEGIN "):
        return None
    try:
        pub = serialization.load_pem_public_key(pem_bytes)
        if isinstance(pub, Ed25519PublicKey):
            return ed25519_key_id(pub)
    except (ValueError, TypeError):
        pass
    try:
        priv = serialization.load_pem_private_key(pem_bytes, password=None)
        if isinstance(priv, Ed25519PrivateKey):
            return ed25519_key_id(priv.public_key())
    except (ValueError, TypeError):
        pass
    return None


def assert_key_separated_from_audit(
    release_public_key: Ed25519PublicKey, audit_key_pem: bytes | None
) -> None:
    """若提供审计公钥/私钥，强制校验发布签名密钥与审计检查点密钥不是同一密钥。"""
    if audit_key_pem is None:
        return
    audit_kid = _extract_ed25519_key_id_from_pem(audit_key_pem)
    if audit_kid is not None and audit_kid == ed25519_key_id(release_public_key):
        raise ValueError("发布签名密钥必须与审计检查点签名密钥分离，禁止复用同一密钥")


def _probe_tool_version(cmd: list[str]) -> str | None:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    line = (proc.stdout or proc.stderr or "").strip().splitlines()
    return line[0].strip() if line else None


def collect_build_tool_versions(*, include_docker: bool = False) -> dict[str, str]:
    """采集当前发布/构建机关键工具版本，写入签名证明便于溯源复现。"""
    versions: dict[str, str] = {"python": platform.python_version()}
    probes = [
        ("git", ["git", "--version"]),
        ("uv", ["uv", "--version"]),
        ("node", ["node", "--version"]),
        ("pnpm", ["pnpm", "--version"]),
    ]
    if include_docker:
        probes.extend(
            [
                ("docker", ["docker", "--version"]),
                ("docker_buildx", ["docker", "buildx", "version"]),
            ]
        )
    for name, cmd in probes:
        val = _probe_tool_version(cmd)
        if val:
            versions[name] = val
    return versions


def _canonical_signing_bytes(envelope: dict[str, object]) -> bytes:
    kind = envelope.get("kind")
    if not isinstance(kind, str) or kind not in _DOMAIN_PREFIXES:
        raise ValueError("不支持的发布证明类型")
    signed_body = {
        "version": envelope["version"],
        "kind": kind,
        "algorithm": envelope["algorithm"],
        "key_id": envelope["key_id"],
        "signed_at": envelope["signed_at"],
        "payload": envelope["payload"],
    }
    encoded = json.dumps(
        signed_body, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return _DOMAIN_PREFIXES[kind] + encoded


def sign_attestation(
    kind: str,
    payload: dict[str, object],
    private_key_pem: bytes,
    *,
    now: datetime | None = None,
    audit_key_pem: bytes | None = None,
) -> dict[str, object]:
    if kind not in _DOMAIN_PREFIXES:
        raise ValueError(f"不支持的发布证明类型：{kind}")
    private_key = load_ed25519_private_key(private_key_pem)
    public_key = private_key.public_key()
    assert_key_separated_from_audit(public_key, audit_key_pem)
    envelope: dict[str, object] = {
        "version": ATTESTATION_VERSION,
        "kind": kind,
        "algorithm": "ed25519",
        "key_id": ed25519_key_id(public_key),
        "signed_at": (now or datetime.now(UTC)).astimezone(UTC).isoformat(),
        "payload": payload,
    }
    envelope["signature"] = private_key.sign(_canonical_signing_bytes(envelope)).hex()
    return envelope


def verify_attestation(
    attestation: dict[str, object],
    expected_kind: str,
    public_key_pem: bytes,
    *,
    audit_key_pem: bytes | None = None,
) -> dict[str, object]:
    if not isinstance(attestation, dict):
        raise ValueError("发布证明格式非法")
    if attestation.get("version") != ATTESTATION_VERSION:
        raise ValueError("发布证明版本不受支持")
    if attestation.get("kind") != expected_kind:
        raise ValueError("发布证明类型不匹配")
    if attestation.get("algorithm") != "ed25519":
        raise ValueError("发布证明签名算法不受支持")
    signature = attestation.get("signature")
    if not isinstance(signature, str):
        raise ValueError("发布证明缺少签名字段")
    payload = attestation.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("发布证明缺少有效 payload")

    public_key = load_ed25519_public_key(public_key_pem)
    assert_key_separated_from_audit(public_key, audit_key_pem)
    expected_kid = ed25519_key_id(public_key)
    if attestation.get("key_id") != expected_kid:
        raise ValueError("发布证明签名密钥 ID 与受信发布公钥不匹配")
    try:
        sig_bytes = bytes.fromhex(signature)
        public_key.verify(sig_bytes, _canonical_signing_bytes(attestation))
    except (ValueError, KeyError, InvalidSignature) as exc:
        raise ValueError("发布证明 Ed25519 签名校验失败") from exc
    return payload


def build_source_attestation_payload(
    manifest: dict[str, object],
    *,
    gate_results: list[dict[str, object]] | None = None,
    build_tools: dict[str, str] | None = None,
) -> dict[str, object]:
    return {
        "release_id": manifest["release_id"],
        "app_version": manifest["app_version"],
        "schema_version": manifest["schema_version"],
        "git_commit": manifest["git_commit"],
        "git_tree": manifest["git_tree"],
        "git_tag": manifest.get("git_tag"),
        "git_tag_signed": bool(manifest.get("git_tag_signed", False)),
        "working_tree_clean": bool(manifest.get("working_tree_clean", False)),
        "source_archive_sha256": manifest["source_archive_sha256"],
        "sbom_sha256": manifest["sbom_sha256"],
        "locks": manifest.get("locks") or {},
        "base_images": manifest.get("base_images") or {},
        "gate_results": list(gate_results) if gate_results is not None else [],
        "build_tools": dict(build_tools) if build_tools is not None else {},
    }


def build_archive_attestation_payload(
    manifest: dict[str, object], *, archive_name: str, archive_sha256: str
) -> dict[str, object]:
    return {
        "release_id": manifest["release_id"],
        "app_version": manifest["app_version"],
        "schema_version": manifest["schema_version"],
        "git_commit": manifest["git_commit"],
        "git_tree": manifest["git_tree"],
        "source_archive_sha256": manifest["source_archive_sha256"],
        "sbom_sha256": manifest["sbom_sha256"],
        "archive_name": archive_name,
        "archive_sha256": archive_sha256,
    }


def _normalize_image_records(images: dict[str, dict[str, object]]) -> dict[str, dict[str, object]]:
    normalized: dict[str, dict[str, object]] = {}
    for name in sorted(images):
        rec = images[name]
        normalized[name] = {
            "tag": rec.get("tag"),
            "id": rec.get("id"),
            "repo_digests": sorted(rec.get("repo_digests") or []),
        }
    return normalized


def build_image_attestation_payload(
    manifest: dict[str, object],
    images: dict[str, dict[str, object]],
    *,
    build_tools: dict[str, str] | None = None,
) -> dict[str, object]:
    return {
        "release_id": manifest["release_id"],
        "app_version": manifest["app_version"],
        "schema_version": manifest["schema_version"],
        "git_commit": manifest["git_commit"],
        "git_tree": manifest["git_tree"],
        "source_archive_sha256": manifest["source_archive_sha256"],
        "sbom_sha256": manifest["sbom_sha256"],
        "images": _normalize_image_records(images),
        "build_tools": dict(build_tools) if build_tools is not None else {},
    }


def verify_release_source_attestation(
    attestation: dict[str, object],
    manifest: dict[str, object],
    public_key_pem: bytes,
    *,
    audit_key_pem: bytes | None = None,
) -> dict[str, object]:
    payload = verify_attestation(
        attestation,
        SOURCE_ATTESTATION_KIND,
        public_key_pem,
        audit_key_pem=audit_key_pem,
    )
    required_equal = (
        "release_id",
        "app_version",
        "schema_version",
        "git_commit",
        "git_tree",
        "source_archive_sha256",
        "sbom_sha256",
    )
    for field in required_equal:
        if payload.get(field) != manifest.get(field):
            raise ValueError(f"发布签名证明字段与清单不一致：{field}")
    if payload.get("working_tree_clean") is not True:
        raise ValueError("发布签名证明显示工作区不洁净，拒绝部署")
    if "locks" in manifest and payload.get("locks") != manifest.get("locks"):
        raise ValueError("发布签名证明中的锁文件摘要与清单不一致")
    if "base_images" in manifest and payload.get("base_images") != manifest.get("base_images"):
        raise ValueError("发布签名证明中的基础镜像摘要与清单不一致")
    gate_results = payload.get("gate_results")
    if not isinstance(gate_results, list):
        raise ValueError("发布签名证明中的门禁记录格式非法")
    for gate in gate_results:
        if not isinstance(gate, dict) or gate.get("ok") is not True:
            raise ValueError("发布签名证明包含未通过的门禁项目，拒绝部署")
    if not isinstance(payload.get("build_tools"), dict) or not payload["build_tools"]:
        raise ValueError("发布签名证明缺少构建工具版本记录")
    return payload


def verify_release_image_attestation(
    attestation: dict[str, object],
    manifest: dict[str, object],
    images: dict[str, dict[str, object]],
    public_key_pem: bytes,
    *,
    audit_key_pem: bytes | None = None,
) -> dict[str, object]:
    payload = verify_attestation(
        attestation,
        IMAGE_ATTESTATION_KIND,
        public_key_pem,
        audit_key_pem=audit_key_pem,
    )
    for field in (
        "release_id",
        "app_version",
        "schema_version",
        "git_commit",
        "git_tree",
        "source_archive_sha256",
        "sbom_sha256",
    ):
        if payload.get(field) != manifest.get(field):
            raise ValueError(f"镜像签名证明字段与发布清单不一致：{field}")
    if payload.get("images") != _normalize_image_records(images):
        raise ValueError("镜像签名证明与 images.json 摘要或标签不一致")
    return payload


def load_gate_report(report_path: Path) -> list[dict[str, object]]:
    """读取并校验 check-release-gates.py --json 输出的门禁报告，全量 PASS 方可签发证明。"""
    try:
        raw = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取或解析门禁报告 JSON：{report_path}") from exc
    if not isinstance(raw, list) or not raw:
        raise ValueError("门禁报告必须是非空 JSON 数组")
    normalized: list[dict[str, object]] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValueError("门禁报告包含非法条目")
        if item.get("ok") is not True:
            raise ValueError(f"门禁检查未通过，禁止签发发布证明：{item['name']}")
        normalized.append(
            {
                "name": item["name"],
                "ok": True,
                "summary": str(item.get("summary", "")),
            }
        )
    return normalized
