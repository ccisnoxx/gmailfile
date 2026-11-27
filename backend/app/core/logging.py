import json
import logging
import traceback
from pathlib import Path

_APP_PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def _normalize_frame_path(filename: str) -> str:
    path = Path(filename)
    try:
        rel = path.resolve().relative_to(_APP_PACKAGE_ROOT)
        return f"app/{rel.as_posix()}"
    except (OSError, ValueError):
        parts = path.parts
        if len(parts) >= 3:
            return "/".join(parts[-3:])
        return path.name


def safe_traceback_frames(exc: BaseException, *, max_frames: int = 12) -> list[str]:
    """提取仅包含相对模块路径、行号与函数名的脱敏栈帧摘要，绝不记录异常消息或局部变量。"""
    tb = exc.__traceback__
    if tb is None:
        return []
    frames = traceback.extract_tb(tb)
    return [
        f"{_normalize_frame_path(frame.filename)}:{frame.lineno}:{frame.name}"
        for frame in frames[-max_frames:]
    ]


def safe_cause_types(exc: BaseException, *, max_depth: int = 5) -> list[str]:
    """提取异常链上的底层异常类型名（不含消息原文），便于定位根因类别。"""
    chain: list[str] = []
    seen: set[int] = {id(exc)}
    current: BaseException | None = exc.__cause__ or (
        None if exc.__suppress_context__ else exc.__context__
    )
    while current is not None and len(chain) < max_depth and id(current) not in seen:
        seen.add(id(current))
        chain.append(type(current).__name__)
        current = current.__cause__ or (
            None if current.__suppress_context__ else current.__context__
        )
    return chain


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
                "level": record.levelname,
                "event_type": record.getMessage(),
                **getattr(record, "safe_fields", {}),
            },
            ensure_ascii=False,
        )


def configure_logging() -> None:
    import time

    JsonFormatter.converter = time.gmtime
    logger = logging.getLogger("gmail_manager")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
