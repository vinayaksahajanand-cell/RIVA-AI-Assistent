"""Ingestion pipeline:

Upload → validation → extraction (+OCR) → cleaning → metadata enrichment → chunking → embedding → indexing.

Re-indexing builds the complete new index first and swaps it in a single transaction, so the
previous version stays searchable until the new one is ready (zero-downtime re-index).
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, insert, select, update

from app.chunking.strategies import ChunkDraft, chunk_blocks
from app.core.logging import get_logger
from app.database.session import session_scope
from app.embeddings.provider import embed_texts, embedding_model_id, get_embeddings
from app.ingestion.cleaning import detect_prompt_injection
from app.ingestion.extractors import extract
from app.models import Document, DocumentChunk, DocumentVersion, IngestionJob, Workspace
from app.schemas.settings import WorkspaceSettings
from app.services.storage import get_storage

log = get_logger(__name__)


async def _progress(job_id: uuid.UUID, stage: str, progress: int) -> None:
    async with session_scope() as s:
        await s.execute(update(IngestionJob).where(IngestionJob.id == job_id).values(stage=stage, progress=progress))


_GENERIC_TITLE = re.compile(
    r"^\s*(untitled|document\d*|doc\d*|title|presentation\d*|book\d*|sheet\d*|slide\d*|"
    r"microsoft (word|powerpoint|excel) - .*|.*\.(docx?|pdf|pptx?|xlsx?))\s*$", re.IGNORECASE)


def is_meaningful_title(title: str) -> bool:
    """Embedded metadata titles are often generator placeholders ('untitled', 'Microsoft Word - x.docx')."""
    title = title.strip()
    return len(title) >= 3 and not _GENERIC_TITLE.match(title)


def embedding_input(title: str, chunk: ChunkDraft) -> str:
    """Contextual chunk header: document + section titles improve dense retrieval of short chunks."""
    header = f"Document: {title}"
    if chunk.section_title:
        header += f"\nSection: {chunk.section_title}"
    return f"{header}\n\n{chunk.content}"


async def run_ingestion(job_id: uuid.UUID) -> dict:
    """Process one ingestion job end-to-end. Raises on failure (the worker handles retries)."""
    t_start = time.perf_counter()
    async with session_scope() as s:
        job = await s.get(IngestionJob, job_id)
        if job is None:
            raise RuntimeError("job vanished")
        doc = await s.get(Document, job.document_id)
        if doc is None:
            raise RuntimeError("document deleted")
        version = (await s.execute(select(DocumentVersion).where(
            DocumentVersion.document_id == doc.id, DocumentVersion.version == doc.current_version))).scalar_one()
        workspace = await s.get(Workspace, doc.workspace_id)
        settings = WorkspaceSettings.from_stored(workspace.settings if workspace else {})
        doc.status = "updating" if doc.chunk_count else "processing"
        doc.error_message = None
        doc_id, ws_id, ext, title_hint = doc.id, doc.workspace_id, doc.file_ext, doc.title
        version_no, storage_path = version.version, version.storage_path

    timings: dict[str, float] = {}

    # 1) Extraction (CPU-bound → worker thread)
    await _progress(job_id, "extracting", 10)
    t0 = time.perf_counter()
    path = get_storage().path(storage_path)
    extracted = await asyncio.to_thread(extract, path, ext)
    timings["extraction_s"] = round(time.perf_counter() - t0, 3)

    # 2) Cleaning / metadata enrichment
   # 2) Cleaning / metadata enrichment
    await _progress(job_id, "enriching", 30),
    for block in extracted.blocks:
       block.text = "".join(
        char for char in block.text
        if char in "\t\n\r" or ord(char) >= 32
       )
    title = title_hint

    if extracted.title and title_hint == path.stem and is_meaningful_title(extracted.title):
        title = extracted.title.strip()[:500]

    # 3) Chunking
    await _progress(job_id, "chunking", 40)
    t0 = time.perf_counter()
    embeddings = get_embeddings() if settings.chunking.strategy == "semantic" else None
    drafts = await asyncio.to_thread(chunk_blocks, extracted.blocks, settings.chunking, embeddings)
    if not drafts:
        raise ValueError("The document produced no text chunks.")
    timings["chunking_s"] = round(time.perf_counter() - t0, 3)

    # 4) Embedding (batched, progress reported)
    await _progress(job_id, "embedding", 50)
    t0 = time.perf_counter()
    embed_idx = [i for i, d in enumerate(drafts) if d.chunk_type != "parent"]

    async def on_progress(done: int, total: int) -> None:
        await _progress(job_id, "embedding", 50 + int(40 * done / max(total, 1)))

    vectors = await embed_texts([embedding_input(title, drafts[i]) for i in embed_idx], progress=on_progress)
    vector_by_draft = dict(zip(embed_idx, vectors, strict=True))
    timings["embedding_s"] = round(time.perf_counter() - t0, 3)

    # 5) Indexing: atomic swap of the document's chunks
    await _progress(job_id, "indexing", 92)
    t0 = time.perf_counter()
    now = datetime.now(UTC)
    model_id = embedding_model_id()
    ids = [uuid.uuid4() for _ in drafts]
    injection_flags = 0
    rows = []
    for i, d in enumerate(drafts):
        flags = detect_prompt_injection(d.content)
        injection_flags += bool(flags)
        rows.append({
            "id": ids[i],
            "workspace_id": ws_id,
            "document_id": doc_id,
            "document_version": version_no,
            "chunk_index": i,
            "chunk_type": d.chunk_type,
            "parent_id": ids[d.parent_ref] if d.parent_ref is not None else None,
            "content": d.content,
            "section_title": (d.section_title or None) and d.section_title[:500],
            "page_number": d.page_number,
            "page_end": d.page_end,
            "token_count": d.token_count,
            "content_hash": d.content_hash,
            "chunk_metadata": {
                **d.metadata,
                "document_name": title,
                "source_type": ext.lstrip("."),
                "document_version": version_no,
                "ingestion_timestamp": now.isoformat(),
                **({"injection_suspected": True, "injection_patterns": flags} if flags else {}),
            },
            "embedding": vector_by_draft.get(i),
            "embedding_model": model_id if i in vector_by_draft else None,
            "created_at": now,
        })

    async with session_scope() as s:
        await s.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
        parents = [r for r in rows if r["chunk_type"] == "parent"]
        others = [r for r in rows if r["chunk_type"] != "parent"]
        for group in (parents, others):  # parents first so child FKs resolve
            for start in range(0, len(group), 500):
                await s.execute(insert(DocumentChunk), group[start:start + 500])
        doc = await s.get(Document, doc_id)
        if doc is None:
            raise RuntimeError("document deleted during ingestion")
        doc.status = "indexed"
        doc.title = title
        doc.chunk_count = len([r for r in rows if r["chunk_type"] != "parent"])
        doc.page_count = extracted.page_count
        doc.indexed_at = now
        doc.error_message = None
        doc.doc_metadata = {
            **(doc.doc_metadata or {}),
            **extracted.metadata,
            "warnings": extracted.warnings,
            "chunking": settings.chunking.model_dump(),
            "embedding_model": model_id,
            "parent_chunks": len(parents),
            "injection_flagged_chunks": injection_flags,
            "characters": extracted.text_length,
        }
    timings["indexing_s"] = round(time.perf_counter() - t0, 3)
    timings["total_s"] = round(time.perf_counter() - t_start, 3)
    log.info("Indexed document %s: %d chunks in %.2fs", doc_id, len(rows), timings["total_s"])
    return {"chunks": len(rows), "parents": len(parents), "pages": extracted.page_count,
            "warnings": extracted.warnings, "timings": timings}
