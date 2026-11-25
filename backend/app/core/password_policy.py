"""管理员新密码强度策略：16 位下限、鼓励长密码短语、常见泄露密码与弱模式离线检查。"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

MIN_ADMIN_PASSWORD_LENGTH = 16
MAX_ADMIN_PASSWORD_LENGTH = 1024
MIN_DISTINCT_CHARS = 5

# 常见长泄露密码、公开示例短语及键盘连击（均以小写紧凑形式存储）。
COMMON_LEAKED_PASSWORDS: frozenset[str] = frozenset(
    {
        "correcthorsebatterystaple",
        "tr0ub4dor&3",
        "password12345678",
        "password123456789",
        "password1234567890",
        "passw0rd12345678",
        "1234567890123456",
        "1234567812345678",
        "1111111111111111",
        "0000000000000000",
        "qwertyuiopasdfgh",
        "qwertyuiop123456",
        "qwerty1234567890",
        "asdfghjkl1234567",
        "zxcvbnm123456789",
        "abcdefghijklmnop",
        "iloveyou12345678",
        "letmein123456789",
        "welcome123456789",
        "admin12345678901",
        "administrator123",
        "administrator1234",
        "gmailaccountmanager",
        "gmailmanager1234",
        "masterpassword12",
        "masterpassword123",
        "mysecretpassword",
        "supersecretpassword",
        "thisisapassword1",
        "changeme12345678",
        "defaultpassword1",
        "trustno123456789",
        "monkey1234567890",
        "football12345678",
        "sunshine12345678",
        "princess12345678",
        "dragon1234567890",
        "baseball12345678",
        "starwars12345678",
        "whatever12345678",
        "abc1234567890123",
    }
)

# 仅由单个常见词加数字/标点拼凑的弱基础词。
COMMON_WEAK_BASES: frozenset[str] = frozenset(
    {
        "password",
        "passphrase",
        "passcode",
        "admin",
        "administrator",
        "root",
        "superuser",
        "qwerty",
        "qwertyuiop",
        "asdfghjkl",
        "zxcvbnm",
        "letmein",
        "welcome",
        "iloveyou",
        "changeme",
        "secret",
        "masterpassword",
        "gmail",
        "gmailmanager",
        "gmailaccountmanager",
        "google",
        "googlemail",
        "accountmanager",
    }
)

_SEQUENCES: tuple[str, ...] = (
    "01234567890123456789",
    "98765432109876543210",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiopasdfghjklzxcvbnm",
    "mnbvcxzlkjhgfdsapoiuytrewq",
    "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p",
)

_SEPARATOR_RE = re.compile(r"[\s_\-.!@#$%^&*+=~`|\\/:;\"',?<>()\[\]{}]+")
_NON_ALPHA_RE = re.compile(r"[^a-z]+")
_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _is_periodic(text: str) -> bool:
    length = len(text)
    max_period = min(8, length // 2)
    for period in range(1, max_period + 1):
        unit = text[:period]
        if (unit * ((length // period) + 1))[:length] == text:
            return True
    return False


def _matches_denylist_file(password: str, denylist_file: Path) -> bool:
    if not denylist_file.is_file():
        raise ValueError("密码黑名单文件不存在或不可读")
    lower = password.lower()
    sha1_hex = hashlib.sha1(password.encode("utf-8")).hexdigest().lower()
    sha256_hex = hashlib.sha256(password.encode("utf-8")).hexdigest().lower()
    with denylist_file.open("r", encoding="utf-8", errors="ignore") as stream:
        for raw_line in stream:
            entry = raw_line.strip()
            if not entry or entry.startswith("#"):
                continue
            token = entry.split(":", 1)[0].strip().lower()
            if token in {lower, sha1_hex, sha256_hex}:
                return True
    return False


def validate_new_admin_password(password: str, *, denylist_file: Path | None = None) -> str:
    """校验新管理员密码强度；允许空格与多词短语，绝不在错误信息中回显密码原文。"""
    if not MIN_ADMIN_PASSWORD_LENGTH <= len(password) <= MAX_ADMIN_PASSWORD_LENGTH:
        raise ValueError(
            f"管理员密码长度必须为 {MIN_ADMIN_PASSWORD_LENGTH} 至 "
            f"{MAX_ADMIN_PASSWORD_LENGTH} 个字符，建议使用多词长密码短语"
        )
    if len(password.strip()) < MIN_ADMIN_PASSWORD_LENGTH:
        raise ValueError(f"管理员密码去除首尾空白后至少需要 {MIN_ADMIN_PASSWORD_LENGTH} 个字符")
    lower = password.lower()
    if len(set(lower)) < MIN_DISTINCT_CHARS:
        raise ValueError("管理员密码字符过于单一，请使用随机长密码短语")
    if _is_periodic(lower):
        raise ValueError("管理员密码不能使用简单重复片段，请使用随机长密码短语")
    compact = _SEPARATOR_RE.sub("", lower)
    alnum = _ALNUM_RE.sub("", lower)
    if alnum and any(alnum in seq for seq in _SEQUENCES):
        raise ValueError("管理员密码不能使用连续字符或键盘顺序序列")
    letters_only = _NON_ALPHA_RE.sub("", lower)
    if (
        lower in COMMON_LEAKED_PASSWORDS
        or compact in COMMON_LEAKED_PASSWORDS
        or letters_only in COMMON_WEAK_BASES
    ):
        raise ValueError("该密码属于常见弱密码或已知泄露密码，请改用高熵长密码短语")
    if denylist_file is not None and _matches_denylist_file(password, denylist_file):
        raise ValueError("该密码命中离线泄露密码黑名单，请改用其他长密码短语")
    return password
