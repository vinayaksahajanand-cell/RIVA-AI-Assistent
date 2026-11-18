"""Administrative commands.

    python -m app.cli create-user --email admin@example.com --password ... [--role admin|manager|user]
    python -m app.cli reset-embeddings     # after changing EMBEDDING_* settings: resize vector column + re-index
    python -m app.cli reindex-all          # queue a re-index of every document (e.g. after chunking changes)
    python -m app.cli check                # verify database, pgvector, LLM and LangSmith configuration
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from sqlalchemy import select, text, update


async def create_user(email: str, password: str, name: str, role: str) -> None:
    """Create an account in the organization workspace (created on first use) with an RBAC role."""
    from app.core.security import hash_password
    from app.database.session import dispose_engine, session_scope
    from app.models import User, Workspace, WorkspaceMember

    async with session_scope() as s:
        if (await s.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none():
            raise SystemExit("A user with this email already exists.")
        user = User(email=email.lower(), full_name=name, password_hash=hash_password(password),
                    role="admin" if role == "admin" else "user")
        s.add(user)
        await s.flush()
        ws = (await s.execute(select(Workspace).where(Workspace.is_default.is_(True)).limit(1))).scalar_one_or_none()
        if ws is None:
            ws = Workspace(name="Organization workspace", owner_id=user.id, settings={}, is_default=True)
            s.add(ws)
            await s.flush()
            role = "admin"  # the first account of a new organization must be able to administer it
        s.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role=role))
    await dispose_engine()
    print(f"Created {role} {email} in '{ws.name}'")


async def _queue_all(job_type: str) -> int:
    from app.database.session import session_scope
    from app.models import Document, IngestionJob

    async with session_scope() as s:
        docs = (await s.execute(select(Document))).scalars().all()
        for d in docs:
            d.status = "updating" if d.chunk_count else "uploaded"
            s.add(IngestionJob(workspace_id=d.workspace_id, document_id=d.id, job_type=job_type))
    return len(docs)


async def reset_embeddings() -> None:
    from app.core.config import get_settings
    from app.database.session import dispose_engine, session_scope
    from app.models import Document

    dim = get_settings().embedding_dimensions
    async with session_scope() as s:
        await s.execute(text("DROP INDEX IF EXISTS ix_chunks_embedding_hnsw"))
        await s.execute(text("DELETE FROM document_chunks"))
        await s.execute(text(f"ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector({int(dim)})"))
        await s.execute(text("CREATE INDEX ix_chunks_embedding_hnsw ON document_chunks USING hnsw "
                             "(embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"))
        await s.execute(update(Document).values(chunk_count=0))
    n = await _queue_all("reindex")
    await dispose_engine()
    print(f"Embedding column resized to {dim} dimensions; {n} documents queued for re-indexing "
          "(processed by the running API/worker).")


async def reindex_all() -> None:
    from app.database.session import dispose_engine

    n = await _queue_all("reindex")
    await dispose_engine()
    print(f"{n} documents queued for re-indexing.")


async def check() -> None:
    from app.core.config import get_settings
    from app.database.session import dispose_engine, get_engine

    s = get_settings()
    async with get_engine().connect() as conn:
        print("database:", await conn.scalar(text("SELECT version()")))
        print("pgvector:", await conn.scalar(text("SELECT extversion FROM pg_extension WHERE extname='vector'")))
        dim = await conn.scalar(text("SELECT atttypmod FROM pg_attribute WHERE attrelid='document_chunks'::regclass "
                                     "AND attname='embedding'"))
        print(f"embedding column dimension: {dim} (EMBEDDING_DIMENSIONS={s.embedding_dimensions})"
              + ("" if dim == s.embedding_dimensions else "  ← MISMATCH: run `python -m app.cli reset-embeddings`"))
    await dispose_engine()
    print("llm configured:", s.llm_configured, f"(model {s.llm_model})")
    print("embeddings:", s.embedding_provider, s.embedding_model)
    print("langsmith tracing:", s.langsmith_enabled, f"(project {s.langsmith_project})")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create-user")
    p.add_argument("--email", required=True)
    p.add_argument("--password")
    p.add_argument("--name", default="")
    p.add_argument("--role", choices=["admin", "manager", "user"], default="user")
    p.add_argument("--admin", action="store_true", help="shortcut for --role admin")
    sub.add_parser("reset-embeddings")
    sub.add_parser("reindex-all")
    sub.add_parser("check")
    args = parser.parse_args()
    if args.cmd == "create-user":
        password = args.password or getpass.getpass("Password: ")
        if len(password) < 8:
            raise SystemExit("Password must be at least 8 characters.")
        asyncio.run(create_user(args.email, password, args.name, "admin" if args.admin else args.role))
    elif args.cmd == "reset-embeddings":
        asyncio.run(reset_embeddings())
    elif args.cmd == "reindex-all":
        asyncio.run(reindex_all())
    else:
        asyncio.run(check())


if __name__ == "__main__":
    main()
