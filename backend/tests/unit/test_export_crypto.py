"""GME1 流式分块加密导出格式单元测试（含多块、空流、错口令、截断、篡改、重排与文件解密）。"""

import base64
import hashlib
import json
import stat
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.export_crypto import (
    MAGIC,
    ExportDecryptionError,
    decrypt_export_file,
    decrypt_stream,
    derive_export_key,
    encrypt_stream,
)

# 单元测试使用低成本合规 Argon2id 参数以加速执行；生产默认 64 MiB。
FAST_KDF = {"time_cost": 1, "memory_cost_kib": 8192, "parallelism": 1}


def test_encrypt_decrypt_roundtrip_multi_chunk_and_empty():
    passphrase = "correct horse battery staple export 2026"
    # 多块（> 4096 * 3）
    payload = b"header,password\n" + (b"user@gmail.com,=secret+pass@123\n" * 500)
    encrypted = b"".join(
        encrypt_stream(
            [payload[:100], payload[100:9000], payload[9000:]],
            passphrase,
            chunk_size=4096,
            **FAST_KDF,
        )
    )
    assert encrypted.startswith(MAGIC)
    assert b"=secret+pass@123" not in encrypted

    # 按任意小分片流式解密
    decrypted = b"".join(
        decrypt_stream((encrypted[i : i + 77] for i in range(0, len(encrypted), 77)), passphrase)
    )
    assert decrypted == payload

    # 空明文流同样产生带末块认证标签的有效密文
    empty_enc = b"".join(encrypt_stream([], passphrase, chunk_size=4096, **FAST_KDF))
    assert b"".join(decrypt_stream([empty_enc], passphrase)) == b""


def test_wrong_passphrase_tamper_truncation_and_trailing_bytes():
    passphrase = "correct horse battery staple export 2026"
    payload = b"a" * 10000
    encrypted = bytearray(
        b"".join(encrypt_stream([payload], passphrase, chunk_size=4096, **FAST_KDF))
    )

    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([bytes(encrypted)], "wrong horse battery staple 9999"))

    # 篡改头部字节（触发 AAD 校验失败）
    bad_header = bytearray(encrypted)
    bad_header[20] ^= 0x01
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([bytes(bad_header)], passphrase))

    # 篡改密文字节
    bad_body = bytearray(encrypted)
    bad_body[-5] ^= 0xFF
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([bytes(bad_body)], passphrase))

    # 截断末块（防截断攻击）
    truncated = bytes(encrypted[: 42 + 5 + 4096 + 16])
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([truncated], passphrase))

    # 末尾附加未认证字节
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([bytes(encrypted) + b"extra"], passphrase))

    # 非法头部魔数 / 截断头部 / 非法 KDF 参数
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([b"BAD!"], passphrase))
    with pytest.raises(ExportDecryptionError):
        b"".join(decrypt_stream([b"XXXX" + bytes(encrypted[4:])], passphrase))
    with pytest.raises(ExportDecryptionError):
        derive_export_key("", b"0" * 16)
    with pytest.raises(ExportDecryptionError):
        derive_export_key(passphrase, b"short")
    with pytest.raises(ExportDecryptionError):
        derive_export_key(passphrase, b"0" * 16, memory_cost_kib=128)
    with pytest.raises(ValueError):
        list(encrypt_stream([b"hi"], passphrase, chunk_size=1024, **FAST_KDF))


def test_decrypt_export_file_permissions_and_cleanup_on_failure(tmp_path):
    passphrase = "offline file decrypt passphrase 2026!"
    payload = b"\xef\xbb\xbfgmail_email,password\nalice@gmail.com,=Pass#123\n"
    enc_file = tmp_path / "export.gmenc"
    out_file = tmp_path / "export.csv"
    enc_file.write_bytes(
        b"".join(encrypt_stream([payload], passphrase, chunk_size=4096, **FAST_KDF))
    )

    written = decrypt_export_file(enc_file, out_file, passphrase)
    assert written == len(payload)
    assert out_file.read_bytes() == payload
    assert stat.S_IMODE(out_file.stat().st_mode) == 0o600

    # 口令错误时绝不保留半成品文件
    bad_out = tmp_path / "bad.csv"
    with pytest.raises(ExportDecryptionError):
        decrypt_export_file(enc_file, bad_out, "wrong offline passphrase 2026!")
    assert not bad_out.exists()
    assert not list(tmp_path.glob("*.decrypt.tmp"))


def test_gme1_frozen_cross_version_vectors():
    fixture_path = Path(__file__).resolve().parents[1] / "fixtures" / "gme1_vectors.json"
    spec = json.loads(fixture_path.read_text(encoding="utf-8"))

    passphrase = spec["passphrase"]
    salt = bytes.fromhex(spec["salt_hex"])
    nonce_prefix = bytes.fromhex(spec["nonce_prefix_hex"])
    kdf = spec["kdf"]
    chunk_size = spec["chunk_size"]

    derived = derive_export_key(passphrase, salt, **kdf)
    assert derived.hex() == spec["expected_key_hex"]

    for name, vector in spec["vectors"].items():
        expected_plaintext = base64.b64decode(vector["plaintext_b64"])
        frozen_ciphertext = base64.b64decode(vector["ciphertext_b64"])
        assert hashlib.sha256(expected_plaintext).hexdigest() == vector["plaintext_sha256"], name
        assert hashlib.sha256(frozen_ciphertext).hexdigest() == vector["ciphertext_sha256"], name
        assert frozen_ciphertext.startswith(MAGIC), name

        # 纯离线流式解密固化密文（不依赖当前加密实现），保障跨版本向后兼容。
        decrypted = b"".join(
            decrypt_stream(
                (frozen_ciphertext[i : i + 19] for i in range(0, len(frozen_ciphertext), 19)),
                passphrase,
            )
        )
        assert decrypted == expected_plaintext, name

        # 固定 salt 与 nonce_prefix 时，加密结果必须与固化向量逐字节一致。
        with patch("app.core.export_crypto.os.urandom", side_effect=[salt, nonce_prefix]):
            reproduced = b"".join(
                encrypt_stream([expected_plaintext], passphrase, chunk_size=chunk_size, **kdf)
            )
        assert reproduced == frozen_ciphertext, name
