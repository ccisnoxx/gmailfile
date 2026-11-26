"""已注册第三方应用（Apps）边界校验与服务逻辑单元测试。"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models import GmailAccountApp, RegisteredApp
from app.schemas.accounts import AccountAppInput, AccountCreate, AccountPatch, AccountQuery
from app.services.accounts.detail import AccountDetailService
from app.services.accounts.errors import AccountError


def test_account_app_input_trims_blank_note():
    app_id = uuid4()
    item = AccountAppInput(app_id=app_id, status="banned", note="  风控封禁  ")
    assert item.note == "风控封禁"
    empty = AccountAppInput(app_id=app_id, status="active", note="   ")
    assert empty.note is None


def test_account_create_and_patch_reject_duplicate_apps():
    app_id = uuid4()
    with pytest.raises(ValidationError, match="不能重复选择同一应用"):
        AccountCreate(
            gmail_email="demo@gmail.com",
            password="secret",
            recovery_email_external="backup@example.com",
            apps=[
                AccountAppInput(app_id=app_id, status="active"),
                AccountAppInput(app_id=app_id, status="banned"),
            ],
        )

    with pytest.raises(ValidationError, match="不能重复选择同一应用"):
        AccountPatch(
            row_version=1,
            apps=[
                AccountAppInput(app_id=app_id, status="active"),
                AccountAppInput(app_id=app_id, status="restricted"),
            ],
        )

    with pytest.raises(ValidationError, match="必填字段不能设为空"):
        AccountPatch(row_version=1, apps=None)


def test_account_query_rejects_same_include_and_exclude_app():
    app_id = uuid4()
    with pytest.raises(ValidationError, match="包含与排除的应用不能相同"):
        AccountQuery(app_id=app_id, exclude_app_id=app_id)

    valid = AccountQuery(app_id=app_id, app_status="banned")
    assert valid.app_id == app_id
    assert valid.app_status == "banned"


def test_set_apps_tracks_banned_at_transitions():
    now = datetime(2026, 11, 27, 10, 0, tzinfo=UTC)
    earlier = now - timedelta(days=5)
    account_id = uuid4()
    app_claude = uuid4()
    app_chatgpt = uuid4()
    app_cursor = uuid4()

    existing_claude = GmailAccountApp(
        account_id=account_id,
        app_id=app_claude,
        status="banned",
        note="旧备注",
        banned_at=earlier,
        created_at=earlier,
        updated_at=earlier,
    )
    existing_chatgpt = GmailAccountApp(
        account_id=account_id,
        app_id=app_chatgpt,
        status="banned",
        note=None,
        banned_at=earlier,
        created_at=earlier,
        updated_at=earlier,
    )

    db = MagicMock()
    db.scalars.side_effect = [
        [app_claude, app_chatgpt, app_cursor],
        [existing_claude, existing_chatgpt],
    ]
    auth = SimpleNamespace(db=db, now=now)
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())

    service.set_apps(
        account_id,
        [
            # 保持 banned，仅改备注：应保留原 banned_at
            AccountAppInput(app_id=app_claude, status="banned", note="申诉失败"),
            # 从 banned 恢复 active：应清空 banned_at
            AccountAppInput(app_id=app_chatgpt, status="active", note="已解封"),
            # 新增且直接标为 banned：应写入 banned_at = now
            AccountAppInput(app_id=app_cursor, status="banned", note="触发风控"),
        ],
    )

    assert existing_claude.banned_at == earlier
    assert existing_claude.note == "申诉失败"
    assert existing_claude.updated_at == now

    assert existing_chatgpt.status == "active"
    assert existing_chatgpt.banned_at is None
    assert existing_chatgpt.updated_at == now

    added = [call.args[0] for call in db.add.call_args_list]
    assert len(added) == 1
    assert isinstance(added[0], GmailAccountApp)
    assert added[0].app_id == app_cursor
    assert added[0].status == "banned"
    assert added[0].banned_at == now


def test_set_apps_raises_when_unknown_app_id():
    account_id = uuid4()
    missing_id = uuid4()
    db = MagicMock()
    db.scalars.return_value = []
    auth = SimpleNamespace(db=db, now=datetime(2026, 11, 27, 10, 0, tzinfo=UTC))
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())

    with pytest.raises(AccountError) as exc_info:
        service.set_apps(account_id, [AccountAppInput(app_id=missing_id, status="active")])
    assert exc_info.value.status == 422
    assert exc_info.value.code == "APP_INVALID"
    assert RegisteredApp.__tablename__ == "registered_apps"
