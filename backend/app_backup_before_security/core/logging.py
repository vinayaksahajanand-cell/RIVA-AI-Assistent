"""Structured logging with secret redaction."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),  # OpenAI style keys
    re.compile(r"lsv2_[A-Za-z0-9_\-]{16,}"),  # LangSmith keys
    re.compile(r"(?i)(api[_-]?key|password|secret|token)(\"?\s*[:=]\s*\"?)([^\s\",]+)"),
]


def redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        if pattern.groups >= 3:
            text = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}***", text)
        else:
            text = pattern.sub("***", text)
    return text


class RedactingFormatter(logging.Formatter):
    def __init__(self, json_output: bool) -> None:
        super().__init__("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
        self.json_output = json_output

    def format(self, record: logging.LogRecord) -> str:
        message = redact(record.getMessage())
        if self.json_output:
            payload = {
                "ts": datetime.now(UTC).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": message,
            }
            if record.exc_info:
                payload["exc"] = redact(self.formatException(record.exc_info))
            return json.dumps(payload)
        record = logging.makeLogRecord({**record.__dict__, "msg": message, "args": ()})
        return redact(super().format(record))


def configure_logging(level: str = "INFO", json_output: bool = False) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RedactingFormatter(json_output))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for noisy in ("httpx", "httpcore", "openai", "urllib3", "pdfminer", "fontTools"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
