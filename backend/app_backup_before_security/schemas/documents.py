from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)


class CollectionOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    document_count: int = 0
    created_at: datetime


class JobOut(ORMModel):
    id: uuid.UUID
    job_type: str
    status: str
    stage: str
    progress: int
    attempts: int
    max_attempts: int
    last_error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    stats: dict = {}


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    title: str
    file_ext: str
    mime_type: str
    size_bytes: int
    sha256: str
    status: str  # uploaded | processing | indexed | failed | updating
    current_version: int
    page_count: int | None
    chunk_count: int
    error_message: str | None
    collection_id: uuid.UUID | None
    collection_name: str | None = None
    metadata: dict = {}
    created_at: datetime
    updated_at: datetime
    indexed_at: datetime | None
    job: JobOut | None = None


class DocumentVersionOut(ORMModel):
    version: int
    sha256: str
    size_bytes: int
    original_filename: str
    created_at: datetime


class DocumentDetail(DocumentOut):
    versions: list[DocumentVersionOut] = []


class DuplicateInfo(BaseModel):
    filename: str
    existing_document_id: uuid.UUID
    existing_title: str


class RejectedFile(BaseModel):
    filename: str
    reason: str


class UploadResult(BaseModel):
    uploaded: list[DocumentOut] = []
    duplicates: list[DuplicateInfo] = []
    rejected: list[RejectedFile] = []


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    collection_id: uuid.UUID | None = None
    clear_collection: bool = False


class ChunkOut(ORMModel):
    id: uuid.UUID
    chunk_index: int
    chunk_type: str
    content: str
    section_title: str | None
    page_number: int | None
    page_end: int | None
    token_count: int
    document_version: int


class ChunkPage(BaseModel):
    total: int
    items: list[ChunkOut]
