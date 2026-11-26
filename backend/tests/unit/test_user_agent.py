"""受控白名单 User-Agent 解析与反序列化单元测试。"""

import pytest

from app.core.user_agent import (
    UNKNOWN_DEVICE,
    DeviceSummary,
    extract_device_summary,
    parse_stored_device,
    serialize_device_summary,
)


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15"
                )
            },
            DeviceSummary("desktop", "macOS", "Safari"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36 Edg/131.0"
                )
            },
            DeviceSummary("desktop", "Windows", "Edge"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0"
                )
            },
            DeviceSummary("desktop", "Linux", "Firefox"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/18.1 Mobile/15E148 Safari/604.1"
                )
            },
            DeviceSummary("mobile", "iOS", "Safari"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "CriOS/131.0 Mobile/15E148 Safari/604.1"
                )
            },
            DeviceSummary("tablet", "iOS", "Chrome"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (Linux; Android 15; Pixel 9) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
                )
            },
            DeviceSummary("mobile", "Android", "Chrome"),
        ),
        (
            {
                "user-agent": (
                    "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                )
            },
            DeviceSummary("tablet", "Android", "Chrome"),
        ),
        (
            {
                "user-agent": "Mozilla/5.0 (X11; CrOS x86_64) Chrome/130.0 OPR/114.0",
            },
            DeviceSummary("desktop", "ChromeOS", "Opera"),
        ),
        (
            {
                "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) Arc/1.68",
            },
            DeviceSummary("desktop", "macOS", "Arc"),
        ),
        (
            {
                "sec-ch-ua-platform": '"macOS"',
                "sec-ch-ua": '"Google Chrome";v="131"',
                "sec-ch-ua-mobile": "?0",
            },
            DeviceSummary("desktop", "macOS", "Chrome"),
        ),
        ({}, UNKNOWN_DEVICE),
    ],
)
def test_extract_device_summary(headers, expected):
    summary = extract_device_summary(headers)
    assert summary == expected
    serialized = serialize_device_summary(summary)
    assert parse_stored_device(serialized) == expected


def test_device_labels_and_untrusted_fallback():
    assert DeviceSummary("desktop", "macOS", "Safari").label == "macOS · Safari"
    assert DeviceSummary("mobile", "iOS", "Safari").label == "iOS · Safari（移动端）"
    assert DeviceSummary("tablet", "Android", "Chrome").label == "Android · Chrome（平板）"
    assert DeviceSummary("desktop", "Linux", "Unknown").label == "Linux"
    assert DeviceSummary("unknown", "Unknown", "Firefox").label == "Firefox"
    assert DeviceSummary("mobile", "Unknown", "Unknown").label == "移动设备"
    assert DeviceSummary("tablet", "Unknown", "Unknown").label == "平板设备"
    assert UNKNOWN_DEVICE.label == "未知设备"

    # 恶意/原始 UA 或越界字符串绝不能透传
    for bad in [
        None,
        "",
        "Mozilla/5.0 <script>alert(1)</script>",
        "desktop|FreeBSD|Safari",
        "desktop|macOS|EvilBrowser",
        "bot|macOS|Chrome",
        "x" * 100,
    ]:
        assert parse_stored_device(bad) == UNKNOWN_DEVICE

    # 从恶意 UA 提取的结果只含白名单字符，不含原始负载
    summary = extract_device_summary(
        {"user-agent": "CustomBot/1.0 <script>alert(1)</script> Windows"}
    )
    serialized = serialize_device_summary(summary)
    assert "<script>" not in serialized
    assert serialized == "desktop|Windows|Unknown"
