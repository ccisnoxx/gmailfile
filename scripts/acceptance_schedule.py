#!/usr/bin/env python3
"""观察一次配置时刻的真实调度并验证取回恢复；结束/失败必停本批隔离容器。"""

import argparse
import datetime as dt
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path


class AcceptanceError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise AcceptanceError(code)


def next_due(now, at="02:00"):
    require(re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", at), "INVALID_UTC_TIME")
    hour, minute = map(int, at.split(":"))
    due = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return due + dt.timedelta(days=1) if due <= now else due


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, path)


def claim_run(path, value):
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        raise AcceptanceError("SCHEDULE_ALREADY_STARTED_QUERY_RESULT") from None
    with os.fdopen(descriptor, "w") as stream:
        stream.write(json.dumps(value, indent=2) + "\n")


def stop_project(project):
    # Compose stop excludes one-offs. Query all running members by exact project label instead.
    query = [
        "docker",
        "ps",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=" + project,
        "--format",
        '{{.ID}} {{.Label "com.docker.compose.project"}}',
    ]
    members = subprocess.run(query, capture_output=True, text=True, timeout=30)
    if members.returncode:
        return False
    identifiers = []
    for line in members.stdout.splitlines():
        identifier, label = line.split()
        if not re.fullmatch(r"[a-f0-9]{64}", identifier) or label != project:
            return False
        identifiers.append(identifier)
    if identifiers:
        subprocess.run(
            ["docker", "stop", "--timeout", "20", *identifiers],
            capture_output=True,
            text=True,
            timeout=120,
        )
    remaining = subprocess.run(query, capture_output=True, text=True, timeout=30)
    return remaining.returncode == 0 and not remaining.stdout.strip()


def checked(command, *, timeout=120):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, "ACCEPTANCE_COMMAND_FAILED")
    return result.stdout


def validate_configuration(config, project, root):
    require(config["name"] == project, "PROJECT_MISMATCH")
    require(
        config["services"]["postgres"]["environment"]["POSTGRES_DB"].startswith("gm_test_accept_"),
        "NOT_ACCEPTANCE_DATABASE",
    )
    for service in config["services"].values():
        require(not service.get("ports"), "HOST_PORTS_FORBIDDEN")
        require(service.get("restart", "no") == "no", "AUTO_RESTART_FORBIDDEN")
    for volume in config["volumes"].values():
        require(
            not volume.get("external") and volume["name"].startswith(project + "_"),
            "SHARED_VOLUME_FORBIDDEN",
        )
    ssh_names = {"backup_ssh_config", "backup_ssh_identity", "backup_known_hosts"}
    for name, secret in config["secrets"].items():
        path = Path(secret["file"])
        if name in ssh_names:
            require(
                path == Path("/opt/example/gmail-manager/secrets/offsite") / name,
                "SSH_IDENTITY_PATH_MISMATCH",
            )
        else:
            require(path.is_relative_to(root), "EXTERNAL_TEST_SECRET_FORBIDDEN")


def observe(root, project):
    require(re.fullmatch(r"gmail-manager-accept-[a-z0-9-]+", project), "PROJECT_NAME_INVALID")
    require(root == Path("/var/tmp") / project, "DIRECTORY_MISMATCH")
    info = root.lstat()
    require(
        stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
        "UNSAFE_ACCEPTANCE_DIRECTORY",
    )
    evidence = root / "evidence"
    gates = json.loads((evidence / "gates.json").read_text())
    require(gates.get("A") == "passed" and gates.get("B") == "passed", "GATES_NOT_PASSED")
    compose = [
        "docker",
        "compose",
        "--project-name",
        project,
        "--env-file",
        str(root / "acceptance.env"),
    ]
    for name in (
        "docker-compose.yml",
        "docker-compose.offsite.yml",
        "docker-compose.acceptance.yml",
    ):
        compose += ["-f", str(root / "source/infra" / name)]
    compose += ["--profile", "operations", "--profile", "acceptance"]
    config = json.loads(checked(compose + ["config", "--format", "json"]))
    validate_configuration(config, project, root)
    database = config["services"]["postgres"]["environment"]["POSTGRES_DB"]
    command = config["services"]["backup"]["command"]
    require(command[0] == "schedule" and command.count("--at") == 1, "NOT_DAILY_SCHEDULER")
    at = command[command.index("--at") + 1]
    now = dt.datetime.now(dt.UTC)
    due = next_due(now, at)
    if gates.get("expected_due_at"):
        require(
            due == dt.datetime.fromisoformat(gates["expected_due_at"]),
            "REQUESTED_TIME_MISSED_NO_REPLAY",
        )
    require((due - now).total_seconds() >= 120, "INSUFFICIENT_STARTUP_TIME")
    deadline = due + dt.timedelta(minutes=30)
    lifetime = int((deadline - now).total_seconds())
    guard = root / "schedule-guard.json"
    atomic_json(
        guard,
        {
            "services": {
                "backup": {
                    "entrypoint": [
                        "timeout",
                        "--signal=TERM",
                        "--kill-after=30s",
                        str(lifetime),
                        "python3",
                        "/source/scripts/backup_tool.py",
                    ]
                }
            }
        },
    )
    scheduled_compose = compose + ["-f", str(guard)]
    result = {
        "state": "waiting",
        "project": project,
        "controller_pid": os.getpid(),
        "due_at": due.isoformat(),
        "configured_at_utc": at,
        "deadline": deadline.isoformat(),
        "gates": {"A": "passed", "B": "passed"},
    }
    path = evidence / "schedule-result.json"
    claim_run(path, result)  # One batch gets one attempt; reconnects query, never silently re-arm.
    started = False
    previous_alarm = signal.getsignal(signal.SIGALRM)

    def expired(*_):
        raise AcceptanceError("SCHEDULE_DEADLINE_EXCEEDED")

    try:
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, (deadline - dt.datetime.now(dt.UTC)).total_seconds())
        started = True
        checked(scheduled_compose + ["up", "-d", "--no-build", "--no-deps", "backup"])
        while dt.datetime.now(dt.UTC) < deadline:
            ids = checked(compose + ["ps", "--quiet", "postgres", "backup"]).split()
            require(len(ids) == 2, "ACCEPTANCE_CONTAINER_EXITED")
            states = json.loads(checked(["docker", "inspect", *ids]))
            for item in states:
                require(
                    item["Config"]["Labels"].get("com.docker.compose.project") == project,
                    "CONTAINER_PROJECT_MISMATCH",
                )
                require(
                    item["State"]["Running"] and not item["State"].get("OOMKilled"),
                    "ACCEPTANCE_CONTAINER_FAILED",
                )
                require(
                    item["State"].get("Health", {}).get("Status") != "unhealthy",
                    "ACCEPTANCE_CONTAINER_UNHEALTHY",
                )
            status = json.loads(
                checked(
                    compose
                    + [
                        "exec",
                        "-T",
                        "backup",
                        "python3",
                        "-c",
                        "from pathlib import Path; print(Path('/backups/status.json').read_text())",
                    ]
                )
            )
            attempt = dt.datetime.fromisoformat(status["last_attempt_at"])
            if attempt >= due:
                if status["state"] == "failed":
                    raise AcceptanceError("SCHEDULED_BACKUP_FAILED")
                if status["state"] == "success":
                    require(status["offsite"] == "success", "OFFSITE_NOT_CONFIRMED")
                    result["scheduled_status"] = status
                    break
            time.sleep(5 if (due - dt.datetime.now(dt.UTC)).total_seconds() < 60 else 60)
        else:
            raise AcceptanceError("SCHEDULE_DEADLINE_EXCEEDED")
        # The existing schedule implementation is the only trigger. Stop it before postchecks.
        checked(compose + ["stop", "--timeout", "20", "backup"])
        post_guard = root / "postcheck-guard.json"
        bounded_entrypoint = [
            "timeout",
            "--signal=TERM",
            "--kill-after=30s",
            "300",
            "python3",
            "/source/scripts/backup_tool.py",
        ]
        atomic_json(
            post_guard,
            {
                "services": {
                    name: {"entrypoint": bounded_entrypoint} for name in ("backup", "restore")
                }
            },
        )
        post_compose = compose + ["-f", str(post_guard)]
        retrieval = config["volumes"]["retrieved_data"]["name"]
        fetch = checked(
            post_compose
            + [
                "run",
                "--rm",
                "--no-deps",
                "--name",
                project + "-daily-fetch",
                "-T",
                "-v",
                retrieval + ":/retrieved",
                "backup",
                "fetch",
                "--directory",
                "/retrieved/scheduled",
            ],
            timeout=300,
        )
        atomic_json(evidence / "schedule-fetch.json", json.loads(fetch))
        restore = checked(
            post_compose
            + [
                "run",
                "--rm",
                "--no-deps",
                "--name",
                project + "-daily-restore",
                "-T",
                "restore",
                "restore",
                "--backup",
                "/retrieved/scheduled",
                "--identity",
                "/run/secrets/backup_identity",
                "--source-database",
                database,
                "--target-database",
                "gm_restore_daily_"
                + project.removeprefix("gmail-manager-accept-").replace("-", "_"),
                "--isolated",
            ],
            timeout=300,
        )
        proof = json.loads(restore)
        require(proof["result"] == "verified" and not proof["switched"], "RESTORE_NOT_VERIFIED")
        require(
            proof["decrypted_samples"] == gates["expected_decryption_groups"],
            "SAMPLE_COUNT_MISMATCH",
        )
        atomic_json(evidence / "schedule-restore.json", proof)
        result["state"] = "passed"
    except BaseException as exc:
        result["state"] = "failed"
        result["error_code"] = str(exc) if isinstance(exc, AcceptanceError) else type(exc).__name__
    finally:
        # The deadline covers fetch/restore too; allow the bounded stop operation to finish.
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_alarm)
        if started:
            try:
                result["containers_stopped"] = stop_project(project)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                result["containers_stopped"] = False
            if not result["containers_stopped"]:
                result["state"] = "failed"
                result["error_code"] = "CONTAINER_STOP_FAILED"
        result["finished_at"] = dt.datetime.now(dt.UTC).isoformat()
        atomic_json(path, result)
    return 0 if result["state"] == "passed" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--project", required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        return observe(args.directory, args.project)
    except Exception as exc:
        code = str(exc) if isinstance(exc, AcceptanceError) else type(exc).__name__
        print("ACCEPTANCE_SCHEDULE_FAILED: " + code, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
