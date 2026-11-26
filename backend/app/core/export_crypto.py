"""版本化分块流式加密导出格式（GME1 / .gmenc）：Argon2id + AES-256-GCM。

二进制布局：
- 文件头（42 字节）：
  magic(4B='GME1') | version(u8=1) | kdf_id(u8=1) |
  time_cost(u32) | memory_cost_kib(u32) | parallelism(u32) |
  salt(16B) | nonce_prefix(4B) | chunk_size(u32)
- 紧随若干加密帧：
  flags(u8: 0x00=中间块, 0x01=末块) | ciphertext_len(u32) | ciphertext(含 16B GCM tag)
- 每块独立 12 字节 nonce = nonce_prefix(4B) || chunk_index(u64 BE)
- 每块 AAD = header(42B) || flags(u8) || chunk_index(u64 BE)，防头部篡改、块重排与截断。
"""

from __future__ import annotations

import os
import struct
from collections.abc import Iterable, Iterator
from pathlib import Path

from argon2.low_level import Type, hash_secret_raw
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"GME1"
FORMAT_VERSION = 1
KDF_ARGON2ID = 1

DEFAULT_TIME_COST = 3
DEFAULT_MEMORY_COST_KIB = 65536  # 64 MiB
DEFAULT_PARALLELISM = 1
DEFAULT_CHUNK_SIZE = 65536  # 64 KiB

MIN_CHUNK_SIZE = 4096
MAX_CHUNK_SIZE = 1024 * 1024

_HEADER_STRUCT = struct.Struct(">4sBBIII16s4sI")
_FRAME_STRUCT = struct.Struct(">BI")
_AAD_TAIL_STRUCT = struct.Struct(">BQ")
_NONCE_TAIL_STRUCT = struct.Struct(">Q")

FLAG_CONTINUE = 0x00
FLAG_FINAL = 0x01


class ExportDecryptionError(Exception):
    """加密导出文件格式非法、口令错误或完整性校验失败。"""


def derive_export_key(
    passphrase: str,
    salt: bytes,
    *,
    time_cost: int = DEFAULT_TIME_COST,
    memory_cost_kib: int = DEFAULT_MEMORY_COST_KIB,
    parallelism: int = DEFAULT_PARALLELISM,
) -> bytes:
    if not passphrase:
        raise ExportDecryptionError("导出加密口令不能为空")
    if len(salt) != 16:
        raise ExportDecryptionError("加密文件盐值长度非法")
    if not (1 <= time_cost <= 20 and 8192 <= memory_cost_kib <= 524288 and 1 <= parallelism <= 8):
        raise ExportDecryptionError("加密文件 KDF 参数超出安全允许范围")
    return hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=time_cost,
        memory_cost=memory_cost_kib,
        parallelism=parallelism,
        hash_len=32,
        type=Type.ID,
    )


def _encrypt_chunk(
    cipher: AESGCM,
    header: bytes,
    nonce_prefix: bytes,
    index: int,
    flags: int,
    plaintext: bytes,
) -> bytes:
    nonce = nonce_prefix + _NONCE_TAIL_STRUCT.pack(index)
    aad = header + _AAD_TAIL_STRUCT.pack(flags, index)
    ciphertext = cipher.encrypt(nonce, plaintext, aad)
    return _FRAME_STRUCT.pack(flags, len(ciphertext)) + ciphertext


def encrypt_stream(
    plaintext_chunks: Iterable[bytes],
    passphrase: str,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    time_cost: int = DEFAULT_TIME_COST,
    memory_cost_kib: int = DEFAULT_MEMORY_COST_KIB,
    parallelism: int = DEFAULT_PARALLELISM,
) -> Iterator[bytes]:
    """流式分块加密明文字节迭代器，全程仅在内存缓冲单个分块，不写入磁盘临时文件。"""
    if not (MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE):
        raise ValueError("加密分块大小超出允许范围")

    salt = os.urandom(16)
    nonce_prefix = os.urandom(4)
    key = derive_export_key(
        passphrase,
        salt,
        time_cost=time_cost,
        memory_cost_kib=memory_cost_kib,
        parallelism=parallelism,
    )
    cipher = AESGCM(key)
    header = _HEADER_STRUCT.pack(
        MAGIC,
        FORMAT_VERSION,
        KDF_ARGON2ID,
        time_cost,
        memory_cost_kib,
        parallelism,
        salt,
        nonce_prefix,
        chunk_size,
    )
    yield header

    buffer = bytearray()
    chunk_index = 0
    for piece in plaintext_chunks:
        if not piece:
            continue
        buffer.extend(piece)
        # 严格大于 chunk_size 时才刷出中间块，确保永远保留末块由 FLAG_FINAL 封装。
        while len(buffer) > chunk_size:
            block = bytes(buffer[:chunk_size])
            del buffer[:chunk_size]
            yield _encrypt_chunk(cipher, header, nonce_prefix, chunk_index, FLAG_CONTINUE, block)
            chunk_index += 1

    final_block = bytes(buffer)
    buffer.clear()
    yield _encrypt_chunk(cipher, header, nonce_prefix, chunk_index, FLAG_FINAL, final_block)


def decrypt_stream(encrypted_chunks: Iterable[bytes], passphrase: str) -> Iterator[bytes]:
    """流式解密 GME1 密文流，严格校验头部、每块 GCM 标签、末块标志与无尾部垃圾字节。"""
    iterator = iter(encrypted_chunks)
    buffer = bytearray()

    def fill(needed: int) -> bool:
        while len(buffer) < needed:
            try:
                chunk = next(iterator)
            except StopIteration:
                return False
            if chunk:
                buffer.extend(chunk)
        return True

    if not fill(_HEADER_STRUCT.size):
        raise ExportDecryptionError("加密导出文件头部不完整")
    header = bytes(buffer[: _HEADER_STRUCT.size])
    del buffer[: _HEADER_STRUCT.size]

    (
        magic,
        version,
        kdf_id,
        time_cost,
        memory_cost_kib,
        parallelism,
        salt,
        nonce_prefix,
        chunk_size,
    ) = _HEADER_STRUCT.unpack(header)

    if magic != MAGIC or version != FORMAT_VERSION or kdf_id != KDF_ARGON2ID:
        raise ExportDecryptionError("不支持的加密导出文件格式或版本")
    if not (MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE):
        raise ExportDecryptionError("加密导出文件分块参数非法")

    key = derive_export_key(
        passphrase,
        salt,
        time_cost=time_cost,
        memory_cost_kib=memory_cost_kib,
        parallelism=parallelism,
    )
    cipher = AESGCM(key)

    chunk_index = 0
    finished = False
    while not finished:
        if not fill(_FRAME_STRUCT.size):
            raise ExportDecryptionError("加密导出文件不完整或已被截断")
        flags, ct_len = _FRAME_STRUCT.unpack(buffer[: _FRAME_STRUCT.size])
        del buffer[: _FRAME_STRUCT.size]
        if flags not in (FLAG_CONTINUE, FLAG_FINAL):
            raise ExportDecryptionError("加密导出文件帧标志非法")
        if ct_len < 16 or ct_len > chunk_size + 16:
            raise ExportDecryptionError("加密导出文件帧长度非法")
        if not fill(ct_len):
            raise ExportDecryptionError("加密导出文件密文块被截断")
        ciphertext = bytes(buffer[:ct_len])
        del buffer[:ct_len]

        nonce = nonce_prefix + _NONCE_TAIL_STRUCT.pack(chunk_index)
        aad = header + _AAD_TAIL_STRUCT.pack(flags, chunk_index)
        try:
            plaintext = cipher.decrypt(nonce, ciphertext, aad)
        except InvalidTag:
            raise ExportDecryptionError("口令错误或加密导出文件已被篡改") from None
        if plaintext:
            yield plaintext
        chunk_index += 1
        if flags == FLAG_FINAL:
            finished = True

    if buffer or any(bool(rest) for rest in iterator):
        raise ExportDecryptionError("加密导出文件末尾存在未认证的冗余字节")


def decrypt_export_file(input_path: Path, output_path: Path, passphrase: str) -> int:
    """流式解密本地 .gmenc 文件并原子写入 0600 权限目标文件；失败自动清理半成品。"""
    if not input_path.is_file():
        raise ExportDecryptionError("输入加密文件不存在")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_name(f".{output_path.name}.decrypt.tmp")

    def _read_chunks() -> Iterator[bytes]:
        with input_path.open("rb") as src:
            while True:
                data = src.read(DEFAULT_CHUNK_SIZE)
                if not data:
                    break
                yield data

    written = 0
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as dst:
            for chunk in decrypt_stream(_read_chunks(), passphrase):
                dst.write(chunk)
                written += len(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        os.replace(tmp_path, output_path)
    except BaseException:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return written
