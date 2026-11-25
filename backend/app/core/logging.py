import json
import logging


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
