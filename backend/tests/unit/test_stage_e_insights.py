"""阶段 E 智能视图筛选参数、SQL 过滤与 /dashboard/insights 聚合单元测试。"""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app.repositories.accounts import AccountRepository
from app.schemas.accounts import AccountQuery
from app.services.accounts.listing import AccountQueryService
from app.services.operations import read_backup_status


def compile_sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}))


def test_account_query_accepts_stage_e_smart_view_filters():
    q = AccountQuery(
        app_statuses="restricted, banned,restricted",
        has_recovery_email=False,
        unverified_over_days=30,
        inactive_login_over_days=90,
        password_stale_over_days=180,
        missing_metadata="no_purpose_or_tags",
        conflict_check="inactive_with_active_apps",
    )
    assert q.app_statuses == ["restricted", "banned"]
    assert q.has_recovery_email is False
    assert q.unverified_over_days == 30
    assert q.inactive_login_over_days == 90
    assert q.password_stale_over_days == 180
    assert q.missing_metadata == "no_purpose_or_tags"
    assert q.conflict_check == "inactive_with_active_apps"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"unverified_over_days": 0},
        {"unverified_over_days": 4000},
        {"inactive_login_over_days": -1},
        {"password_stale_over_days": 0},
        {"app_statuses": "unknown_status"},
        {"missing_metadata": "invalid_kind"},
        {"conflict_check": "bad_check"},
    ],
)
def test_account_query_rejects_invalid_smart_view_params(kwargs):
    with pytest.raises(ValidationError):
        AccountQuery(**kwargs)


def test_repository_filtered_generates_expected_sql_for_smart_view_predicates():
    repo = AccountRepository(db=SimpleNamespace())
    fixed_now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)

    sql_no_recovery = compile_sql(
        repo.filtered(AccountQuery(has_recovery_email=False), now=fixed_now)
    )
    assert "recovery_account_id IS NULL" in sql_no_recovery
    assert "btrim(gmail_accounts.recovery_email_external)" in sql_no_recovery

    sql_has_recovery = compile_sql(
        repo.filtered(AccountQuery(has_recovery_email=True), now=fixed_now)
    )
    assert "recovery_account_id IS NOT NULL" in sql_has_recovery

    sql_stale = compile_sql(
        repo.filtered(
            AccountQuery(
                unverified_over_days=30,
                inactive_login_over_days=90,
                password_stale_over_days=180,
            ),
            now=fixed_now,
        )
    )
    assert "coalesce(gmail_accounts.last_verified_at, gmail_accounts.registered_at) <" in sql_stale
    assert "coalesce(gmail_accounts.last_login_at, gmail_accounts.registered_at) <" in sql_stale
    assert (
        "coalesce(gmail_accounts.password_changed_at, gmail_accounts.registered_at) <" in sql_stale
    )

    sql_apps = compile_sql(
        repo.filtered(AccountQuery(app_statuses="restricted,banned"), now=fixed_now)
    )
    assert "gmail_account_apps.status IN" in sql_apps

    sql_missing = compile_sql(
        repo.filtered(AccountQuery(missing_metadata="no_purpose_or_tags"), now=fixed_now)
    )
    assert "btrim(gmail_accounts.purpose)" in sql_missing
    assert "NOT (EXISTS" in sql_missing

    sql_conflict = compile_sql(
        repo.filtered(AccountQuery(conflict_check="inactive_with_active_apps"), now=fixed_now)
    )
    assert "gmail_accounts.status IN" in sql_conflict
    assert "gmail_account_apps.status =" in sql_conflict


def test_read_backup_status_handles_valid_stale_and_corrupt_files(tmp_path):
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    assert read_backup_status(None, now).state == "unconfigured"
    assert read_backup_status(tmp_path / "missing.json", now).state == "never_run"

    fresh_file = tmp_path / "fresh.json"
    fresh_file.write_text(
        json.dumps(
            {
                "state": "success",
                "offsite": "success",
                "last_success_at": (now - timedelta(hours=4)).isoformat(),
            }
        )
    )
    fresh = read_backup_status(fresh_file, now)
    assert fresh.state == "success"
    assert fresh.offsite == "success"

    stale_file = tmp_path / "stale.json"
    stale_file.write_text(
        json.dumps(
            {
                "state": "success",
                "offsite": "pending",
                "last_success_at": (now - timedelta(hours=48)).isoformat(),
            }
        )
    )
    assert read_backup_status(stale_file, now).state == "stale"

    corrupt_file = tmp_path / "corrupt.json"
    corrupt_file.write_text("{not-json")
    assert read_backup_status(corrupt_file, now).state == "failed"


def test_dashboard_insights_aggregates_risks_duplicates_and_backup_honestly(tmp_path):
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    matched_id = uuid4()
    backup_file = tmp_path / "backup.json"
    backup_file.write_text(
        json.dumps(
            {
                "state": "success",
                "offsite": "failed",
                "last_success_at": (now - timedelta(hours=6)).isoformat(),
            }
        )
    )

    execute_results = [
        SimpleNamespace(one=lambda: (4, 1, 2, 3, 5, 6, 7, 8, 2, 9, 10, 1)),
        SimpleNamespace(
            all=lambda: [
                ("Alice.Backup+1@gmail.com", 2),
                ("alicebackup@gmail.com", 3),
                ("external@outlook.com", 1),
            ]
        ),
        SimpleNamespace(all=lambda: [(matched_id, 12, "alicebackup@gmail.com")]),
    ]

    class FakeDb:
        def __init__(self):
            self._idx = 0

        def execute(self, _stmt):
            res = execute_results[self._idx]
            self._idx += 1
            return res

        def scalar(self, _stmt):
            return 3

    class FakeRepo:
        def recovery_usage(self, *_args, **_kwargs):
            rows = [
                {
                    "email": "hub@example.com",
                    "account_count": 5,
                    "normal_count": 4,
                    "abnormal_count": 1,
                    "latest_registered_at": now - timedelta(days=2),
                },
                {
                    "email": "small@example.com",
                    "account_count": 2,
                    "normal_count": 2,
                    "abnormal_count": 0,
                    "latest_registered_at": now - timedelta(days=1),
                },
            ]
            return rows, 2, 7, 1

    auth = SimpleNamespace(
        db=FakeDb(),
        now=now,
        settings=SimpleNamespace(backup_status_file=backup_file),
    )
    result = AccountQueryService(auth, FakeRepo()).dashboard_insights()

    assert result.disabled_2fa_count == 4
    assert result.unverified_over_30_days == 5
    assert result.inactive_login_over_90_days == 6
    assert result.password_stale_over_180_days == 7
    assert result.no_recovery_email_count == 8
    assert result.app_risk_account_count == 2
    assert result.no_purpose_count == 9
    assert result.no_tags_count == 10
    assert result.inactive_with_active_apps_count == 1
    assert len(result.concentrated_recovery_emails) == 1
    assert result.concentrated_recovery_emails[0].email == "hub@example.com"
    assert len(result.external_recovery_matches_internal) == 1
    dup = result.external_recovery_matches_internal[0]
    assert dup.email == "alicebackup@gmail.com"
    assert dup.account_count == 5
    assert dup.matched_account_id == matched_id
    assert dup.matched_account_no == "GM-000012"
    assert result.backup_state == "success"
    assert result.backup_offsite == "failed"
    assert result.recent_auth_failures_7d == 3
