from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context, require_permission, require_writer, upload_rate_limit
from app.core.rbac import Permission
from app.database.session import get_db
from app.schemas.common import OkResponse
from app.schemas.documents import (
    ChunkPage,
    CollectionCreate,
    CollectionOut,
    DocumentDetail,
    DocumentOut,
    DocumentUpdate,
    UploadResult,
)
from app.services import document_service as svc

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/collections", response_model=list[CollectionOut])
async def list_collections(ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    return await svc.list_collections(db, ctx)


@router.post("/collections", response_model=CollectionOut, status_code=201)
async def create_collection(body: CollectionCreate, ctx: AuthContext = Depends(require_writer),
                            db: AsyncSession = Depends(get_db)):
    return await svc.create_collection(db, ctx, body.name, body.description)


@router.delete("/collections/{collection_id}", response_model=OkResponse)
async def delete_collection(collection_id: uuid.UUID, ctx: AuthContext = Depends(require_writer),
                            db: AsyncSession = Depends(get_db)):
    await svc.delete_collection(db, ctx, collection_id)
    return OkResponse()


@router.post("/documents/upload", response_model=UploadResult, status_code=201)
async def upload_documents(files: list[UploadFile] = File(...), collection_id: uuid.UUID | None = Form(default=None),
                           classification: str | None = Form(default=None,
                                                             pattern="^(public|internal|confidential|restricted)$"),
                           ctx: AuthContext = Depends(require_writer), _rl: None = Depends(upload_rate_limit),
                           db: AsyncSession = Depends(get_db)):
    return await svc.upload_documents(db, ctx, files, collection_id, classification)


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(q: str | None = Query(default=None, max_length=200),
                         status: str | None = Query(default=None, pattern="^(uploaded|processing|indexed|failed|updating)$"),
                         collection_id: uuid.UUID | None = None,
                         ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    return await svc.list_documents(db, ctx, q, status, collection_id)


@router.get("/documents/{document_id}", response_model=DocumentDetail)
async def get_document(document_id: uuid.UUID,
                       ctx: AuthContext = Depends(require_permission(Permission.DOCUMENTS_READ_CONTENT)),
                       db: AsyncSession = Depends(get_db)):
    return await svc.get_document_detail(db, ctx, document_id)


@router.patch("/documents/{document_id}", response_model=DocumentOut)
async def update_document(document_id: uuid.UUID, body: DocumentUpdate, ctx: AuthContext = Depends(require_writer),
                          db: AsyncSession = Depends(get_db)):
    return await svc.update_document(db, ctx, document_id, body)


@router.delete("/documents/{document_id}", response_model=OkResponse)
async def delete_document(document_id: uuid.UUID, ctx: AuthContext = Depends(require_writer),
                          db: AsyncSession = Depends(get_db)):
    await svc.delete_document(db, ctx, document_id)
    return OkResponse()


@router.post("/documents/{document_id}/reindex", response_model=DocumentOut)
async def reindex_document(document_id: uuid.UUID, ctx: AuthContext = Depends(require_writer),
                           db: AsyncSession = Depends(get_db)):
    return await svc.reindex_document(db, ctx, document_id)


@router.post("/documents/{document_id}/versions", response_model=DocumentOut, status_code=201)
async def upload_version(document_id: uuid.UUID, file: UploadFile = File(...),
                         ctx: AuthContext = Depends(require_writer), _rl: None = Depends(upload_rate_limit),
                         db: AsyncSession = Depends(get_db)):
    return await svc.upload_new_version(db, ctx, document_id, file)


@router.get("/documents/{document_id}/chunks", response_model=ChunkPage)
async def document_chunks(document_id: uuid.UUID, offset: int = Query(default=0, ge=0),
                          limit: int = Query(default=20, ge=1, le=100), q: str | None = Query(default=None, max_length=200),
                          ctx: AuthContext = Depends(require_permission(Permission.DOCUMENTS_READ_CONTENT)),
                          db: AsyncSession = Depends(get_db)):
    return await svc.list_chunks(db, ctx, document_id, offset, limit, q)


@router.get("/documents/{document_id}/file")
async def document_file(document_id: uuid.UUID,
                        ctx: AuthContext = Depends(require_permission(Permission.DOCUMENTS_DOWNLOAD)),
                        db: AsyncSession = Depends(get_db)):
    doc, path = await svc.current_file_path(db, ctx, document_id)
    inline = doc.file_ext in (".pdf", ".txt", ".md")
    return FileResponse(path, media_type=doc.mime_type, filename=doc.filename,
                        content_disposition_type="inline" if inline else "attachment",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"})
