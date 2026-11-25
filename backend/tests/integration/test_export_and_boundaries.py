"""Wave 3 (TC-P1-002, TC-P1-004): 流式导出并发连接池边界与软删除辅助账号关联保护集成测试。"""

from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from test_accounts import create
from test_accounts import signed as signed
from test_auth import env as env
from test_operations import reverify

from app.models import AuditEvent
from app.schemas.accounts import AccountQuery
from app.services.csv_transfer import (
    DEFAULT_MAX_CONCURRENT_EXPORTS,
    stream_export_csv,
    try_acquire_export_slot,
)
from app.services.csv_transfer import exporter as exporter_module

pytestmark = pytest.mark.integration


def test_streaming_export_concurrency_bound_protects_db_pool(env, signed, monkeypatch):
    reverify(env, signed)
    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}

    for idx in range(6):
        create(
            signed,
            gmail_email=f"pool-export-{idx}@gmail.com",
            recovery_email_external=f"rec-pool-{idx}@example.test",
        )

    # 构造与生产一致的紧连接池（pool_size=5, max_overflow=0），验证并发流式导出不会耗尽连接池。
    tight_engine = create_engine(
        env["engine"].url,
        pool_size=5,
        max_overflow=0,
        pool_timeout=2.0,
        pool_pre_ping=True,
    )
    app = client.app
    original_engine = app.state.engine
    app.state.engine = tight_engine

    real_iter = exporter_module.iter_export_csv_chunks
    active_limit = DEFAULT_MAX_CONCURRENT_EXPORTS
    started = [threading.Event() for _ in range(active_limit)]
    release = [threading.Event() for _ in range(active_limit)]
    counter_lock = threading.Lock()
    call_index = {"value": 0}
    gate_enabled = {"value": True}

    def gated_iter(db, params, *, batch_size=exporter_module.EXPORT_BATCH_SIZE):
        idx: int | None = None
        if gate_enabled["value"]:
            with counter_lock:
                if call_index["value"] < active_limit:
                    idx = call_index["value"]
                    call_index["value"] += 1
        chunks = real_iter(db, params, batch_size=2)
        first_chunk = next(chunks)
        yield first_chunk
        if idx is not None:
            started[idx].set()
            assert release[idx].wait(timeout=10.0), f"stream {idx} release timed out"
        yield from chunks

    monkeypatch.setattr(exporter_module, "iter_export_csv_chunks", gated_iter)

    results: list[dict] = [{}, {}]
    errors: list[BaseException] = []

    def run_export(slot_idx: int, *, abort_early: bool) -> None:
        worker = TestClient(app, base_url="https://testserver", client=("192.0.2.10", 50000))
        worker.cookies.update(client.cookies)
        try:
            with worker.stream(
                "POST",
                "/api/v1/exports/csv",
                json={"scope": "all"},
                headers=headers,
            ) as resp:
                results[slot_idx]["status"] = resp.status_code
                iterator = resp.iter_bytes()
                first = next(iterator, b"")
                results[slot_idx]["first"] = first
                if abort_early:
                    return
                rest = b"".join(iterator)
                results[slot_idx]["body"] = first + rest
        except BaseException as exc:  # pragma: no cover - 失败诊断保留
            errors.append(exc)
        finally:
            worker.close()

    t0 = threading.Thread(target=run_export, args=(0,), kwargs={"abort_early": False})
    t1 = threading.Thread(target=run_export, args=(1,), kwargs={"abort_early": True})
    try:
        t0.start()
        t1.start()
        for idx, ev in enumerate(started):
            assert ev.wait(timeout=10.0), f"export stream {idx} did not start"

        # 两个慢导出正在持有 DB 只读事务连接，此时仍有 3 条连接可供普通 API 与健康检查使用。
        assert tight_engine.pool.checkedout() == active_limit

        # 第 3 个并发导出应立即返回 429 EXPORT_BUSY，不阻塞也不写入伪造审计记录。
        busy = client.post("/api/v1/exports/csv", json={"scope": "all"}, headers=headers)
        assert busy.status_code == 429
        assert busy.json()["error"]["code"] == "EXPORT_BUSY"
        assert busy.headers["Cache-Control"] == "no-store"
        assert busy.headers["X-Request-ID"] == busy.json()["request_id"]

        # 健康检查与核心读接口在导出占满配额时必须保持可用且不发生连接池饥饿。
        ready = client.get("/api/v1/health/ready")
        assert ready.status_code == 200
        listing = client.get("/api/v1/accounts")
        assert listing.status_code == 200
        assert listing.json()["total"] == 6

        # 仅成功获得槽位的 2 个导出写入了 csv_exported 审计事件。
        with Session(tight_engine) as db:
            exported_count = db.scalar(
                select(func.count(AuditEvent.id)).where(AuditEvent.event_type == "csv_exported")
            )
            assert exported_count == active_limit

        # 分别放行正常完成流与半途断开流，验证两个槽位与数据库连接均完整归还。
        for ev in release:
            ev.set()
        t0.join(timeout=10.0)
        t1.join(timeout=10.0)
        assert not t0.is_alive() and not t1.is_alive()
        assert not errors

        assert results[0]["status"] == 200
        csv_text = results[0]["body"].decode("utf-8-sig")
        assert "pool-export-0@gmail.com" in csv_text
        assert "pool-export-5@gmail.com" in csv_text
        assert results[1]["status"] == 200
        assert results[1]["first"].startswith(b"\xef\xbb\xbfaccount_no,")

        # 槽位归还后，验证 mid-stream gen.close() 也能立即释放槽位与连接且支持幂等二次释放。
        gate_enabled["value"] = False
        assert tight_engine.pool.checkedout() == 0
        sem = app.state.export_semaphore
        manual_slot = try_acquire_export_slot(sem)
        assert manual_slot is not None
        gen = stream_export_csv(
            tight_engine,
            AccountQuery(),
            batch_size=2,
            on_close=manual_slot.release,
        )
        first_chunk = next(gen)
        assert first_chunk.startswith(b"\xef\xbb\xbfaccount_no,")
        assert tight_engine.pool.checkedout() == 1
        gen.close()
        assert tight_engine.pool.checkedout() == 0
        # 模拟 BackgroundTask 二次调用 release()，BoundedSemaphore 不得因过度释放报错。
        manual_slot.release()

        # 随后再次并发填满配额再释放，确认没有任何槽位或连接池泄漏。
        acquired = [try_acquire_export_slot(sem) for _ in range(active_limit)]
        assert all(item is not None for item in acquired)
        assert try_acquire_export_slot(sem) is None
        for item in acquired:
            assert item is not None
            item.release()

        for _ in range(active_limit + 1):
            again = client.post("/api/v1/exports/csv", json={"scope": "all"}, headers=headers)
            assert again.status_code == 200
            assert "pool-export-0@gmail.com" in again.content.decode("utf-8-sig")
        assert tight_engine.pool.checkedout() == 0
    finally:
        for ev in release:
            ev.set()
        t0.join(timeout=5.0)
        t1.join(timeout=5.0)
        app.state.engine = original_engine
        tight_engine.dispose()


def test_recovery_account_soft_deleted_boundary(env, signed):
    reverify(env, signed)
    client, state = signed
    headers = {"X-CSRF-Token": state["csrf_token"]}

    target = create(
        signed,
        gmail_email="rec-target-a@gmail.com",
        recovery_email_external="root-ext@example.test",
    )
    existing_child = create(
        signed,
        gmail_email="rec-child-c@gmail.com",
        recovery_account_id=target["id"],
        recovery_email_external=None,
    )
    unrelated = create(
        signed,
        gmail_email="rec-other-d@gmail.com",
        recovery_email_external="other-ext@example.test",
    )

    # 软删除被关联的辅助账号 A。
    deleted = client.request(
        "DELETE",
        f"/api/v1/accounts/{target['id']}",
        json={"row_version": target["row_version"]},
        headers=headers,
    )
    assert deleted.status_code == 200
    deleted_target = deleted.json()
    assert deleted_target["deleted_at"] is not None

    # (a) 新建账号 B 指向已软删除账号 A -> 422 RECOVERY_INVALID。
    new_link = client.post(
        "/api/v1/accounts",
        json={
            "gmail_email": "rec-new-b@gmail.com",
            "password": "Pass-New-Link-2026!",
            "recovery_account_id": target["id"],
            "recovery_email_external": None,
            "status": "normal",
            "two_factor_status": "unknown",
        },
        headers=headers,
    )
    assert new_link.status_code == 422
    assert new_link.json()["error"]["code"] == "RECOVERY_INVALID"

    # (b) 原本已关联 A 的账号 C 编辑其他字段（或保持原关联）必须继续允许。
    keep_link = client.patch(
        f"/api/v1/accounts/{existing_child['id']}",
        json={
            "row_version": existing_child["row_version"],
            "purpose": "keep-existing-recovery",
        },
        headers=headers,
    )
    assert keep_link.status_code == 200
    child_v2 = keep_link.json()
    assert child_v2["recovery_account_id"] == target["id"]
    assert child_v2["purpose"] == "keep-existing-recovery"

    keep_explicit = client.patch(
        f"/api/v1/accounts/{existing_child['id']}",
        json={
            "row_version": child_v2["row_version"],
            "recovery_account_id": target["id"],
            "recovery_email_external": None,
            "purpose": "explicit-same-recovery",
        },
        headers=headers,
    )
    assert keep_explicit.status_code == 200
    child_v3 = keep_explicit.json()
    assert child_v3["recovery_account_id"] == target["id"]

    # (c) 未关联 A 的账号 D 改绑为已软删除账号 A -> 422 RECOVERY_INVALID。
    switch_to_deleted = client.patch(
        f"/api/v1/accounts/{unrelated['id']}",
        json={
            "row_version": unrelated["row_version"],
            "recovery_account_id": target["id"],
            "recovery_email_external": None,
        },
        headers=headers,
    )
    assert switch_to_deleted.status_code == 422
    assert switch_to_deleted.json()["error"]["code"] == "RECOVERY_INVALID"

    # (d) 账号 C 从已软删除账号 A 切换为外部辅助邮箱应成功。
    switch_away = client.patch(
        f"/api/v1/accounts/{existing_child['id']}",
        json={
            "row_version": child_v3["row_version"],
            "recovery_account_id": None,
            "recovery_email_external": "replacement-ext@example.test",
        },
        headers=headers,
    )
    assert switch_away.status_code == 200
    assert switch_away.json()["recovery_account_id"] is None
    assert switch_away.json()["recovery_email_external"] == "replacement-ext@example.test"

    # (e) 恢复账号 A 后，新账号可重新关联账号 A。
    restored = client.post(
        f"/api/v1/accounts/{target['id']}/restore",
        json={"row_version": deleted_target["row_version"]},
        headers=headers,
    )
    assert restored.status_code == 200
    after_restore = create(
        signed,
        gmail_email="rec-after-restore@gmail.com",
        recovery_account_id=target["id"],
        recovery_email_external=None,
    )
    assert after_restore["recovery_account_id"] == target["id"]
