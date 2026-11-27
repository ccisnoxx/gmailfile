"""阶段 P1 批量移除/替换标签、批量软删/核验、快速领号与站内辅助邮箱归并单元测试。"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models import GmailAccount, GmailAccountApp, RegisteredApp
from app.schemas.accounts import (
    AccountAppAssignInput,
    BatchInput,
    BatchItem,
    BatchTags,
    BatchVerifyInput,
    LinkInternalRecoveryInput,
    RegisteredAppInput,
)
from app.services.accounts.apps import AppService
from app.services.accounts.detail import AccountDetailService
from app.services.accounts.errors import AccountError
from app.services.auth.constants import AUDIT_OPERATIONS


def test_batch_tags_schema_modes_and_validation():
    acc_id = uuid4()
    tag_id = uuid4()
    append_payload = BatchTags(
        accounts=[BatchItem(id=acc_id, row_version=1)],
        tag_ids=[tag_id],
    )
    assert append_payload.mode == "append"

    clear_payload = BatchTags(
        accounts=[BatchItem(id=acc_id, row_version=1)],
        mode="replace",
        tag_ids=[],
    )
    assert clear_payload.mode == "replace"
    assert clear_payload.tag_ids == []

    with pytest.raises(ValidationError, match="至少需要选择一个标签"):
        BatchTags(accounts=[BatchItem(id=acc_id, row_version=1)], mode="remove", tag_ids=[])


def test_batch_tags_remove_and_replace_modes():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    acc_id = uuid4()
    tag_a, tag_b, tag_c = uuid4(), uuid4(), uuid4()
    row = GmailAccount(id=acc_id, gmail_email="u@gmail.com", row_version=2, deleted_at=None)

    db = MagicMock()
    db.get.return_value = row
    db.execute.return_value.scalar_one_or_none.return_value = acc_id
    db.scalars.side_effect = [
        SimpleNamespace(all=lambda: [tag_b]),  # tag validation
        SimpleNamespace(all=lambda: [tag_a, tag_b]),  # existing tags on account
    ]
    # Note: db.scalars(...) in wanted check iterates directly over result
    db.scalars.side_effect = [
        [tag_b],
        SimpleNamespace(all=lambda: [tag_a, tag_b]),
    ]

    audits: list[tuple[str, object, object]] = []
    auth = SimpleNamespace(
        db=db,
        now=now,
        audit=lambda event, _sess, account_id=None, operation=None: audits.append(
            (event, account_id, operation)
        ),
    )
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())
    applied_tags: list[list] = []
    service.set_tags = lambda _aid, tids, verified=False: applied_tags.append(list(tids))

    res = service.batch(
        BatchTags(
            accounts=[BatchItem(id=acc_id, row_version=2)],
            mode="remove",
            tag_ids=[tag_b],
        )
    )
    assert res.updated_ids == [acc_id]
    assert applied_tags == [[tag_a]]
    assert audits == [("account_updated", acc_id, "batch-tags-remove")]
    assert "batch-tags-remove" in AUDIT_OPERATIONS

    # Replace with tag_c
    audits.clear()
    applied_tags.clear()
    db.scalars.side_effect = [
        [tag_c],
        SimpleNamespace(all=lambda: [tag_a]),
    ]
    service.batch(
        BatchTags(
            accounts=[BatchItem(id=acc_id, row_version=2)],
            mode="replace",
            tag_ids=[tag_c],
        )
    )
    assert applied_tags == [[tag_c]]
    assert audits == [("account_updated", acc_id, "batch-tags-replace")]
    assert "batch-tags-replace" in AUDIT_OPERATIONS


def test_batch_delete_and_batch_verify_promote_pending():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    acc_id = uuid4()
    row = GmailAccount(
        id=acc_id,
        gmail_email="pending@gmail.com",
        status="pending_verification",
        row_version=1,
        deleted_at=None,
    )
    db = MagicMock()
    db.get.return_value = row
    audits: list[tuple[str, object, object]] = []
    auth = SimpleNamespace(
        db=db,
        now=now,
        audit=lambda event, _sess, account_id=None, operation=None: audits.append(
            (event, account_id, operation)
        ),
    )
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())
    cas_updates: list[dict] = []
    service.cas = lambda _row, _ver, values: cas_updates.append(dict(values))

    service.batch_verify(
        BatchVerifyInput(
            accounts=[BatchItem(id=acc_id, row_version=1)],
            promote_pending=True,
        )
    )
    assert cas_updates == [{"last_verified_at": now, "status": "normal"}]
    assert audits[-1] == ("account_updated", acc_id, "batch-verify")

    cas_updates.clear()
    service.batch_delete(BatchInput(accounts=[BatchItem(id=acc_id, row_version=2)]))
    assert cas_updates == [{"deleted_at": now}]
    assert audits[-1] == ("account_deleted", acc_id, "batch-delete")

    row.deleted_at = now
    with pytest.raises(AccountError) as exc_info:
        service.batch_delete(BatchInput(accounts=[BatchItem(id=acc_id, row_version=3)]))
    assert exc_info.value.code == "ACCOUNT_DELETED"


def test_assign_app_and_sort_order_save():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    acc_id = uuid4()
    app_id = uuid4()
    row = GmailAccount(id=acc_id, gmail_email="work@gmail.com", row_version=3, deleted_at=None)
    app_row = RegisteredApp(
        id=app_id,
        name="Claude",
        name_normalized="claude",
        sort_order=100,
        created_at=now,
    )

    db = MagicMock()
    db.get.side_effect = lambda model, pk: row if model is GmailAccount else app_row
    db.scalar.return_value = None
    audits: list[tuple[str, object, object]] = []
    auth = SimpleNamespace(
        db=db,
        now=now,
        audit=lambda event, _sess, account_id=None, operation=None: audits.append(
            (event, account_id, operation)
        ),
    )
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())
    service.cas = MagicMock()
    sentinel_detail = MagicMock()
    service.detail = lambda _id: sentinel_detail

    out = service.assign_app(
        acc_id,
        AccountAppAssignInput(row_version=3, app_id=app_id, status="active", note="  领号分配 "),
    )
    assert out is sentinel_detail
    service.cas.assert_called_once_with(row, 3, {})
    added = db.add.call_args.args[0]
    assert isinstance(added, GmailAccountApp)
    assert added.app_id == app_id
    assert added.status == "active"
    assert added.note == "领号分配"
    assert audits == [("account_updated", acc_id, "assign-app")]

    # App sort_order update
    app_db = MagicMock()
    app_db.get.return_value = app_row
    app_auth = SimpleNamespace(db=app_db, now=now, audit=MagicMock())
    app_service = AppService(app_auth, MagicMock())
    saved = app_service.save_app(
        RegisteredAppInput(name="Claude", sort_order=10),
        app_id=app_id,
    )
    assert saved.sort_order == 10


def test_link_internal_recovery_converts_matching_external_emails():
    now = datetime(2026, 11, 27, 12, 0, tzinfo=UTC)
    hub_id = uuid4()
    child_1 = GmailAccount(
        id=uuid4(),
        gmail_email="child1@gmail.com",
        gmail_email_normalized="child1@gmail.com",
        recovery_account_id=None,
        recovery_email_external="Hub.Master+tag@googlemail.com",
        row_version=1,
        deleted_at=None,
    )
    child_self = GmailAccount(
        id=hub_id,
        gmail_email="hubmaster@gmail.com",
        gmail_email_normalized="hubmaster@gmail.com",
        recovery_account_id=None,
        recovery_email_external="hub.master@gmail.com",
        row_version=1,
        deleted_at=None,
    )
    db = MagicMock()
    db.scalars.return_value = SimpleNamespace(all=lambda: [child_1, child_self])
    db.execute.return_value = SimpleNamespace(all=lambda: [(hub_id, "hubmaster@gmail.com")])

    audits: list[tuple[str, object, object]] = []
    auth = SimpleNamespace(
        db=db,
        now=now,
        audit=lambda event, _sess, account_id=None, operation=None: audits.append(
            (event, account_id, operation)
        ),
    )
    service = AccountDetailService(auth=auth, session=MagicMock(), listing=MagicMock())
    cas_calls: list[tuple[object, int, dict]] = []
    service.cas = lambda r, v, vals: cas_calls.append((r.id, v, dict(vals)))

    res = service.link_internal_recovery(LinkInternalRecoveryInput(email="hubmaster@gmail.com"))
    assert res.linked_count == 1
    assert res.updated_ids == [child_1.id]
    assert cas_calls == [
        (child_1.id, 1, {"recovery_account_id": hub_id, "recovery_email_external": None})
    ]
    assert audits == [("account_updated", child_1.id, "link-internal-recovery")]
