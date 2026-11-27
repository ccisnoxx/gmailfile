"""加密 CSV 导出→解密→空库导入无损往返测试，以及备份恢复表清单与 ORM 元数据一致性测试。"""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import app.models  # noqa: F401
from app.core.encryption import EncryptionService
from app.core.export_crypto import decrypt_stream, encrypt_stream
from app.core.release_meta import SCHEMA_VERSION
from app.db.base import Base
from app.models import GmailAccount
from app.schemas.operations import CsvOptions
from app.services.accounts.detail import AccountDetailService
from app.services.csv_transfer.analyzer import CsvImportAnalyzer
from app.services.csv_transfer.exporter import _format_encrypted_row
from app.services.csv_transfer.parser import (
    ENCRYPTED_EXPORT_FIELDS,
    decode_csv_tags,
    encode_csv_tags,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from infra.backup import receiver  # noqa: E402

BACKUP_SPEC = importlib.util.spec_from_file_location(
    "gm_backup_tool_roundtrip", REPO_ROOT / "scripts/backup_tool.py"
)
backup_tool = importlib.util.module_from_spec(BACKUP_SPEC)
BACKUP_SPEC.loader.exec_module(backup_tool)

FAST_KDF = {"time_cost": 1, "memory_cost_kib": 8192, "parallelism": 1}


def test_tag_encoding_preserves_pipes_backslashes_and_legacy_values():
    tags = ["Team|Archive", r"Ops\Prod", r"Mix\|Edge", "Normal"]
    encoded = encode_csv_tags(tags)
    assert encoded == r"Team\|Archive|Ops\\Prod|Mix\\\|Edge|Normal"
    assert decode_csv_tags(encoded) == tags

    # 兼容手写 CSV 中未转义的普通反斜杠
    assert decode_csv_tags(r"Win\Subdir|Plain") == [r"Win\Subdir", "Plain"]


def test_encrypted_export_decrypt_and_empty_db_import_roundtrip_is_lossless(settings):
    encryption = EncryptionService(settings.data_key_directory, settings.active_data_key_version)
    account_id = uuid4()
    now = datetime(2026, 11, 27, 8, 30, 0, tzinfo=UTC)

    raw_password = "=cmd|' /C calc'!A0#Pass2026"
    raw_phone = "+86 138 0013 8000"
    raw_notes = "-leading-dash\n第二行含竖线 | 与反斜杠 \\"
    raw_tags = ["Team|Archive", r"Ops\Prod", "核心凭据"]

    pw_enc = encryption.encrypt(raw_password, "gmail_account", account_id, "password")
    ph_enc = encryption.encrypt(raw_phone, "gmail_account", account_id, "phone")
    nt_enc = encryption.encrypt(raw_notes, "gmail_account", account_id, "notes")

    row = GmailAccount(
        id=account_id,
        account_no=42,
        gmail_email="roundtrip.vault@gmail.com",
        gmail_email_normalized="roundtripvault@gmail.com",
        password_ciphertext=pw_enc.ciphertext,
        password_nonce=pw_enc.nonce,
        password_key_version=pw_enc.key_version,
        phone_ciphertext=ph_enc.ciphertext,
        phone_nonce=ph_enc.nonce,
        phone_key_version=ph_enc.key_version,
        notes_ciphertext=nt_enc.ciphertext,
        notes_nonce=nt_enc.nonce,
        notes_key_version=nt_enc.key_version,
        registered_at=now,
        recovery_account_id=None,
        recovery_email_external="ext.recovery@proton.me",
        status="normal",
        two_factor_status="enabled",
        last_login_at=now,
        last_verified_at=now,
        password_changed_at=now,
        purpose="离线灾备迁移验证",
        row_version=3,
        created_at=now,
        updated_at=now,
    )

    csv_buf = io.StringIO(newline="")
    writer = csv.writer(csv_buf)
    writer.writerow(ENCRYPTED_EXPORT_FIELDS)
    writer.writerow(_format_encrypted_row(row, None, raw_tags, encryption))
    plaintext_csv = ("\ufeff" + csv_buf.getvalue()).encode("utf-8")

    passphrase = "offline-recovery-passphrase-2026"
    gmenc_bytes = b"".join(encrypt_stream([plaintext_csv], passphrase, chunk_size=4096, **FAST_KDF))
    decrypted_csv = b"".join(decrypt_stream([gmenc_bytes], passphrase))
    assert decrypted_csv == plaintext_csv

    # 构造空数据库替身，验证默认选项（无需人工取消 account_no 映射）可直接通过预览与建表计划
    empty_db = MagicMock()
    empty_db.scalars.return_value = []
    empty_db.scalar.return_value = None
    detail_service = AccountDetailService(
        auth=SimpleNamespace(db=empty_db, now=now, audit=MagicMock(), require_recent=MagicMock()),
        session=MagicMock(),
        listing=MagicMock(),
    )
    accounts_stub = SimpleNamespace(db=empty_db, recovery=detail_service.recovery)
    analyzer = CsvImportAnalyzer(accounts_stub)

    mapping, columns, results, errors, plans, _snapshot = analyzer.analyze(
        decrypted_csv, CsvOptions(), default_time=now
    )
    assert errors == []
    assert "account_no" not in mapping
    assert columns[0].suggested_field is None
    assert len(results) == 1 and results[0].action == "create"
    assert len(plans) == 1

    _line, existing, model, parsed_tags = plans[0]
    assert existing is None
    assert model.gmail_email == "roundtrip.vault@gmail.com"
    assert model.password.get_secret_value() == raw_password
    assert model.phone.get_secret_value() == raw_phone
    assert model.notes.get_secret_value() == raw_notes
    assert model.recovery_email_external == "ext.recovery@proton.me"
    assert model.purpose == "离线灾备迁移验证"
    assert model.status == "normal"
    assert model.two_factor_status == "enabled"
    assert parsed_tags == raw_tags

    # 手工 CSV 若在新建行提供自定义 account_no 仍必须报错拒绝
    manual_buf = io.StringIO(newline="")
    manual_writer = csv.writer(manual_buf)
    manual_writer.writerow(["account_no", "gmail_email", "password"])
    manual_writer.writerow(["GM-999999", "manual.new@gmail.com", "ManualPass#2026"])
    _m, _c, _r, manual_errors, _p, _s = analyzer.analyze(
        manual_buf.getvalue().encode("utf-8"), CsvOptions(), default_time=now
    )
    assert any(err.field == "account_no" for err in manual_errors)


def test_backup_tables_match_current_orm_metadata_and_preserve_legacy_compatibility(tmp_path):
    orm_tables = set(Base.metadata.tables.keys())
    assert set(receiver.TABLES) == orm_tables
    assert set(backup_tool.TABLES) == orm_tables
    assert {
        "admin_webauthn_credentials",
        "webauthn_challenges",
        "registered_apps",
        "gmail_account_apps",
    } <= set(receiver.TABLES)

    def _write_bundle(
        target: Path,
        schema_ver: str,
        table_names: tuple[str, ...],
        *,
        counts_version: int | None = receiver.COUNTS_VERSION,
    ) -> dict:
        target.mkdir(parents=True, exist_ok=True)
        for name in (receiver.DB_FILE, receiver.CONFIG_FILE):
            (target / name).write_bytes(receiver.AGE_HEADER + b"ciphertext")
        manifest: dict[str, object] = {
            "format": receiver.MAGIC,
            "complete": True,
            "created_at": datetime(2026, 11, 27, 2, 0, tzinfo=UTC).isoformat(),
            "app_version": "0.1.0",
            "schema_version": schema_ver,
            "tools": {
                "pg_dump": "18.7",
                "pg_restore": "18.7",
                "age": "1.2.1",
                "server_major": 18,
            },
            "counts": {t: 0 for t in table_names},
            "compression": "pg-custom-gzip:6",
            "sha256": {
                n: hashlib.sha256((target / n).read_bytes()).hexdigest()
                for n in (receiver.DB_FILE, receiver.CONFIG_FILE)
            },
        }
        if counts_version is not None:
            manifest["counts_version"] = counts_version
        (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    # 1. 新版 counts_version=2 包含完整 14 张业务表 -> 接收端与恢复端均通过
    cur_dir = tmp_path / "current-0008"
    cur_manifest = _write_bundle(cur_dir, SCHEMA_VERSION, receiver.TABLES)
    assert receiver.manifest_value(cur_manifest)["counts"] == cur_manifest["counts"]
    assert backup_tool.read_manifest(cur_dir)["schema_version"] == SCHEMA_VERSION

    # 2. 新版 counts_version=2 若仍只含旧版 10 张表 -> 必须拒绝（防漏检新增表）
    incomplete_dir = tmp_path / "incomplete-0008"
    incomplete_manifest = _write_bundle(incomplete_dir, SCHEMA_VERSION, receiver.LEGACY_TABLES)
    with pytest.raises(receiver.ReceiverError, match="MANIFEST_COUNTS_INVALID"):
        receiver.manifest_value(incomplete_manifest)
    with pytest.raises(backup_tool.OperationError, match="备份表清单不完整"):
        backup_tool.read_manifest(incomplete_dir)

    # 3. 存量未带 counts_version 的历史备份（含升级前 0004/0008 10 表清单）保持向后兼容
    for hist_ver in ("0004", "0008"):
        legacy_dir = tmp_path / f"legacy-{hist_ver}"
        legacy_manifest = _write_bundle(
            legacy_dir, hist_ver, receiver.LEGACY_TABLES, counts_version=None
        )
        assert receiver.manifest_value(legacy_manifest)["schema_version"] == hist_ver
        assert backup_tool.read_manifest(legacy_dir)["schema_version"] == hist_ver
