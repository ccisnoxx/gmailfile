import datetime as dt
import importlib.util
import json
import stat
from pathlib import Path
from types import SimpleNamespace

import pytest

SPEC = importlib.util.spec_from_file_location(
    "acceptance_schedule", Path(__file__).resolve().parents[3] / "scripts/acceptance_schedule.py"
)
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)
PROJECT = "gmail-manager-accept-unit"
ROOT = Path("/var/tmp") / PROJECT


def configuration():
    return {
        "name": PROJECT,
        "services": {
            "postgres": {"environment": {"POSTGRES_DB": "gm_test_accept_unit"}, "restart": "no"},
            "backup": {"restart": "no", "command": ["schedule", "--at", "02:00"]},
        },
        "volumes": {"backup_data": {"name": PROJECT + "_backup_data"}},
        "secrets": {"db_password": {"file": str(ROOT / "secrets/db_password")}},
    }


@pytest.mark.parametrize("hour,day", [(1, 25), (2, 26), (23, 26)])
def test_next_real_0200_utc_without_clock_acceleration(hour, day):
    now = dt.datetime(2026, 11, 25, hour, tzinfo=dt.UTC)
    assert ops.next_due(now) == dt.datetime(2026, 11, day, 2, tzinfo=dt.UTC)


def test_custom_acceptance_time_uses_same_real_daily_scheduler():
    now = dt.datetime(2026, 11, 25, 1, 10, tzinfo=dt.UTC)
    assert ops.next_due(now, "01:20") == dt.datetime(2026, 11, 25, 1, 20, tzinfo=dt.UTC)


@pytest.mark.parametrize(
    "violation", ["project", "database", "port", "restart", "volume", "secret"]
)
def test_refuses_nonisolated_configuration(violation):
    value = configuration()
    if violation == "project":
        value["name"] = "other-project"
    elif violation == "database":
        value["services"]["postgres"]["environment"]["POSTGRES_DB"] = "production"
    elif violation == "port":
        value["services"]["backup"]["ports"] = [{"published": "8000"}]
    elif violation == "restart":
        value["services"]["backup"]["restart"] = "unless-stopped"
    elif violation == "volume":
        value["volumes"]["backup_data"]["name"] = "other-project_data"
    else:
        value["secrets"]["db_password"]["file"] = "/other-project/secrets/password"
    with pytest.raises(ops.AcceptanceError):
        ops.validate_configuration(value, PROJECT, ROOT)


def mock_directory(monkeypatch, gates):
    old_stat = Path.lstat
    old_read = Path.read_text
    monkeypatch.setattr(
        Path,
        "lstat",
        lambda self: (
            SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
            if self == ROOT
            else old_stat(self)
        ),
    )
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda self, *a, **kw: (
            json.dumps(gates) if self == ROOT / "evidence/gates.json" else old_read(self, *a, **kw)
        ),
    )


def test_no_docker_command_before_both_gates_pass(monkeypatch):
    mock_directory(monkeypatch, {"A": "passed", "B": "pending"})
    monkeypatch.setattr(ops, "checked", lambda *a, **kw: pytest.fail("must not contact Docker"))
    with pytest.raises(ops.AcceptanceError, match="GATES_NOT_PASSED"):
        ops.observe(ROOT, PROJECT)


def test_missed_requested_date_is_not_silently_moved_to_tomorrow(monkeypatch):
    mock_directory(
        monkeypatch,
        {"A": "passed", "B": "passed", "expected_due_at": "2026-11-25T01:20:00+00:00"},
    )
    original_datetime = dt.datetime

    class Clock(original_datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 11, 25, 2, tzinfo=dt.UTC)

    monkeypatch.setattr(ops.dt, "datetime", Clock)
    value = configuration()
    value["services"]["backup"]["command"] = ["schedule", "--at", "01:20"]

    def read_configuration(args, **kw):
        assert "config" in args, "must not start Docker resources"
        return json.dumps(value)

    monkeypatch.setattr(ops, "checked", read_configuration)
    with pytest.raises(ops.AcceptanceError, match="REQUESTED_TIME_MISSED_NO_REPLAY"):
        ops.observe(ROOT, PROJECT)


@pytest.mark.parametrize("failure", ["partial_start", "deadline"])
def test_start_failure_or_deadline_stops_only_acceptance_project(monkeypatch, failure):
    mock_directory(monkeypatch, {"A": "passed", "B": "passed"})
    original_datetime = dt.datetime

    class Clock(original_datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 11, 25, 0, tzinfo=dt.UTC)

    monkeypatch.setattr(ops.dt, "datetime", Clock)
    records = []
    monkeypatch.setattr(
        ops, "atomic_json", lambda path, value: records.append(json.loads(json.dumps(value)))
    )
    monkeypatch.setattr(ops, "claim_run", lambda path, value: None)

    def command(args, **kwargs):
        if "config" in args:
            return json.dumps(configuration())
        assert "up" in args
        if failure == "deadline":
            ops.signal.raise_signal(ops.signal.SIGALRM)
        raise ops.AcceptanceError("ACCEPTANCE_COMMAND_FAILED")

    monkeypatch.setattr(ops, "checked", command)
    stopped = []
    monkeypatch.setattr(ops, "stop_project", lambda project: (stopped.append(project), True)[1])
    assert ops.observe(ROOT, PROJECT) == 1
    assert stopped == [PROJECT]
    assert records[-1]["state"] == "failed" and records[-1]["containers_stopped"]
    assert records[-1]["error_code"] == (
        "SCHEDULE_DEADLINE_EXCEEDED" if failure == "deadline" else "ACCEPTANCE_COMMAND_FAILED"
    )


def test_batch_cannot_silently_rearm_after_disconnect(tmp_path):
    record = tmp_path / "schedule-result.json"
    ops.claim_run(record, {"state": "waiting"})
    with pytest.raises(ops.AcceptanceError, match="SCHEDULE_ALREADY_STARTED_QUERY_RESULT"):
        ops.claim_run(record, {"state": "waiting"})
    assert json.loads(record.read_text()) == {"state": "waiting"}


def test_stop_includes_oneoffs_and_checks_actual_running_state(monkeypatch):
    service, oneoff = "a" * 64, "b" * 64
    calls = []

    def run(args, **kw):
        calls.append(args)
        output = f"{service} {PROJECT}\n{oneoff} {PROJECT}\n" if len(calls) == 1 else ""
        return SimpleNamespace(returncode=0, stdout=output)

    monkeypatch.setattr(ops.subprocess, "run", run)
    assert ops.stop_project(PROJECT)
    assert calls[1] == ["docker", "stop", "--timeout", "20", service, oneoff]
    assert calls[0] == calls[-1]
    assert "label=com.docker.compose.project=" + PROJECT in calls[0]


def test_stop_does_not_claim_success_if_a_container_stays_running(monkeypatch):
    identifier = "a" * 64
    monkeypatch.setattr(
        ops.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=f"{identifier} {PROJECT}\n"),
    )
    assert not ops.stop_project(PROJECT)
