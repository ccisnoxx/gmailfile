"""Wave 4 (TC-P2-005): DST 夏令时日期筛选、闰年/跨年月度统计、Unicode 与 CSV 公式变体集成测试。"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session
from test_accounts import create
from test_accounts import signed as signed
from test_auth import env as env
from test_operations import reverify

from app.models import UserSession

pytestmark = pytest.mark.integration


def _jump_clock(env, target: datetime) -> None:
    env["clock"][0] = target
    with Session(env["engine"]) as db, db.begin():
        db.execute(
            update(UserSession).values(
                created_at=target - timedelta(minutes=5),
                last_seen_at=target,
                expires_at=target + timedelta(hours=12),
            )
        )


def test_dst_leap_year_cross_year_and_extreme_timezone_boundaries(env, signed):
    reverify(env, signed)
    client, _ = signed

    # 1. America/New_York 春季夏令时（2026-03-08 仅 23 小时：05:00Z ~ 次日 04:00Z）
    #    与秋季夏令时（2026-11-01 共 25 小时：04:00Z ~ 次日 05:00Z）半开区间精确验证。
    ny = ZoneInfo("America/New_York")
    spring_start = datetime(2026, 3, 8, 0, 0, tzinfo=ny, fold=0).astimezone(UTC)
    spring_end = datetime(2026, 3, 9, 0, 0, tzinfo=ny, fold=0).astimezone(UTC)
    assert (spring_end - spring_start).total_seconds() == 23 * 3600

    fall_start = datetime(2026, 11, 1, 0, 0, tzinfo=ny, fold=0).astimezone(UTC)
    fall_end = datetime(2026, 11, 2, 0, 0, tzinfo=ny, fold=0).astimezone(UTC)
    assert (fall_end - fall_start).total_seconds() == 25 * 3600

    samples = [
        ("ny-spring-before@gmail.com", "2026-03-08T04:59:59Z"),
        ("ny-spring-start@gmail.com", "2026-03-08T05:00:00Z"),
        ("ny-spring-inside@gmail.com", "2026-03-09T03:59:59Z"),
        ("ny-spring-end@gmail.com", "2026-03-09T04:00:00Z"),
        ("ny-fall-before@gmail.com", "2026-11-01T03:59:59Z"),
        ("ny-fall-start@gmail.com", "2026-11-01T04:00:00Z"),
        ("ny-fall-fold1@gmail.com", "2026-11-01T06:30:00Z"),
        ("ny-fall-inside@gmail.com", "2026-11-02T04:59:59Z"),
        ("ny-fall-end@gmail.com", "2026-11-02T05:00:00Z"),
        ("leap-in@gmail.com", "2024-02-29T15:59:59Z"),
        ("leap-out@gmail.com", "2024-02-29T16:00:00Z"),
        ("kiritimati-2027@gmail.com", "2026-12-31T10:00:00Z"),
        ("kiritimati-2026@gmail.com", "2026-12-31T09:59:59Z"),
    ]
    for email, ts in samples:
        create(
            signed,
            gmail_email=email,
            registered_at=ts,
            recovery_email_external=f"rec-{email.split('@')[0]}@example.test",
        )

    spring_res = client.get(
        "/api/v1/accounts",
        params={
            "registered_from": spring_start.isoformat().replace("+00:00", "Z"),
            "registered_to": spring_end.isoformat().replace("+00:00", "Z"),
        },
    )
    assert spring_res.status_code == 200
    assert {item["gmail_email"] for item in spring_res.json()["items"]} == {
        "ny-spring-start@gmail.com",
        "ny-spring-inside@gmail.com",
    }

    fall_res = client.get(
        "/api/v1/accounts",
        params={
            "registered_from": fall_start.isoformat().replace("+00:00", "Z"),
            "registered_to": fall_end.isoformat().replace("+00:00", "Z"),
        },
    )
    assert fall_res.status_code == 200
    assert {item["gmail_email"] for item in fall_res.json()["items"]} == {
        "ny-fall-start@gmail.com",
        "ny-fall-fold1@gmail.com",
        "ny-fall-inside@gmail.com",
    }

    # 2. 闰年二月（Asia/Shanghai UTC+8）：02-29T23:59:59+08 归 2 月，03-01T00:00:00+08 归 3 月。
    _jump_clock(env, datetime(2024, 2, 29, 15, 0, tzinfo=UTC))
    leap_summary = client.get("/api/v1/dashboard/summary", params={"timezone": "Asia/Shanghai"})
    assert leap_summary.status_code == 200
    leap_body = leap_summary.json()
    assert leap_body["month_from"] == "2024-01-31T16:00:00Z"
    assert leap_body["month_to"] == "2024-02-29T16:00:00Z"
    assert leap_body["added_this_month"] == 1

    # 3. 跨年时刻（2026-12-31T10:30:00Z）：Pacific/Kiritimati (UTC+14) 已进入 2027-01，
    #    同一时刻 America/New_York (UTC-5) 仍在 2026-12。
    _jump_clock(env, datetime(2026, 12, 31, 10, 30, tzinfo=UTC))
    kiri = client.get("/api/v1/dashboard/summary", params={"timezone": "Pacific/Kiritimati"}).json()
    assert kiri["month_from"] == "2026-12-31T10:00:00Z"
    assert kiri["month_to"] == "2027-01-31T10:00:00Z"
    assert kiri["added_this_month"] == 1

    ny_dec = client.get("/api/v1/dashboard/summary", params={"timezone": "America/New_York"}).json()
    assert ny_dec["month_from"] == "2026-12-01T05:00:00Z"
    assert ny_dec["month_to"] == "2027-01-01T05:00:00Z"
    assert ny_dec["added_this_month"] == 2

    # 4. 跨夏令时月边界（America/New_York 2026-03 仅 743h、2026-11 共 721h）：
    #    当前时刻处于 2026-11-01 回拨重复小时（fold=1）时，月界仍精确落在 04:00:00Z ~ 05:00:00Z。
    _jump_clock(env, datetime(2026, 3, 15, 12, 0, tzinfo=UTC))
    ny_mar = client.get("/api/v1/dashboard/summary", params={"timezone": "America/New_York"}).json()
    assert ny_mar["month_from"] == "2026-03-01T05:00:00Z"
    assert ny_mar["month_to"] == "2026-04-01T04:00:00Z"

    _jump_clock(env, datetime(2026, 11, 1, 5, 30, tzinfo=UTC))
    ny_nov = client.get("/api/v1/dashboard/summary", params={"timezone": "America/New_York"}).json()
    assert ny_nov["month_from"] == "2026-11-01T04:00:00Z"
    assert ny_nov["month_to"] == "2026-12-01T05:00:00Z"


def test_unicode_csv_formula_variants_and_chinese_errors(env, signed):
    reverify(env, signed)
    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}

    formula_purposes = [
        ("formula-eq@gmail.com", '=HYPERLINK("http://evil.test","click")'),
        ("formula-tab@gmail.com", "\t=1+1"),
        ("formula-cr@gmail.com", "\r+2+3"),
        ("formula-lf@gmail.com", "\n-cmd|' /C calc'!A0"),
        ("formula-spaces@gmail.com", "   -SUM(A1:A5)"),
        ("formula-nbsp@gmail.com", "\u00a0@SUM(1,2)"),
        ("unicode-benign@gmail.com", "研发运维 🚀 Café 日本語 — 正常备注"),
    ]
    for email, purpose in formula_purposes:
        create(
            signed,
            gmail_email=email,
            purpose=purpose,
            notes=f"多语言备注：中文 / 日本語 / Emoji 🔐 / {purpose}",
            recovery_email_external=f"rec-{email.split('@')[0]}@example.test",
        )

    exported = client.post("/api/v1/exports/csv", json={"scope": "all"}, headers=headers)
    assert exported.status_code == 200
    assert exported.content.startswith(b"\xef\xbb\xbf")

    rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"), newline="")))
    by_email = {row["gmail_email"]: row for row in rows}
    for email, raw_purpose in formula_purposes[:-1]:
        assert by_email[email]["purpose"] == "'" + raw_purpose, f"{email} 未转义"
    assert by_email["unicode-benign@gmail.com"]["purpose"] == "研发运维 🚀 Café 日本語 — 正常备注"

    # 错误提示必须为简体中文且不泄露英文堆栈或异常类名。
    for bad_resp in (
        client.get("/api/v1/dashboard/summary", params={"timezone": "Mars/Olympus"}),
        client.get("/api/v1/accounts", params={"registered_from": "not-a-date"}),
        client.post(
            "/api/v1/imports/csv/preview",
            content=b"\xff\xfeinvalid-utf8",
            headers={"Content-Type": "text/csv", **headers},
        ),
    ):
        assert bad_resp.status_code == 422
        payload = bad_resp.json()
        message = payload["error"]["message"]
        assert any("\u4e00" <= ch <= "\u9fff" for ch in message), message
        for leak in ("Traceback", "ValueError", "KeyError", "sqlalchemy", "pydantic"):
            assert leak not in bad_resp.text
