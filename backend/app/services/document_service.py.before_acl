"""Document library operations, scoped to the caller's workspace (tenant isolation)."""

from __future__ import annotations

import uuid

from fastapi import UploadFile
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext
from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError, ValidationFailed
from app.ingestion.validators import validate_upload
from app.models import Document, DocumentChunk, DocumentCollection, DocumentVersion, IngestionJob
from app.schemas.documents import (
    ChunkOut,
    ChunkPage,
    CollectionOut,
    DocumentDetail,
    DocumentOut,
    DocumentUpdate,
    DocumentVersionOut,
    DuplicateInfo,
    JobOut,
    RejectedFile,
    UploadResult,
)
from app.services.storage import get_storage
from app.worker import wake_worker


async def _latest_jobs(db: AsyncSession, doc_ids: list[uuid.UUID]) -> dict[uuid.UUID, IngestionJob]:
    if not doc_ids:
        return {}
    sub = (select(IngestionJob.document_id, func.max(IngestionJob.created_at).label("latest"))
           .where(IngestionJob.document_id.in_(doc_ids)).group_by(IngestionJob.document_id).subquery())
    rows = (await db.execute(select(IngestionJob).join(
        sub, (IngestionJob.document_id == sub.c.document_id) & (IngestionJob.created_at == sub.c.latest)))).scalars()
    return {j.document_id: j for j in rows}


def to_out(doc: Document, job: IngestionJob | None = None, collection_name: str | None = None) -> DocumentOut:
    return DocumentOut(
        id=doc.id, filename=doc.filename, title=doc.title, file_ext=doc.file_ext, mime_type=doc.mime_type,
        size_bytes=doc.size_bytes, sha256=doc.sha256, status=doc.status, current_version=doc.current_version,
        page_count=doc.page_count, chunk_count=doc.chunk_count, error_message=doc.error_message,
        collection_id=doc.collection_id, collection_name=collection_name, metadata=doc.doc_metadata or {},
        created_at=doc.created_at, updated_at=doc.updated_at, indexed_at=doc.indexed_at,
        job=JobOut.model_validate(job) if job else None,
    )


async def get_owned_document(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID) -> Document:
    doc = await db.get(Document, document_id)
    if doc is None or doc.workspace_id != ctx.workspace_id:
        raise NotFoundError("Document not found.")
    return doc


async def _check_collection(db: AsyncSession, ctx: AuthContext, collection_id: uuid.UUID | None) -> None:
    if collection_id is None:
        return
    col = await db.get(DocumentCollection, collection_id)
    if col is None or col.workspace_id != ctx.workspace_id:
        raise NotFoundError("Collection not found.")


async def _find_duplicate(db: AsyncSession, ctx: AuthContext, sha: str) -> Document | None:
    return (await db.execute(
        select(Document).outerjoin(DocumentVersion, DocumentVersion.document_id == Document.id)
        .where(Document.workspace_id == ctx.workspace_id,
               or_(Document.sha256 == sha, DocumentVersion.sha256 == sha)).limit(1))).scalar_one_or_none()


async def _read_limited(file: UploadFile) -> bytes:
    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ValidationFailed(f"File exceeds the {get_settings().max_upload_mb} MB upload limit.")
    return data


def _queue_job(db: AsyncSession, doc: Document, job_type: str) -> IngestionJob:
    job = IngestionJob(workspace_id=doc.workspace_id, document_id=doc.id, job_type=job_type,
                       max_attempts=get_settings().job_max_attempts)
    db.add(job)
    return job


async def upload_documents(db: AsyncSession, ctx: AuthContext, files: list[UploadFile],
                           collection_id: uuid.UUID | None) -> UploadResult:
    settings = get_settings()
    if not files:
        raise ValidationFailed("No files were uploaded.")
    if len(files) > settings.max_files_per_upload:
        raise ValidationFailed(f"At most {settings.max_files_per_upload} files can be uploaded at once.")
    await _check_collection(db, ctx, collection_id)
    storage = get_storage()
    result = UploadResult()
    seen_in_batch: dict[str, str] = {}
    created: list[tuple[Document, IngestionJob]] = []
    for upload in files:
        name = upload.filename or "document"
        try:
            data = await _read_limited(upload)
            vf = validate_upload(name, data)
        except AppError as exc:
            result.rejected.append(RejectedFile(filename=name, reason=exc.message))
            continue
        if vf.sha256 in seen_in_batch:
            result.rejected.append(RejectedFile(filename=name, reason=f"Same content as '{seen_in_batch[vf.sha256]}' "
                                                                      "in this upload."))
            continue
        seen_in_batch[vf.sha256] = vf.filename
        existing = await _find_duplicate(db, ctx, vf.sha256)
        if existing is not None:
            result.duplicates.append(DuplicateInfo(filename=vf.filename, existing_document_id=existing.id,
                                                   existing_title=existing.title))
            continue
        doc = Document(workspace_id=ctx.workspace_id, collection_id=collection_id, uploaded_by=ctx.user_id,
                       filename=vf.filename, title=vf.filename.rsplit(".", 1)[0], file_ext=vf.ext,
                       mime_type=vf.mime_type, size_bytes=vf.size_bytes, sha256=vf.sha256, status="uploaded",
                       current_version=1, doc_metadata={})
        db.add(doc)
        await db.flush()
        path = storage.save(ctx.workspace_id, doc.id, 1, vf.filename, data)
        db.add(DocumentVersion(document_id=doc.id, version=1, sha256=vf.sha256, size_bytes=vf.size_bytes,
                               storage_path=path, original_filename=vf.filename, uploaded_by=ctx.user_id))
        created.append((doc, _queue_job(db, doc, "ingest")))
    await db.commit()
    for doc, job in created:
        await db.refresh(doc)
        await db.refresh(job)
        result.uploaded.append(to_out(doc, job))
    if created:
        wake_worker()
    return result


async def upload_new_version(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID, upload: UploadFile) -> DocumentOut:
    doc = await get_owned_document(db, ctx, document_id)
    data = await _read_limited(upload)
    vf = validate_upload(upload.filename or doc.filename, data)
    if vf.ext != doc.file_ext:
        raise ValidationFailed(f"A new version must have the same file type ({doc.file_ext}).")
    duplicate = await _find_duplicate(db, ctx, vf.sha256)
    if duplicate is not None:
        raise ConflictError("This exact file content already exists in your library.",
                            details={"existing_document_id": str(duplicate.id)})
    version = doc.current_version + 1
    path = get_storage().save(ctx.workspace_id, doc.id, version, vf.filename, data)
    db.add(DocumentVersion(document_id=doc.id, version=version, sha256=vf.sha256, size_bytes=vf.size_bytes,
                           storage_path=path, original_filename=vf.filename, uploaded_by=ctx.user_id))
    doc.current_version = version
    doc.sha256 = vf.sha256
    doc.size_bytes = vf.size_bytes
    doc.filename = vf.filename
    doc.status = "updating" if doc.chunk_count else "uploaded"
    job = _queue_job(db, doc, "reindex")
    await db.commit()
    await db.refresh(doc)
    await db.refresh(job)
    wake_worker()
    return to_out(doc, job)


async def reindex_document(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID) -> DocumentOut:
    doc = await get_owned_document(db, ctx, document_id)
    active = (await db.execute(select(IngestionJob.id).where(
        IngestionJob.document_id == doc.id, IngestionJob.status.in_(["queued", "running"])))).first()
    if active:
        raise ConflictError("This document is already being processed.")
    doc.status = "updating" if doc.chunk_count else "uploaded"
    doc.error_message = None
    job = _queue_job(db, doc, "reindex")
    await db.commit()
    await db.refresh(doc)
    await db.refresh(job)
    wake_worker()
    return to_out(doc, job)


async def list_documents(db: AsyncSession, ctx: AuthContext, q: str | None, status: str | None,
                         collection_id: uuid.UUID | None) -> list[DocumentOut]:
    stmt = (select(Document, DocumentCollection.name).outerjoin(
        DocumentCollection, DocumentCollection.id == Document.collection_id)
        .where(Document.workspace_id == ctx.workspace_id).order_by(Document.created_at.desc()))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Document.title.ilike(like), Document.filename.ilike(like)))
    if status:
        stmt = stmt.where(Document.status == status)
    if collection_id:
        stmt = stmt.where(Document.collection_id == collection_id)
    rows = (await db.execute(stmt)).all()
    jobs = await _latest_jobs(db, [d.id for d, _ in rows])
    return [to_out(d, jobs.get(d.id), cname) for d, cname in rows]


async def get_document_detail(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID) -> DocumentDetail:
    doc = await get_owned_document(db, ctx, document_id)
    jobs = await _latest_jobs(db, [doc.id])
    versions = (await db.execute(select(DocumentVersion).where(DocumentVersion.document_id == doc.id)
                                 .order_by(DocumentVersion.version.desc()))).scalars().all()
    cname = None
    if doc.collection_id:
        col = await db.get(DocumentCollection, doc.collection_id)
        cname = col.name if col else None
    base = to_out(doc, jobs.get(doc.id), cname)
    return DocumentDetail(**base.model_dump(), versions=[DocumentVersionOut.model_validate(v) for v in versions])


async def update_document(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID, body: DocumentUpdate) -> DocumentOut:
    doc = await get_owned_document(db, ctx, document_id)
    if body.title is not None:
        doc.title = body.title.strip()
    if body.clear_collection:
        doc.collection_id = None
    elif body.collection_id is not None:
        await _check_collection(db, ctx, body.collection_id)
        doc.collection_id = body.collection_id
    await db.commit()
    await db.refresh(doc)
    jobs = await _latest_jobs(db, [doc.id])
    return to_out(doc, jobs.get(doc.id))


async def delete_document(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID) -> None:
    doc = await get_owned_document(db, ctx, document_id)
    workspace_id, doc_id = doc.workspace_id, doc.id
    # Chunks, versions and jobs cascade at the database level.
    await db.execute(delete(Document).where(Document.id == doc_id, Document.workspace_id == ctx.workspace_id))
    await db.commit()
    get_storage().delete_document(workspace_id, doc_id)


async def list_chunks(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID, offset: int, limit: int,
                      q: str | None) -> ChunkPage:
    await get_owned_document(db, ctx, document_id)
    base = select(DocumentChunk).where(DocumentChunk.document_id == document_id,
                                       DocumentChunk.workspace_id == ctx.workspace_id,
                                       DocumentChunk.chunk_type != "parent")
    if q:
        base = base.where(DocumentChunk.content.ilike(f"%{q.strip()}%"))
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    rows = (await db.execute(base.order_by(DocumentChunk.chunk_index).offset(offset).limit(limit))).scalars().all()
    return ChunkPage(total=total or 0, items=[ChunkOut.model_validate(r) for r in rows])


async def current_file_path(db: AsyncSession, ctx: AuthContext, document_id: uuid.UUID):
    doc = await get_owned_document(db, ctx, document_id)
    version = (await db.execute(select(DocumentVersion).where(
        DocumentVersion.document_id == doc.id, DocumentVersion.version == doc.current_version))).scalar_one()
    return doc, get_storage().path(version.storage_path)


# ── Collections ─────────────────────────────────────────────────────────────

async def list_collections(db: AsyncSession, ctx: AuthContext) -> list[CollectionOut]:
    rows = (await db.execute(
        select(DocumentCollection, func.count(Document.id))
        .outerjoin(Document, Document.collection_id == DocumentCollection.id)
        .where(DocumentCollection.workspace_id == ctx.workspace_id)
        .group_by(DocumentCollection.id).order_by(DocumentCollection.name))).all()
    return [CollectionOut(id=c.id, name=c.name, description=c.description, document_count=n, created_at=c.created_at)
            for c, n in rows]


async def create_collection(db: AsyncSession, ctx: AuthContext, name: str, description: str) -> CollectionOut:
    exists = (await db.execute(select(DocumentCollection.id).where(
        DocumentCollection.workspace_id == ctx.workspace_id, DocumentCollection.name == name.strip()))).first()
    if exists:
        raise ConflictError("A collection with this name already exists.")
    col = DocumentCollection(workspace_id=ctx.workspace_id, name=name.strip(), description=description.strip())
    db.add(col)
    await db.commit()
    await db.refresh(col)
    return CollectionOut(id=col.id, name=col.name, description=col.description, document_count=0,
                         created_at=col.created_at)


async def delete_collection(db: AsyncSession, ctx: AuthContext, collection_id: uuid.UUID) -> None:
    col = await db.get(DocumentCollection, collection_id)
    if col is None or col.workspace_id != ctx.workspace_id:
        raise NotFoundError("Collection not found.")
    await db.delete(col)  # documents keep existing; their collection_id is set to NULL
    await db.commit()


async def resolve_scope(db: AsyncSession, ctx: AuthContext, document_ids: list[uuid.UUID] | None,
                        collection_id: uuid.UUID | None) -> tuple[list[uuid.UUID] | None, int]:
    """Validate a requested document scope. Returns (document_ids or None for 'all', indexed_count)."""
    stmt = select(Document.id).where(Document.workspace_id == ctx.workspace_id, Document.chunk_count > 0)
    if collection_id is not None:
        await _check_collection(db, ctx, collection_id)
        stmt = stmt.where(Document.collection_id == collection_id)
    if document_ids:
        stmt = stmt.where(Document.id.in_(document_ids))
    ids = [r[0] for r in (await db.execute(stmt)).all()]
    if document_ids:
        unknown = set(document_ids) - set(ids)
        owned_unknown = (await db.execute(select(Document.id).where(
            Document.id.in_(list(unknown)), Document.workspace_id == ctx.workspace_id))).all() if unknown else []
        if len(owned_unknown) != len(unknown):
            raise NotFoundError("One or more selected documents were not found.")
    if document_ids or collection_id is not None:
        return ids, len(ids)
    return None, len(ids)
