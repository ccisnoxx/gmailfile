"""受控白名单设备与浏览器解析；绝不持久化或回显原始 User-Agent 字符串。"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

DeviceType = Literal["desktop", "mobile", "tablet", "unknown"]

ALLOWED_DEVICE_TYPES: frozenset[str] = frozenset({"desktop", "mobile", "tablet", "unknown"})
ALLOWED_OS: frozenset[str] = frozenset(
    {"macOS", "Windows", "Linux", "iOS", "Android", "ChromeOS", "Unknown"}
)
ALLOWED_BROWSERS: frozenset[str] = frozenset(
    {"Edge", "Opera", "Arc", "Chrome", "Firefox", "Safari", "Unknown"}
)

_DEVICE_SUFFIX: dict[DeviceType, str] = {
    "desktop": "",
    "mobile": "（移动端）",
    "tablet": "（平板）",
    "unknown": "",
}


@dataclass(frozen=True)
class DeviceSummary:
    device_type: DeviceType
    os: str
    browser: str

    @property
    def label(self) -> str:
        suffix = _DEVICE_SUFFIX[self.device_type]
        if self.os != "Unknown" and self.browser != "Unknown":
            return f"{self.os} · {self.browser}{suffix}"
        if self.os != "Unknown":
            return f"{self.os}{suffix}"
        if self.browser != "Unknown":
            return f"{self.browser}{suffix}"
        if self.device_type == "mobile":
            return "移动设备"
        if self.device_type == "tablet":
            return "平板设备"
        return "未知设备"


UNKNOWN_DEVICE = DeviceSummary(device_type="unknown", os="Unknown", browser="Unknown")


def _clean_header(headers: Mapping[str, str], name: str, limit: int = 512) -> str:
    # 仅截取有界长度用于本地关键词匹配，不落库也不写入日志。
    raw = headers.get(name) or ""
    return raw[:limit].strip()


def _detect_os(ua_lower: str, ch_platform_lower: str) -> str:
    if (
        "ipad" in ua_lower
        or "iphone" in ua_lower
        or "ipod" in ua_lower
        or "ios" in ch_platform_lower
    ):
        return "iOS"
    if "android" in ua_lower or "android" in ch_platform_lower:
        return "Android"
    if "cros" in ua_lower or "chrome os" in ch_platform_lower or "chromeos" in ch_platform_lower:
        return "ChromeOS"
    if "windows" in ua_lower or "windows" in ch_platform_lower:
        return "Windows"
    if "mac os x" in ua_lower or "macintosh" in ua_lower or "macos" in ch_platform_lower:
        return "macOS"
    if "linux" in ua_lower or "linux" in ch_platform_lower:
        return "Linux"
    return "Unknown"


def _detect_browser(ua_lower: str, ch_ua_lower: str) -> str:
    combined = f"{ch_ua_lower} {ua_lower}"
    if (
        "edg/" in ua_lower
        or "edga/" in ua_lower
        or "edgios/" in ua_lower
        or "microsoft edge" in ch_ua_lower
    ):
        return "Edge"
    if "opr/" in ua_lower or "opera" in combined:
        return "Opera"
    if "arc/" in ua_lower or '"arc"' in ch_ua_lower:
        return "Arc"
    if "firefox/" in ua_lower or "fxios/" in ua_lower:
        return "Firefox"
    if (
        "chrome/" in ua_lower
        or "crios/" in ua_lower
        or "chromium" in combined
        or "google chrome" in ch_ua_lower
    ):
        return "Chrome"
    if "safari/" in ua_lower:
        return "Safari"
    return "Unknown"


def _detect_device_type(ua_lower: str, ch_mobile: str, os_name: str) -> DeviceType:
    if (
        "ipad" in ua_lower
        or "tablet" in ua_lower
        or (os_name == "Android" and "mobile" not in ua_lower)
    ):
        return "tablet"
    if ch_mobile == "?1" or "iphone" in ua_lower or "ipod" in ua_lower or "mobile" in ua_lower:
        return "mobile"
    if os_name in {"macOS", "Windows", "Linux", "ChromeOS"}:
        return "desktop"
    return "unknown"


def extract_device_summary(headers: Mapping[str, str]) -> DeviceSummary:
    ua = _clean_header(headers, "user-agent")
    ch_platform = _clean_header(headers, "sec-ch-ua-platform", 64).strip('"')
    ch_ua = _clean_header(headers, "sec-ch-ua", 256)
    ch_mobile = _clean_header(headers, "sec-ch-ua-mobile", 16)
    if not ua and not ch_platform and not ch_ua:
        return UNKNOWN_DEVICE

    ua_lower = ua.lower()
    os_name = _detect_os(ua_lower, ch_platform.lower())
    browser = _detect_browser(ua_lower, ch_ua.lower())
    device_type = _detect_device_type(ua_lower, ch_mobile, os_name)
    return DeviceSummary(device_type=device_type, os=os_name, browser=browser)


def serialize_device_summary(summary: DeviceSummary) -> str:
    return f"{summary.device_type}|{summary.os}|{summary.browser}"


def parse_stored_device(stored: str | None) -> DeviceSummary:
    """从数据库受控短标签还原结构化设备信息；对历史空值或非法值安全回退。"""
    if not stored or len(stored) > 64:
        return UNKNOWN_DEVICE
    parts = stored.split("|")
    if len(parts) != 3:
        return UNKNOWN_DEVICE
    device_type, os_name, browser = parts
    if (
        device_type not in ALLOWED_DEVICE_TYPES
        or os_name not in ALLOWED_OS
        or browser not in ALLOWED_BROWSERS
    ):
        return UNKNOWN_DEVICE
    return DeviceSummary(device_type=device_type, os=os_name, browser=browser)
