"""Privacy defaults for evaluation frameworks (must run before importing ragas/deepeval)."""

from __future__ import annotations

import os

from app.core.config import get_settings


def configure_evaluation_env() -> None:
    # Opt out of third-party usage telemetry: evaluation inputs include document content.
    os.environ.setdefault("RAGAS_DO_NOT_TRACK", "true")
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    os.environ.setdefault("DEEPEVAL_UPDATE_WARNING_OPT_IN", "NO")
    os.environ.setdefault("DEEPEVAL_GRPC_LOGGING", "NO")
    os.environ.setdefault("ERROR_REPORTING", "NO")
    settings = get_settings()
    if settings.openai_api_key is not None:
        os.environ.setdefault("OPENAI_API_KEY", settings.openai_api_key.get_secret_value())
