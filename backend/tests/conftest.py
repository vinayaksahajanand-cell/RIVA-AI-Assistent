"""Test configuration.

* Uses the separate ``riva_test`` database (created by infra/postgres/init.sql) and rebuilds the
  schema with the real Alembic migrations once per session.
* Uses real local embeddings (FastEmbed) and the real cross-encoder reranker.
* Replaces only the chat LLM with a deterministic scripted model (tests/fakes.py).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

TEST_DB = os.environ.get("TEST_DATABASE_URL",
                         "postgresql+asyncpg://riva:riva_dev_password@localhost:5434/riva_test")
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": TEST_DB,
    "REDIS_URL": "",
    "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": "",
    "EMBEDDING_PROVIDER": "fastembed",
    "EMBEDDING_MODEL": "BAAI/bge-small-en-v1.5",
    "EMBEDDING_DIMENSIONS": "384",
    "RERANKER_PROVIDER": "cross-encoder",
    "EMBEDDED_WORKER": "false",
    "LANGCHAIN_TRACING_V2": "false",
    "LANGSMITH_TRACING": "false",
    "RATE_LIMIT_ENABLED": "false",
    "STORAGE_DIR": str(BACKEND / ".pytest_storage"),
    "SECRET_KEY": "test-secret-key-for-pytest-only-0123456789",
    "OCR_ENABLED": "true",
    "REGISTRATION_MODE": "personal",  # each test user gets an isolated workspace (tenant-isolation tests)
    "EVALUATION_RESULTS_DIR": str(BACKEND / ".pytest_storage" / "results"),
})

import asyncio  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

from tests.fakes import scripted_factory  # noqa: E402


def _reset_database() -> None:
    import asyncpg

    async def _drop() -> None:
        dsn = TEST_DB.replace("+asyncpg", "")
        conn = await asyncpg.connect(dsn)
        try:
            await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        finally:
            await conn.close()

    asyncio.run(_drop())
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND,
                            env={**os.environ, "ALEMBIC_DATABASE_URL": TEST_DB}, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Alembic migration failed:\n{result.stderr[-3000:]}")


@pytest.fixture(scope="session", autouse=True)
def database():
    _reset_database()
    shutil.rmtree(os.environ["STORAGE_DIR"], ignore_errors=True)
    yield
    shutil.rmtree(os.environ["STORAGE_DIR"], ignore_errors=True)


@pytest.fixture(scope="session", autouse=True)
def fake_llm():
    from app.llm.provider import set_chat_model_override

    set_chat_model_override(scripted_factory)
    yield
    set_chat_model_override(None)


@pytest_asyncio.fixture(scope="session")
async def app(database):
    from app.main import create_app

    yield create_app()
    from app.database.session import dispose_engine

    await dispose_engine()


@pytest_asyncio.fixture(scope="session")
async def client_factory(app):
    clients: list[httpx.AsyncClient] = []

    async def make() -> httpx.AsyncClient:
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=120)
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


_user_counter = {"n": 0}


async def register(client: httpx.AsyncClient, name: str = "user") -> dict:
    _user_counter["n"] += 1
    email = f"{name}{_user_counter['n']}@example.com"
    r = await client.post("/api/auth/register", json={"email": email, "password": "correct-horse-1",
                                                      "full_name": name.title()})
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return r.json()


async def drain_jobs() -> int:
    """Run the worker's ingestion loop until no jobs are left (synchronously, inside the test)."""
    from app.worker import process_next_ingestion

    n = 0
    while await process_next_ingestion():
        n += 1
    return n


async def upload(client: httpx.AsyncClient, files: dict[str, bytes], collection_id: str | None = None) -> dict:
    data = {"collection_id": collection_id} if collection_id else None
    r = await client.post("/api/documents/upload", files=[("files", (n, b)) for n, b in files.items()], data=data)
    assert r.status_code == 201, r.text
    await drain_jobs()
    return r.json()


def parse_sse(text: str) -> list[tuple[str, dict]]:
    import json

    events = []
    for frame in text.split("\n\n"):
        lines = [ln for ln in frame.split("\n") if ln and not ln.startswith(":")]
        if not lines:
            continue
        event = next((ln[7:] for ln in lines if ln.startswith("event: ")), "message")
        data = "\n".join(ln[6:] for ln in lines if ln.startswith("data: "))
        events.append((event, json.loads(data) if data else {}))
    return events
