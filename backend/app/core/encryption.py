"""版本化 AES-256-GCM；调用方必须传入真实实体、记录 ID 和字段名。"""

import os
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class DecryptionError(Exception):
    def __init__(self):
        super().__init__("无法解密敏感数据")


@dataclass(frozen=True)
class EncryptedValue:
    ciphertext: bytes
    nonce: bytes
    key_version: int


class EncryptionService:
    def __init__(self, directory: Path, active_version: int):
        self.keys = {}
        for path in directory.glob("data_key_v*"):
            suffix = path.name.removeprefix("data_key_v")
            if suffix.isdecimal():
                key = path.read_bytes()
                if len(key) != 32:
                    raise ValueError("数据密钥必须是 32 字节原始随机值")
                self.keys[int(suffix)] = AESGCM(key)
        if active_version not in self.keys:
            raise ValueError("当前数据密钥未配置")
        self.active_version = active_version

    @staticmethod
    def aad(entity: str, record_id: UUID, field: str, version: int) -> bytes:
        return f"{entity}:{record_id}:{field}:v{version}".encode()

    def encrypt(self, value: str, entity: str, record_id: UUID, field: str) -> EncryptedValue:
        return self.encrypt_with_version(value, entity, record_id, field, self.active_version)

    def encrypt_with_version(
        self, value: str, entity: str, record_id: UUID, field: str, version: int
    ) -> EncryptedValue:
        if version not in self.keys:
            raise ValueError(f"目标数据密钥版本 v{version} 未配置")
        nonce = os.urandom(12)
        ciphertext = self.keys[version].encrypt(
            nonce, value.encode(), self.aad(entity, record_id, field, version)
        )
        return EncryptedValue(ciphertext, nonce, version)

    def decrypt(self, value: EncryptedValue, entity: str, record_id: UUID, field: str) -> str:
        try:
            return (
                self.keys[value.key_version]
                .decrypt(
                    value.nonce,
                    value.ciphertext,
                    self.aad(entity, record_id, field, value.key_version),
                )
                .decode()
            )
        except (InvalidTag, KeyError, ValueError, UnicodeDecodeError):
            raise DecryptionError() from None
