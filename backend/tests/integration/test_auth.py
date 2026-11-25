import io
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from typing import Annotated

import pyotp
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.api.dependencies import auth_service
from app.cli import create_admin
from app.core.encryption import EncryptedValue
from app.core.logging import JsonFormatter
from app.core.security import passwords, random_token, token_hash
from app.main import create_app
from app.models import (
    AdminRecoveryCode,
    AdminUser,
    AuditEvent,
    AuthThrottle,
    PreAuthSession,
    UserSession,
)
from app.services.auth import AuthService

pytestmark = pytest.mark.integration


class SyntheticEnvironment(dict):
    def __repr__(self):
        return "<synthetic authentication fixture>"


@pytest.fixture
def env(db_engine, settings, monkeypatch):
    current = [datetime.now(UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return current[0]

    monkeypatch.setattr("app.services.auth.datetime", Clock)
    monkeypatch.setattr("app.main.create_database_engine", lambda settings: db_engine)
    password = random_token()
    with Session(db_engine) as db, db.begin():
        db.add(AdminUser(password_hash=passwords.hash(password), password_changed_at=current[0]))
    stack = ExitStack()

    def client(host="192.0.2.10"):
        app = create_app(settings)

        @app.get("/protected")
        def protected(service: Annotated[AuthService, Depends(auth_service, scope="function")]):
            service.require_session(csrf=False)
            return {"ok": True}

        return stack.enter_context(
            TestClient(app, base_url="https://testserver", client=(host, 50000))
        )

    data = SyntheticEnvironment(
        {
            "engine": db_engine,
            "settings": settings,
            "clock": current,
            "password": password,
            "client": client,
        }
    )
    yield data
    stack.close()


def bootstrap(client):
    response = client.get("/api/v1/auth/session")
    assert response.status_code == 200
    return response.json()


def post(client, path, state, body=None):
    return client.post(
        "/api/v1/auth/" + path, json=body or {}, headers={"X-CSRF-Token": state["csrf_token"]}
    )


def login(env, client, **extra):
    state = bootstrap(client)
    return post(client, "login", state, {"password": env["password"], **extra})


def enroll(env, client):
    state = login(env, client).json()
    assert state["state"] == "mfa_pending"
    setup = post(client, "totp/setup", state).json()
    code = pyotp.TOTP(setup["secret"]).at(env["clock"][0])
    result = post(client, "totp/confirm", state, {"code": code})
    assert result.status_code == 200, result.status_code
    return setup["secret"], result.json()


def advance(env, seconds=31):
    env["clock"][0] += timedelta(seconds=seconds)


def test_pre_session_refresh_csrf_cookie_and_login_rotation(env):
    client = env["client"]()
    state = bootstrap(client)
    cookie = client.cookies.get("__Host-gm_session")
    response = client.get("/api/v1/auth/session")
    header = client.get("/api/v1/auth/session").headers
    assert header["Cache-Control"] == "no-store"
    refreshed = response.json()
    assert refreshed["csrf_token"] != state["csrf_token"]
    assert post(client, "login", state, {"password": env["password"]}).status_code == 403
    state = bootstrap(client)
    response = post(client, "login", state, {"password": env["password"]})
    assert response.status_code == 200
    assert cookie != client.cookies.get("__Host-gm_session")
    attributes = response.headers["set-cookie"]
    assert all(x in attributes for x in ["HttpOnly", "Secure", "SameSite=strict", "Path=/"])
    assert "Domain=" not in attributes
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(PreAuthSession)) == 0
        row = db.scalar(select(UserSession))
        assert row.token_hash != client.cookies.get("__Host-gm_session").encode()
        assert len(row.csrf_token_hash) == 32
        assert row.csrf_token_hash != response.json()["csrf_token"].encode()


def test_initial_mfa_restricted_confirm_and_one_time_codes(env):
    client = env["client"]()
    state = login(env, client).json()
    assert client.get("/protected").status_code == 403
    assert post(client, "reverify", state, {"password": env["password"]}).status_code == 403
    setup = post(client, "totp/setup", state).json()
    assert setup["qr_data_url"].startswith("data:image/svg+xml;base64,")
    with Session(env["engine"]) as db:
        row = db.scalar(select(UserSession))
        assert setup["secret"].encode() not in row.pending_totp_ciphertext
        assert not db.scalar(select(AdminUser)).totp_enabled
    response = post(
        client, "totp/confirm", state, {"code": pyotp.TOTP(setup["secret"]).at(env["clock"][0])}
    )
    assert response.status_code == 200
    codes = response.json()["recovery_codes"]
    assert len(codes) == len(set(codes)) == 10
    assert client.get("/protected").status_code == 200
    assert "recovery_codes" not in bootstrap(client)
    with Session(env["engine"]) as db:
        rows = db.scalars(select(AdminRecoveryCode)).all()
        assert {r.code_hash for r in rows} == {token_hash(c).hex() for c in codes}
        assert all(r.used_at is None for r in rows)
        assert db.scalar(select(UserSession)).pending_totp_ciphertext is None
        admin = db.scalar(select(AdminUser))
        assert admin.totp_enabled and setup["secret"].encode() not in admin.totp_secret_ciphertext


def test_login_mfa_replay_and_generic_errors(env):
    client = env["client"]()
    secret, result = enroll(env, client)
    other = env["client"]()
    response = login(env, other, totp_code=pyotp.TOTP(secret).at(env["clock"][0]))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"
    advance(env)
    response = login(env, other, totp_code=pyotp.TOTP(secret).at(env["clock"][0]))
    assert response.status_code == 200 and response.json()["state"] == "authenticated"
    third = env["client"]()
    advance(env)
    invalid = login(env, third, totp_code="wrong")
    assert invalid.status_code == 401
    assert invalid.json()["error"]["message"] == response_message()


def response_message():
    return "验证失败或暂时受限，请稍后重试"


def test_reverify_rotates_cookie_csrf_and_absolute_expiry(env):
    client = env["client"]()
    _, result = enroll(env, client)
    state = result["session"]
    old_cookie = client.cookies.get("__Host-gm_session")
    response = post(client, "reverify", state, {"password": env["password"]})
    assert response.status_code == 200
    new = response.json()
    assert new["csrf_token"] != state["csrf_token"] and new["expires_at"] == state["expires_at"]
    assert new["reauthenticated_until"] is not None
    stale = env["client"]()
    stale.cookies.set("__Host-gm_session", old_cookie)
    assert stale.get("/protected").status_code == 401
    assert post(client, "logout", state).status_code == 403
    assert post(client, "logout", new).status_code == 200
    assert client.get("/protected").status_code == 401


@pytest.mark.parametrize("expiry", ["idle", "absolute"])
def test_server_enforced_expiry(env, expiry):
    client = env["client"]()
    _, result = enroll(env, client)
    with Session(env["engine"]) as db, db.begin():
        if expiry == "idle":
            db.execute(
                update(UserSession).values(last_seen_at=env["clock"][0] - timedelta(minutes=15))
            )
        else:
            # 保持 expires_after_creation 约束。
            db.execute(
                update(UserSession).values(
                    created_at=env["clock"][0] - timedelta(hours=13), expires_at=env["clock"][0]
                )
            )
    assert client.get("/protected").status_code == 401
    assert (
        post(client, "reverify", result["session"], {"password": env["password"]}).status_code
        == 401
    )
    assert bootstrap(client)["state"] == "anonymous"


def test_refresh_does_not_extend_idle_lifetime(env):
    client = env["client"]()
    _, result = enroll(env, client)
    advance(env, 899)
    refreshed = bootstrap(client)
    assert datetime.fromisoformat(refreshed["idle_expires_at"]) == datetime.fromisoformat(
        result["session"]["idle_expires_at"]
    )
    advance(env, 1)
    assert bootstrap(client)["state"] == "anonymous"


def test_recovery_rebind_revokes_others_and_old_factor(env):
    first = env["client"]()
    old_secret, initial = enroll(env, first)
    recovery = env["client"]()
    response = login(env, recovery, recovery_code=initial["recovery_codes"][0])
    assert response.status_code == 200
    state = response.json()
    assert state["state"] == "mfa_pending"
    assert first.get("/protected").status_code == 401
    assert recovery.get("/protected").status_code == 403
    repeated = login(env, env["client"](), recovery_code=initial["recovery_codes"][0])
    assert repeated.status_code == 401
    advance(env)
    setup = post(recovery, "totp/setup", state).json()
    confirmed = post(
        recovery, "totp/confirm", state, {"code": pyotp.TOTP(setup["secret"]).at(env["clock"][0])}
    )
    assert confirmed.status_code == 200
    assert post(recovery, "logout", confirmed.json()["session"]).status_code == 200
    advance(env)
    assert (
        login(
            env, env["client"](), totp_code=pyotp.TOTP(old_secret).at(env["clock"][0])
        ).status_code
        == 401
    )
    advance(env)
    assert (
        login(
            env, env["client"](), totp_code=pyotp.TOTP(setup["secret"]).at(env["clock"][0])
        ).status_code
        == 200
    )


def test_atomic_recovery_consumption(env):
    first = env["client"]()
    _, result = enroll(env, first)
    a, b = env["client"](), env["client"]()
    sa, sb = bootstrap(a), bootstrap(b)

    def consume(pair):
        client, state = pair
        return post(
            client,
            "login",
            state,
            {"password": env["password"], "recovery_code": result["recovery_codes"][0]},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(consume, [(a, sa), (b, sb)]))
    assert sorted(statuses) == [200, 401]
    with Session(env["engine"]) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(AdminRecoveryCode)
                .where(AdminRecoveryCode.used_at.is_not(None))
            )
            == 1
        )


@pytest.mark.parametrize(
    "path",
    [
        "logout",
        "reverify",
        "totp/setup",
        "totp/confirm",
        "totp/regenerate-recovery-codes",
        "password",
    ],
)
def test_all_mutations_require_csrf(env, path):
    client = env["client"]()
    _, result = enroll(env, client)
    body = {
        "logout": {},
        "reverify": {"password": env["password"]},
        "totp/setup": {},
        "totp/confirm": {"code": "invalid"},
        "totp/regenerate-recovery-codes": {"password": env["password"]},
        "password": {"password": env["password"], "new_password": random_token()},
    }[path]
    assert client.post("/api/v1/auth/" + path, json=body).status_code == 403


def test_login_csrf_and_cross_origin_bootstrap(env):
    client = env["client"]()
    assert client.post("/api/v1/auth/login", json={"password": env["password"]}).status_code == 403
    state = bootstrap(client)
    assert client.post("/api/v1/auth/login", json={"password": env["password"]}).status_code == 403
    assert (
        client.get("/api/v1/auth/session", headers={"origin": "https://evil.test"}).status_code
        == 403
    )
    assert (
        client.get("/api/v1/auth/session", headers={"sec-fetch-site": "cross-site"}).status_code
        == 403
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"password": env["password"]},
        headers={"origin": "https://evil.test", "x-csrf-token": state["csrf_token"]},
    )
    assert response.status_code == 403


def test_throttle_persists_and_locks_across_ip_and_mfa(env):
    client = env["client"]()
    state = login(env, client).json()
    post(client, "totp/setup", state)
    for n in range(5):
        response = post(client, "totp/confirm", state, {"code": "wrong"})
        assert response.status_code == 401
        if n < 4:
            advance(env, 2**n)
    assert post(client, "totp/confirm", state, {"code": "wrong"}).status_code == 429
    other = env["client"]()
    assert login(env, other).status_code == 429
    with Session(env["engine"]) as db:
        rows = db.scalars(select(AuthThrottle)).all()
        assert len(rows) == 2 and all(r.failures == 5 for r in rows)
        assert (
            db.get(AuthThrottle, "admin").blocked_until - env["clock"][0]
        ).total_seconds() == 900
    advance(env, 900)
    assert login(env, env["client"]()).status_code == 200


def test_password_change_requires_recent_and_revokes_all(env):
    client = env["client"]()
    secret, result = enroll(env, client)
    state = result["session"]
    new = random_token()[:16]
    body = {"password": env["password"], "new_password": new}
    assert post(client, "password", state, body).status_code == 403
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    advance(env, 300)
    assert post(client, "password", state, body).json()["error"]["code"] == "REAUTH_REQUIRED"
    state = post(client, "reverify", state, {"password": env["password"]}).json()
    other = env["client"]()
    assert login(env, other, totp_code=pyotp.TOTP(secret).at(env["clock"][0])).status_code == 200
    rejected = post(client, "password", state, {**body, "new_password": new[:15]})
    assert rejected.status_code == 422 and new[:15] not in rejected.text
    weak = post(client, "password", state, {**body, "new_password": "password12345678"})
    assert weak.status_code == 422 and "password12345678" not in weak.text
    assert client.get("/protected").status_code == 200
    assert post(client, "password", state, body).status_code == 200
    assert client.get("/protected").status_code == other.get("/protected").status_code == 401
    with Session(env["engine"]) as db:
        assert passwords.verify(new, db.scalar(select(AdminUser)).password_hash)
        assert all(r.revoked_at for r in db.scalars(select(UserSession)))


def test_step_up_totp_enforced_for_password_reveal_and_copy(env):
    env["settings"].step_up_totp_required = True
    client = env["client"]()
    secret, result = enroll(env, client)
    state = result["session"]
    assert state["step_up_totp_required"] is True
    created = client.post(
        "/api/v1/accounts",
        json={
            "gmail_email": "stepup@gmail.com",
            "password": random_token(),
            "recovery_email_external": "recovery@example.test",
        },
        headers={"X-CSRF-Token": state["csrf_token"]},
    ).json()
    reveal_path = f"/api/v1/accounts/{created['id']}/reveal-password"
    copy_path = f"/api/v1/accounts/{created['id']}/copy-password-event"

    # 启用 step_up_totp_required 后，仅传密码的 reverify 必须被拒绝。
    assert post(client, "reverify", state, {"password": env["password"]}).status_code == 401
    advance(env)
    code = pyotp.TOTP(secret).at(env["clock"][0])
    reverified = post(client, "reverify", state, {"password": env["password"], "totp_code": code})
    assert reverified.status_code == 200
    state = reverified.json()
    assert state["mfa_reauthenticated_until"] is not None
    # 同一 TOTP 时间步不能重复用于 step-up。
    assert (
        post(
            client, "reverify", state, {"password": env["password"], "totp_code": code}
        ).status_code
        == 401
    )
    assert (
        client.post(reveal_path, json={}, headers={"X-CSRF-Token": state["csrf_token"]}).status_code
        == 200
    )
    assert (
        client.post(copy_path, json={}, headers={"X-CSRF-Token": state["csrf_token"]}).status_code
        == 200
    )
    # 仅存在密码级 reauthenticated_at 而无 mfa_reauthenticated_at 时，高风险密码查看被拒。
    with Session(env["engine"]) as db, db.begin():
        db.execute(update(UserSession).values(mfa_reauthenticated_at=None))
    denied = client.post(reveal_path, json={}, headers={"X-CSRF-Token": state["csrf_token"]})
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "REAUTH_REQUIRED"


def test_step_up_totp_enforced_for_password_change(env):
    env["settings"].step_up_totp_required = True
    client = env["client"]()
    secret, result = enroll(env, client)
    state = result["session"]
    advance(env)
    code = pyotp.TOTP(secret).at(env["clock"][0])
    reverified = post(client, "reverify", state, {"password": env["password"], "totp_code": code})
    assert reverified.status_code == 200
    state = reverified.json()

    # 仅有密码级 reauthenticated_at 而无 mfa_reauthenticated_at 时，管理员改密必须被拒。
    with Session(env["engine"]) as db, db.begin():
        db.execute(update(UserSession).values(mfa_reauthenticated_at=None))
    new_password = random_token()[:20]
    denied = post(
        client,
        "password",
        state,
        {"password": env["password"], "new_password": new_password},
    )
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "REAUTH_REQUIRED"

    # 完成带 TOTP 的 step-up reverify 后，改密成功。
    advance(env)
    fresh_code = pyotp.TOTP(secret).at(env["clock"][0])
    reverified_again = post(
        client, "reverify", state, {"password": env["password"], "totp_code": fresh_code}
    )
    assert reverified_again.status_code == 200
    state = reverified_again.json()
    ok = post(
        client,
        "password",
        state,
        {"password": env["password"], "new_password": new_password},
    )
    assert ok.status_code == 200


def test_authenticated_rebind_and_regeneration_require_factor(env):
    client = env["client"]()
    secret, result = enroll(env, client)
    state = post(client, "reverify", result["session"], {"password": env["password"]}).json()
    assert post(client, "totp/setup", state, {"password": env["password"]}).status_code == 401
    advance(env)
    credentials = {"password": env["password"], "totp_code": pyotp.TOTP(secret).at(env["clock"][0])}
    response = post(client, "totp/regenerate-recovery-codes", state, credentials)
    assert response.status_code == 200
    new = response.json()
    assert set(new["recovery_codes"]).isdisjoint(result["recovery_codes"])
    advance(env)
    credentials["totp_code"] = pyotp.TOTP(secret).at(env["clock"][0])
    setup = post(client, "totp/setup", new["session"], credentials)
    assert setup.status_code == 200
    with Session(env["engine"]) as db:
        # 重绑未确认前保留原有效因子。
        admin = db.scalar(select(AdminUser))
        decrypted = client.app.state.encryption.decrypt(
            EncryptedValue(
                admin.totp_secret_ciphertext, admin.totp_secret_nonce, admin.totp_secret_key_version
            ),
            "admin_user",
            admin.id,
            "totp_secret",
        )
        assert decrypted == secret
    confirmed = post(
        client,
        "totp/confirm",
        new["session"],
        {"code": pyotp.TOTP(setup.json()["secret"]).at(env["clock"][0])},
    )
    assert confirmed.status_code == 200


def test_expired_enrollment_cannot_confirm(env):
    client = env["client"]()
    state = login(env, client).json()
    setup = post(client, "totp/setup", state).json()
    advance(env, 600)
    response = post(
        client, "totp/confirm", state, {"code": pyotp.TOTP(setup["secret"]).at(env["clock"][0])}
    )
    assert response.status_code == 403 and response.json()["error"]["code"] == "SETUP_REQUIRED"


def test_successful_login_upgrades_hash(env):
    old = PasswordHash((Argon2Hasher(time_cost=1, memory_cost=8192, parallelism=1),)).hash(
        env["password"]
    )
    with Session(env["engine"]) as db, db.begin():
        db.execute(update(AdminUser).values(password_hash=old))
    assert login(env, env["client"]()).status_code == 200
    with Session(env["engine"]) as db:
        assert db.scalar(select(AdminUser)).password_hash != old


def test_errors_audit_and_logs_do_not_disclose_secrets(env):
    client = env["client"]()
    log = io.StringIO()
    handler = logging.StreamHandler(log)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("gmail_manager")
    logger.addHandler(handler)
    try:
        secret, result = enroll(env, client)
        response = client.post(
            "/api/v1/auth/reverify",
            json={"password": env["password"], "unexpected": env["password"]},
        )
        assert response.status_code == 422 and env["password"] not in response.text
        state = result["session"]
        post(client, "reverify", state, {"password": env["password"]})
        with Session(env["engine"]) as db:
            events = db.scalars(select(AuditEvent)).all()
            audit_text = str([(e.event_type, e.event_metadata) for e in events])
            assert {e.event_type for e in events} >= {
                "totp_bound",
                "password_reverified",
                "recovery_codes_regenerated",
            }
        for value in [env["password"], secret, state["csrf_token"], *result["recovery_codes"]]:
            assert value not in log.getvalue() and value not in audit_text
    finally:
        logger.removeHandler(handler)


def test_cli_interactive_single_admin_and_no_password_arguments(db_engine, monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True)
    password = random_token()[:16]
    create_admin(db_engine, lambda prompt: password)
    with pytest.raises(ValueError, match="已存在"):
        create_admin(db_engine, lambda prompt: pytest.fail("不应再次读取密码"))
    with Session(db_engine) as db:
        assert passwords.verify(password, db.scalar(select(AdminUser)).password_hash)
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with pytest.raises(ValueError, match="交互式终端"):
        create_admin(db_engine)


def test_cli_rejects_short_or_leaked_password_without_creating_admin(db_engine, monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True)
    password = random_token()[:15]
    with pytest.raises(ValueError, match="长度"):
        create_admin(db_engine, lambda prompt: password)
    with pytest.raises(ValueError, match="泄露密码"):
        create_admin(db_engine, lambda prompt: "password12345678")
    with Session(db_engine) as db:
        assert db.scalar(select(func.count()).select_from(AdminUser)) == 0


def test_application_role_no_ddl_and_new_tables_accessible(db_engine):
    # 真实非超级用户角色，使用与初始化脚本一致的默认权限。
    from secrets import token_hex

    role = "gm_test_app_" + token_hex(6)
    with db_engine.begin() as db:
        schema = db.scalar(text("SELECT current_schema()"))
        db.execute(text(f'CREATE ROLE "{role}" NOSUPERUSER NOCREATEDB NOCREATEROLE'))
        db.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"'))
        db.execute(
            text(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES "
                f'IN SCHEMA "{schema}" TO "{role}"'
            )
        )
    try:
        with db_engine.begin() as db:
            db.execute(text(f'SET LOCAL ROLE "{role}"'))
            assert db.scalar(text("SELECT count(*) FROM auth_throttles")) == 0
            db.execute(text("INSERT INTO auth_throttles VALUES ('test',0,now(),now())"))
            db.execute(text("UPDATE auth_throttles SET failures=1 WHERE key='test'"))
            db.execute(text("DELETE FROM auth_throttles WHERE key='test'"))
        with pytest.raises(Exception, match="permission denied"):
            with db_engine.begin() as db:
                db.execute(text(f'SET LOCAL ROLE "{role}"'))
                db.execute(text("CREATE TABLE forbidden_table (id int)"))
    finally:
        with db_engine.begin() as db:
            db.execute(text(f'DROP OWNED BY "{role}"'))
            db.execute(text(f'DROP ROLE "{role}"'))


def test_0001_upgrade_preserves_existing_admin(db_engine, migration_config):
    from alembic import command

    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.downgrade(migration_config, "0001")
    password = random_token()
    # Insert using the historical schema, not the current ORM which includes 0003 columns.
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO admin_users (id, password_hash, password_changed_at) "
                "VALUES (:id, :hash, :changed)"
            ),
            {
                "id": __import__("uuid").uuid4(),
                "hash": passwords.hash(password),
                "changed": datetime.now(UTC),
            },
        )
    with db_engine.begin() as connection:
        migration_config.attributes["connection"] = connection
        command.upgrade(migration_config, "head")
    with Session(db_engine) as db:
        assert passwords.verify(password, db.scalar(select(AdminUser)).password_hash)


def test_production_restricts_session_from_disabled_mfa_development(env):
    env["settings"].totp_required = False
    client = env["client"]()
    assert login(env, client).json()["state"] == "authenticated"
    env["settings"].totp_required = True
    assert client.get("/protected").status_code == 403
    assert bootstrap(client)["state"] == "mfa_pending"


def test_block_is_not_reset_before_full_lock_period(env):
    client = env["client"]()
    with Session(env["engine"]) as db, db.begin():
        db.add(
            AuthThrottle(
                key="admin",
                failures=5,
                window_started_at=env["clock"][0] - timedelta(minutes=16),
                blocked_until=env["clock"][0] + timedelta(seconds=20),
            )
        )
    assert login(env, client).status_code == 429


def test_sibling_origin_cannot_rotate_csrf(env):
    client = env["client"]()
    state = bootstrap(client)
    assert (
        client.get("/api/v1/auth/session", headers={"sec-fetch-site": "same-site"}).status_code
        == 403
    )
    assert post(client, "login", state, {"password": env["password"]}).status_code == 200


def test_cli_refuses_getpass_echo_fallback(db_engine, monkeypatch):
    import getpass
    import warnings

    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("sys.stderr.isatty", lambda: True)

    def fallback(prompt):
        warnings.warn("echo unavailable", getpass.GetPassWarning, stacklevel=1)
        pytest.fail("不能继续读取密码")

    with pytest.raises(ValueError, match="无法安全读取密码"):
        create_admin(db_engine, fallback)
    with Session(db_engine) as db:
        assert db.scalar(select(func.count()).select_from(AdminUser)) == 0


@pytest.mark.parametrize(
    "operation", ["login", "reverify", "totp/setup", "totp/regenerate-recovery-codes", "password"]
)
def test_actual_credential_attack_entries_are_throttled(env, operation):
    client = env["client"]()
    secret, result = enroll(env, client)
    state = post(client, "reverify", result["session"], {"password": env["password"]}).json()
    advance(env)
    if operation == "login":
        client = env["client"]()
        state = bootstrap(client)
    body = {"password": env["password"], "recovery_code": random_token()}
    if operation == "reverify":
        body = {"password": random_token()}
    elif operation == "password":
        body = {"password": random_token(), "new_password": random_token()}
    for n in range(5):
        assert post(client, operation, state, body).status_code == 401
        if n < 4:
            advance(env, 2**n)
    assert post(client, operation, state, body).status_code == 429
    with Session(env["engine"]) as db:
        assert db.get(AuthThrottle, "admin").failures == 5


def test_rebind_confirmation_cannot_outlive_reverification(env):
    client = env["client"]()
    secret, result = enroll(env, client)
    state = post(client, "reverify", result["session"], {"password": env["password"]}).json()
    advance(env)
    setup = post(
        client,
        "totp/setup",
        state,
        {"password": env["password"], "totp_code": pyotp.TOTP(secret).at(env["clock"][0])},
    ).json()
    advance(env, 300)
    response = post(
        client, "totp/confirm", state, {"code": pyotp.TOTP(setup["secret"]).at(env["clock"][0])}
    )
    assert response.status_code == 403 and response.json()["error"]["code"] == "REAUTH_REQUIRED"


def test_atomic_totp_replay_across_sessions(env):
    first = env["client"]()
    secret, result = enroll(env, first)
    advance(env)
    a, b = env["client"](), env["client"]()
    sa, sb = bootstrap(a), bootstrap(b)
    code = pyotp.TOTP(secret).at(env["clock"][0])

    def attempt(pair):
        client, state = pair
        return post(
            client, "login", state, {"password": env["password"], "totp_code": code}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, [(a, sa), (b, sb)])) == [200, 401]


def test_corrupted_totp_ciphertext_has_generic_http_response(env):
    client = env["client"]()
    secret, result = enroll(env, client)
    with Session(env["engine"]) as db, db.begin():
        admin = db.scalar(select(AdminUser))
        admin.totp_secret_nonce = b"\x00" * 12
    advance(env)
    response = login(env, env["client"](), totp_code=pyotp.TOTP(secret).at(env["clock"][0]))
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "DECRYPTION_FAILED"
    assert secret not in response.text and "nonce" not in response.text


def test_ip_and_admin_buckets_ignore_untrusted_forwarded_headers(env):
    client = env["client"]("192.0.2.20")
    state = bootstrap(client)
    response = client.post(
        "/api/v1/auth/login",
        json={"password": random_token()},
        headers={"X-CSRF-Token": state["csrf_token"], "X-Forwarded-For": "198.51.100.1"},
    )
    assert response.status_code == 401
    with Session(env["engine"]) as db:
        assert db.get(AuthThrottle, "ip:" + token_hash("192.0.2.20").hex()).failures == 1
        assert db.get(AuthThrottle, "ip:" + token_hash("198.51.100.1").hex()) is None
        assert db.get(AuthThrottle, "admin").failures == 1
        assert (
            str(
                db.scalar(
                    select(AuditEvent.ip_address).where(AuditEvent.event_type == "login_failed")
                )
            )
            == "192.0.2.20"
        )
    # 换 IP 不能绕过管理员全局退避。
    assert login(env, env["client"]("192.0.2.21")).status_code == 429


def test_expired_pre_auth_state_cannot_login(env):
    client = env["client"]()
    state = bootstrap(client)
    advance(env, 600)
    assert post(client, "login", state, {"password": env["password"]}).status_code == 403


def test_initial_totp_binding_edge_cases_rotation_and_secret_replacement(env):
    client = env["client"]()
    other_pending = env["client"]()
    pending = login(env, client).json()
    other_state = login(env, other_pending).json()
    assert pending["state"] == other_state["state"] == "mfa_pending"

    # 未调用 totp/setup 前直接 confirm 必须被拒。
    before_setup = post(client, "totp/confirm", pending, {"code": "123456"})
    assert before_setup.status_code == 403
    assert before_setup.json()["error"]["code"] == "SETUP_REQUIRED"

    first_setup = post(client, "totp/setup", pending).json()
    # 重新发起 setup 会覆盖待绑定 Secret，旧 Secret 验证码不可再确认。
    second_setup = post(client, "totp/setup", pending).json()
    assert second_setup["secret"] != first_setup["secret"]

    wrong_secret = post(
        client,
        "totp/confirm",
        pending,
        {"code": pyotp.TOTP(first_setup["secret"]).at(env["clock"][0])},
    )
    assert wrong_secret.status_code == 401
    with Session(env["engine"]) as db:
        assert not db.scalar(select(AdminUser)).totp_enabled
    advance(env, 2)

    old_cookie = client.cookies.get("__Host-gm_session")
    confirm_code = pyotp.TOTP(second_setup["secret"]).at(env["clock"][0])
    confirmed = post(client, "totp/confirm", pending, {"code": confirm_code})
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["session"]["state"] == "authenticated"
    assert body["session"]["csrf_token"] != pending["csrf_token"]
    assert client.cookies.get("__Host-gm_session") != old_cookie

    # 确认绑定后：旧 Cookie 失效、旧 CSRF 失效、其他待绑定会话被撤销。
    stale_cookie_client = env["client"]()
    stale_cookie_client.cookies.set("__Host-gm_session", old_cookie)
    assert stale_cookie_client.get("/protected").status_code == 401
    assert post(client, "logout", pending).status_code == 403
    assert other_pending.get("/protected").status_code == 401
    assert post(other_pending, "totp/setup", other_state).status_code == 401

    # 绑定确认用过的 TOTP 时间步不能立刻重放登录。
    assert login(env, env["client"](), totp_code=confirm_code).status_code == 401


def test_normal_login_requires_exact_single_factor_and_clears_throttle(env):
    first = env["client"]()
    secret, initial = enroll(env, first)
    advance(env)

    # 启用 TOTP 后：只传密码或同时传 TOTP 与恢复码都必须被拒。
    assert login(env, env["client"]()).status_code == 401
    advance(env, 2)
    code = pyotp.TOTP(secret).at(env["clock"][0])
    both = login(
        env,
        env["client"](),
        totp_code=code,
        recovery_code=initial["recovery_codes"][0],
    )
    assert both.status_code == 401
    with Session(env["engine"]) as db:
        assert db.get(AuthThrottle, "admin").failures == 2
        assert all(r.used_at is None for r in db.scalars(select(AdminRecoveryCode)))
    advance(env, 4)

    # 正确密码 + TOTP 登录成功，清空退避计数并开放业务接口。
    valid_client = env["client"]()
    ok = login(env, valid_client, totp_code=pyotp.TOTP(secret).at(env["clock"][0]))
    assert ok.status_code == 200
    assert ok.json()["state"] == "authenticated"
    assert valid_client.get("/api/v1/accounts").status_code == 200
    assert valid_client.get("/api/v1/dashboard/summary").status_code == 200
    with Session(env["engine"]) as db:
        assert db.get(AuthThrottle, "admin").failures == 0
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "login_success")
            )
            == 1
        )


def test_recovery_login_restricts_business_and_rebind_invalidates_all_old_codes(env):
    first = env["client"]()
    old_secret, initial = enroll(env, first)
    old_codes = initial["recovery_codes"]

    recovery_client = env["client"]()
    res = login(env, recovery_client, recovery_code=old_codes[0])
    assert res.status_code == 200
    pending = res.json()
    assert pending["state"] == "mfa_pending"

    # 恢复码登录后处于 mfa_pending，所有业务与运维端点均被拒。
    for path in ("/api/v1/accounts", "/api/v1/settings", "/api/v1/auth/sessions"):
        blocked = recovery_client.get(path)
        assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "MFA_REQUIRED"

    # 重新绑定 TOTP 后生成 10 个全新恢复码，旧恢复码（含未使用的）全部失效。
    advance(env)
    setup = post(recovery_client, "totp/setup", pending).json()
    confirmed = post(
        recovery_client,
        "totp/confirm",
        pending,
        {"code": pyotp.TOTP(setup["secret"]).at(env["clock"][0])},
    )
    assert confirmed.status_code == 200
    new_codes = confirmed.json()["recovery_codes"]
    assert len(new_codes) == 10 and set(new_codes).isdisjoint(old_codes)
    assert recovery_client.get("/api/v1/accounts").status_code == 200

    # 旧的未使用恢复码与旧 TOTP 均不可登录。
    advance(env)
    assert login(env, env["client"](), recovery_code=old_codes[1]).status_code == 401
    advance(env, 2)
    assert (
        login(
            env, env["client"](), totp_code=pyotp.TOTP(old_secret).at(env["clock"][0])
        ).status_code
        == 401
    )
    advance(env, 32)
    # 新恢复码可用。
    assert login(env, env["client"](), recovery_code=new_codes[0]).status_code == 200


def test_password_change_revokes_all_sessions_including_mfa_pending_and_blocks_old_password(env):
    primary = env["client"]()
    secret, initial = enroll(env, primary)
    state = initial["session"]

    # 同时存在第二个已认证会话和一个带待绑定密文的 mfa_pending 会话。
    advance(env)
    second = env["client"]()
    assert login(env, second, totp_code=pyotp.TOTP(secret).at(env["clock"][0])).status_code == 200

    with Session(env["engine"]) as db, db.begin():
        admin = db.scalar(select(AdminUser))
        pending_session = UserSession(
            admin_user_id=admin.id,
            auth_level="mfa_pending",
            token_hash=b"p" * 32,
            csrf_token_hash=b"c" * 32,
            last_seen_at=env["clock"][0],
            created_at=env["clock"][0],
            expires_at=env["clock"][0] + timedelta(hours=12),
            pending_totp_ciphertext=b"x" * 32,
            pending_totp_nonce=b"n" * 12,
            pending_totp_key_version=1,
            pending_totp_expires_at=env["clock"][0] + timedelta(minutes=10),
        )
        db.add(pending_session)
        db.flush()
        pending_id = pending_session.id

    state = post(primary, "reverify", state, {"password": env["password"]}).json()

    # 新密码不能与当前密码相同，拒绝时不撤销会话。
    same = post(
        primary, "password", state, {"password": env["password"], "new_password": env["password"]}
    )
    assert same.status_code == 422 and same.json()["error"]["code"] == "WEAK_PASSWORD"
    assert primary.get("/protected").status_code == 200

    # 当前密码错误时记录失败且不改密、不撤销会话。
    new_password = random_token()[:20]
    wrong = post(
        primary, "password", state, {"password": random_token(), "new_password": new_password}
    )
    assert wrong.status_code == 401
    assert primary.get("/protected").status_code == 200
    advance(env, 2)

    # 正确改密：清除 Cookie、撤销全部会话并清理 pending_totp。
    changed = post(
        primary, "password", state, {"password": env["password"], "new_password": new_password}
    )
    assert changed.status_code == 200
    assert (
        "Max-Age=0" in changed.headers.get("set-cookie", "")
        or "expires=" in changed.headers.get("set-cookie", "").lower()
    )
    assert primary.get("/protected").status_code == 401
    assert second.get("/protected").status_code == 401
    with Session(env["engine"]) as db:
        rows = db.scalars(select(UserSession)).all()
        assert len(rows) == 3 and all(r.revoked_at is not None for r in rows)
        pending_row = db.get(UserSession, pending_id)
        assert pending_row.pending_totp_ciphertext is None
        assert pending_row.pending_totp_nonce is None
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.event_type == "admin_password_changed")
            )
            == 1
        )

    # 旧密码不可再登录，新密码 + TOTP 正常登录。
    advance(env)
    assert (
        login(env, env["client"](), totp_code=pyotp.TOTP(secret).at(env["clock"][0])).status_code
        == 401
    )
    advance(env, 32)
    fresh = env["client"]()
    fresh_state = bootstrap(fresh)
    relogin = post(
        fresh,
        "login",
        fresh_state,
        {"password": new_password, "totp_code": pyotp.TOTP(secret).at(env["clock"][0])},
    )
    assert relogin.status_code == 200 and relogin.json()["state"] == "authenticated"


def test_session_idle_renewal_extends_window_and_caps_at_absolute_expiry(env):
    client = env["client"]()
    _, result = enroll(env, client)
    state = result["session"]
    with Session(env["engine"]) as db:
        row = db.scalar(select(UserSession))
        session_id = row.id
        t0 = row.last_seen_at
        absolute = row.expires_at

    # 10 分钟后普通读请求不续期；调用 /auth/activity 续期 15 分钟至 T+25m。
    advance(env, 600)
    assert client.get("/api/v1/accounts").status_code == 200
    with Session(env["engine"]) as db:
        assert db.get(UserSession, session_id).last_seen_at == t0

    renewed = post(client, "activity", state)
    assert renewed.status_code == 200
    renewed_body = renewed.json()
    assert datetime.fromisoformat(renewed_body["idle_expires_at"].replace("Z", "+00:00")) == (
        t0 + timedelta(minutes=25)
    )
    with Session(env["engine"]) as db:
        assert db.get(UserSession, session_id).last_seen_at == t0 + timedelta(minutes=10)

    # 再过 10 分钟（总计 T+20m > 初始 15m 闲置截止），会话依然有效。
    advance(env, 600)
    assert client.get("/api/v1/accounts").status_code == 200
    assert post(client, "activity", state).status_code == 200

    # 接近绝对到期时间（绝对截止前 5 分钟）调用 activity，idle_expires_at 不得超过 expires_at。
    while env["clock"][0] + timedelta(minutes=10) < absolute - timedelta(minutes=5):
        advance(env, 600)
        assert post(client, "activity", state).status_code == 200
    env["clock"][0] = absolute - timedelta(minutes=5)
    capped = post(client, "activity", state)
    assert capped.status_code == 200
    assert (
        datetime.fromisoformat(capped.json()["idle_expires_at"].replace("Z", "+00:00")) == absolute
    )
    assert datetime.fromisoformat(capped.json()["expires_at"].replace("Z", "+00:00")) == absolute

    # 到达绝对到期时间立即失效，即便 5 分钟前刚刚活跃过。
    advance(env, 300)
    assert client.get("/api/v1/accounts").status_code == 401
    assert post(client, "activity", state).status_code == 401


@pytest.mark.parametrize(
    "bad_headers",
    [
        {"origin": "https://evil.test"},
        {"origin": "https://testserver"},
        {"origin": "null"},
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "same-site"},
    ],
)
def test_origin_and_sec_fetch_site_rejected_across_business_and_ops_mutations(env, bad_headers):
    client = env["client"]()
    _, result = enroll(env, client)
    state = post(client, "reverify", result["session"], {"password": env["password"]}).json()
    valid_csrf = {"X-CSRF-Token": state["csrf_token"], **bad_headers}

    cases = [
        ("POST", "/api/v1/auth/activity", {}),
        (
            "POST",
            "/api/v1/accounts",
            {
                "gmail_email": "origincheck@gmail.com",
                "password": random_token(),
                "recovery_email_external": "rec@example.test",
            },
        ),
        ("POST", "/api/v1/tags", {"name": "origin-tag"}),
        ("POST", "/api/v1/exports/csv", {"scope": "all"}),
        ("PATCH", "/api/v1/settings/idle", {"idle_minutes": 20}),
        ("DELETE", "/api/v1/auth/sessions/others", None),
    ]
    for method, path, body in cases:
        res = client.request(method, path, json=body, headers=valid_csrf)
        assert res.status_code == 403, (method, path, bad_headers)
        assert res.json()["error"]["code"] == "CSRF_INVALID"

    csv_res = client.post(
        "/api/v1/imports/csv/preview",
        content=b"gmail_email,password,recovery_email\na@gmail.com,secret,b@example.test\n",
        headers={"Content-Type": "text/csv", **valid_csrf},
    )
    assert csv_res.status_code == 403 and csv_res.json()["error"]["code"] == "CSRF_INVALID"

    # 匹配 app_base_url 且 same-origin 的合法请求应当放行。
    ok_headers = {
        "X-CSRF-Token": state["csrf_token"],
        "origin": env["settings"].app_base_url,
        "sec-fetch-site": "same-origin",
    }
    assert client.post("/api/v1/auth/activity", json={}, headers=ok_headers).status_code == 200
    assert client.get("/api/v1/auth/session", headers={"host": "evil.test"}).status_code == 400


def test_password_change_requires_mfa_step_up_when_configured(env, monkeypatch):
    primary = env["client"]()
    secret, initial = enroll(env, primary)
    state = initial["session"]

    advance(env)
    secondary = env["client"]()
    assert (
        login(env, secondary, totp_code=pyotp.TOTP(secret).at(env["clock"][0])).status_code == 200
    )

    # 先以仅密码方式完成普通 reverify（reauthenticated_at 有值，mfa_reauthenticated_at 为空）。
    pw_reverify = post(primary, "reverify", state, {"password": env["password"]})
    assert pw_reverify.status_code == 200
    state = pw_reverify.json()
    assert state["reauthenticated_until"] is not None
    assert state["mfa_reauthenticated_until"] is None

    # 开启 step_up_totp_required 后，仅有密码重验不足以改密，且仅密码 reverify 也会被拒。
    monkeypatch.setattr(env["settings"], "step_up_totp_required", True)
    new_password = random_token()[:20]
    denied = post(
        primary,
        "password",
        state,
        {"password": env["password"], "new_password": new_password},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "REAUTH_REQUIRED"
    assert primary.get("/protected").status_code == 200
    assert secondary.get("/protected").status_code == 200

    pw_only_rejected = post(primary, "reverify", state, {"password": env["password"]})
    assert pw_only_rejected.status_code == 401
    advance(env)

    # 携带密码 + 新时间步 TOTP 完成 step-up 后，改密成功并撤销全部会话。
    mfa_reverify = post(
        primary,
        "reverify",
        state,
        {
            "password": env["password"],
            "totp_code": pyotp.TOTP(secret).at(env["clock"][0]),
        },
    )
    assert mfa_reverify.status_code == 200
    state = mfa_reverify.json()
    assert state["step_up_totp_required"] is True
    assert state["mfa_reauthenticated_until"] is not None

    changed = post(
        primary,
        "password",
        state,
        {"password": env["password"], "new_password": new_password},
    )
    assert changed.status_code == 200
    assert primary.get("/protected").status_code == 401
    assert secondary.get("/protected").status_code == 401
    with Session(env["engine"]) as db:
        rows = db.scalars(select(UserSession)).all()
        assert len(rows) == 2 and all(r.revoked_at is not None for r in rows)
