"""Launch the real RIVA API for browser end-to-end tests, with ONLY the chat LLM replaced by the
deterministic scripted test model (tests/fakes.py). Never use this for real users.

    python -m tests.e2e_server            # http://127.0.0.1:8101, database riva_e2e

Everything else is real: database, uploads, OCR, embeddings, BM25, reranking, LangGraph, SSE,
persistence, analytics. RAGAS metrics show N/A because no evaluator key is configured.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
E2E_DB = os.environ.get("E2E_DATABASE_URL", "postgresql+asyncpg://riva:riva_dev_password@localhost:5434/riva_e2e")

os.environ.update({
    "ENVIRONMENT": "development",
    "DATABASE_URL": E2E_DB,
    "OPENAI_API_KEY": "",
    "EMBEDDING_PROVIDER": "fastembed",
    "EMBEDDING_MODEL": "BAAI/bge-small-en-v1.5",
    "EMBEDDING_DIMENSIONS": "384",
    "STORAGE_DIR": str(BACKEND / ".e2e_storage"),
    "CORS_ORIGINS": "http://localhost:3001,http://127.0.0.1:3001,http://localhost:3000",
    "RATE_LIMIT_ENABLED": "false",
    "LANGCHAIN_TRACING_V2": "false",
})


def main() -> None:
    sys.path.insert(0, str(BACKEND))
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True,
                   env={**os.environ, "ALEMBIC_DATABASE_URL": E2E_DB})
    import uvicorn

    from app.llm.provider import set_chat_model_override
    from app.main import create_app
    from tests.fakes import scripted_factory

    set_chat_model_override(scripted_factory)
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("E2E_PORT", "8101")))


if __name__ == "__main__":
    main()
