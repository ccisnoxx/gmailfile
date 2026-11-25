"""零外部依赖的 Python 3.12 覆盖率统计与质量门禁脚本（基于 sys.monitoring + co_lines）。

不修改已锁定的 uv.lock / pyproject.toml，直接统计 backend/app 的可执行行覆盖率与核心安全模块覆盖率。
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import sys
import types
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
APP_DIR = BACKEND_DIR / "app"

CORE_SECURITY_PREFIXES = (
    "app/core/",
    "app/services/auth/",
    "app/services/audit_integrity.py",
    "app/services/accounts/",
    "app/services/csv_transfer/",
)


@dataclass(frozen=True)
class FileCoverage:
    rel_path: str
    executable: int
    executed: int
    missing_lines: tuple[int, ...]

    @property
    def percent(self) -> float:
        if self.executable == 0:
            return 100.0
        return (self.executed / self.executable) * 100.0


def _iter_code_objects(code: types.CodeType) -> Iterator[types.CodeType]:
    yield code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            yield from _iter_code_objects(const)


def _node_line_span(node: ast.AST) -> set[int]:
    start = getattr(node, "lineno", None)
    end = getattr(node, "end_lineno", start)
    if start is None or end is None:
        return set()
    return set(range(start, end + 1))


def _is_type_checking_guard(test: ast.expr) -> bool:
    if isinstance(test, ast.Name) and test.id == "TYPE_CHECKING":
        return True
    if isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING":
        return True
    return False


def _collect_excluded_lines(source: str, tree: ast.AST) -> set[int]:
    lines = source.splitlines()
    pragma_lines = {idx for idx, text in enumerate(lines, start=1) if "pragma: no cover" in text}
    excluded = set(pragma_lines)
    for node in ast.walk(tree):
        lineno = getattr(node, "lineno", None)
        if lineno in pragma_lines:
            excluded.update(_node_line_span(node))
        if isinstance(node, ast.If) and _is_type_checking_guard(node.test):
            excluded.update(_node_line_span(node))
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and node.value.value is Ellipsis
        ):
            excluded.update(_node_line_span(node))
    return excluded


def collect_executable_lines(path: Path) -> set[int]:
    """通过 CPython 字节码 co_lines 提取真实可执行行，并排除 pragma/TYPE_CHECKING 块。"""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    code = compile(source, str(path), "exec")
    executable: set[int] = set()
    for obj in _iter_code_objects(code):
        for _start, _end, lineno in obj.co_lines():
            if lineno is not None and lineno > 0:
                executable.add(lineno)
    excluded = _collect_excluded_lines(source, tree)
    return executable - excluded


def is_core_security_module(rel_path: str) -> bool:
    return any(
        rel_path == prefix or rel_path.startswith(prefix) for prefix in CORE_SECURITY_PREFIXES
    )


def summarize_coverage(
    app_dir: Path,
    hits_by_file: dict[str, set[int]],
) -> tuple[list[FileCoverage], float, float]:
    records: list[FileCoverage] = []
    total_exec = 0
    total_hit = 0
    core_exec = 0
    core_hit = 0

    for py_file in sorted(app_dir.rglob("*.py")):
        resolved = str(py_file.resolve())
        rel = py_file.relative_to(app_dir.parent).as_posix()
        executable = collect_executable_lines(py_file)
        executed = executable & hits_by_file.get(resolved, set())
        missing = tuple(sorted(executable - executed))
        records.append(
            FileCoverage(
                rel_path=rel,
                executable=len(executable),
                executed=len(executed),
                missing_lines=missing,
            )
        )
        total_exec += len(executable)
        total_hit += len(executed)
        if is_core_security_module(rel):
            core_exec += len(executable)
            core_hit += len(executed)

    total_pct = 100.0 if total_exec == 0 else (total_hit / total_exec) * 100.0
    core_pct = 100.0 if core_exec == 0 else (core_hit / core_exec) * 100.0
    return records, total_pct, core_pct


def evaluate_thresholds(
    total_pct: float,
    core_pct: float,
    *,
    min_total: float,
    min_core: float,
) -> list[str]:
    failures: list[str] = []
    if total_pct < min_total:
        failures.append(f"总体行覆盖率 {total_pct:.2f}% 低于阈值 {min_total:.2f}%")
    if core_pct < min_core:
        failures.append(f"核心安全模块行覆盖率 {core_pct:.2f}% 低于阈值 {min_core:.2f}%")
    return failures


def _pick_monitoring_tool_id() -> int:
    for candidate in (sys.monitoring.COVERAGE_ID, 3, 4, 5):
        if sys.monitoring.get_tool(candidate) is None:
            return candidate
    raise RuntimeError("无法申请 sys.monitoring 工具槽位")


def run_pytest_with_coverage(
    pytest_args: list[str],
    *,
    app_dir: Path = APP_DIR,
) -> tuple[int, list[FileCoverage], float, float]:
    import pytest

    tracked_files = {str(p.resolve()) for p in app_dir.rglob("*.py")}
    hits: dict[str, set[int]] = {path: set() for path in tracked_files}

    tool_id = _pick_monitoring_tool_id()
    sys.monitoring.use_tool_id(tool_id, "gmailfile_coverage")

    def on_line(code: types.CodeType, lineno: int) -> object:
        filename = code.co_filename
        bucket = hits.get(filename)
        if bucket is not None:
            bucket.add(lineno)
        return sys.monitoring.DISABLE

    sys.monitoring.register_callback(tool_id, sys.monitoring.events.LINE, on_line)
    sys.monitoring.set_events(tool_id, sys.monitoring.events.LINE)

    old_cwd = Path.cwd()
    backend_str = str(app_dir.parent.resolve())
    inserted_path = False
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)
        inserted_path = True
    try:
        os.chdir(app_dir.parent)
        exit_code = int(pytest.main(pytest_args))
    finally:
        sys.monitoring.set_events(tool_id, 0)
        sys.monitoring.register_callback(tool_id, sys.monitoring.events.LINE, None)
        sys.monitoring.free_tool_id(tool_id)
        os.chdir(old_cwd)
        if inserted_path and backend_str in sys.path:
            sys.path.remove(backend_str)

    records, total_pct, core_pct = summarize_coverage(app_dir, hits)
    return exit_code, records, total_pct, core_pct


def format_report(records: list[FileCoverage], total_pct: float, core_pct: float) -> str:
    lines = [
        "",
        "=== Backend Line Coverage (sys.monitoring + co_lines) ===",
        f"{'Module':<52} {'Hit/Exec':>10} {'Rate':>8}  Core",
        "-" * 78,
    ]
    for rec in records:
        core_flag = "*" if is_core_security_module(rec.rel_path) else ""
        lines.append(
            f"{rec.rel_path:<52} {rec.executed:>4}/{rec.executable:<5} "
            f"{rec.percent:>7.2f}%  {core_flag}"
        )
    lines.append("-" * 78)
    lines.append(f"Total backend/app coverage : {total_pct:.2f}%")
    lines.append(f"Core security coverage (*) : {core_pct:.2f}%")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="后端零依赖行覆盖率统计与质量门禁")
    parser.add_argument(
        "--min-total", type=float, default=80.0, help="backend/app 最低总体覆盖率(%)"
    )
    parser.add_argument("--min-core", type=float, default=85.0, help="核心安全模块最低覆盖率(%)")
    parser.add_argument("--json-out", type=Path, default=None, help="可选 JSON 报告输出路径")
    parser.add_argument(
        "pytest_args",
        nargs=argparse.REMAINDER,
        help="透传给 pytest 的参数（可使用 -- 分隔）",
    )
    args = parser.parse_args(argv)
    pytest_args = list(args.pytest_args)
    if pytest_args and pytest_args[0] == "--":
        pytest_args = pytest_args[1:]
    if not pytest_args:
        pytest_args = ["-q"]

    exit_code, records, total_pct, core_pct = run_pytest_with_coverage(pytest_args)
    print(format_report(records, total_pct, core_pct))

    if args.json_out is not None:
        payload = {
            "total_percent": round(total_pct, 2),
            "core_percent": round(core_pct, 2),
            "min_total": args.min_total,
            "min_core": args.min_core,
            "files": [
                {
                    "path": r.rel_path,
                    "executable": r.executable,
                    "executed": r.executed,
                    "percent": round(r.percent, 2),
                    "core": is_core_security_module(r.rel_path),
                    "missing_lines": list(r.missing_lines),
                }
                for r in records
            ],
        }
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    if exit_code != 0:
        print(f"FAIL: pytest exited with code {exit_code}", file=sys.stderr)
        return exit_code

    failures = evaluate_thresholds(
        total_pct, core_pct, min_total=args.min_total, min_core=args.min_core
    )
    if failures:
        for msg in failures:
            print(f"FAIL: {msg}", file=sys.stderr)
        return 1

    print(
        f"PASS: total {total_pct:.2f}% >= {args.min_total:.2f}%, "
        f"core {core_pct:.2f}% >= {args.min_core:.2f}%"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
