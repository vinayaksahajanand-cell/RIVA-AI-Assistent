from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.database.base import Base, Timestamped, UUIDPk, utcnow

EMBEDDING_DIM = get_settings().embedding_dimensions

DOCUMENT_STATUSES = ("uploaded", "processing", "indexed", "failed", "updating")


class DocumentCollection(UUIDPk, Timestamped, Base):
    __tablename__ = "document_collections"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_collection_workspace_name"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Document(UUIDPk, Timestamped, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("workspace_id", "sha256", name="uq_document_workspace_sha256"),
        Index("ix_documents_workspace_status", "workspace_id", "status"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False)
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_collections.id", ondelete="SET NULL"), index=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    file_ext: Mapped[str] = mapped_column(String(16), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)  # fingerprint of the current version
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="uploaded")
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    page_count: Mapped[int | None] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    doc_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    versions: Mapped[list[DocumentVersion]] = relationship(back_populates="document", cascade="all, delete-orphan",
                                                           order_by="DocumentVersion.version")


class DocumentVersion(UUIDPk, Timestamped, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version", name="uq_document_version"),)

    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"),
                                                   index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    document: Mapped[Document] = relationship(back_populates="versions")


class DocumentChunk(UUIDPk, Timestamped, Base):
    """A retrievable unit of text.

    ``chunk_type`` is ``standard`` (embedded + searchable), ``child`` (embedded + searchable,
    points at a parent) or ``parent`` (context only: not embedded, never matched directly).
    ``tsv`` and ``bm25_len`` are maintained by a database trigger (see migration 0001).
    """

    __tablename__ = "document_chunks"
    __table_args__ = (
        Index("ix_chunks_workspace_document", "workspace_id", "document_id"),
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
        Index("ix_chunks_embedding_hnsw", "embedding", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"),
                                                   nullable=False)
    document_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_type: Mapped[str] = mapped_column(String(16), nullable=False, default="standard")
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("document_chunks.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    section_title: Mapped[str | None] = mapped_column(String(512))
    page_number: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    chunk_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(String(128))
    tsv = mapped_column(TSVECTOR)
    bm25_len: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class IngestionJob(UUIDPk, Timestamped, Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (Index("ix_ingestion_jobs_status_next", "status", "next_run_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"),
                                                   nullable=False, index=True)
    job_type: Mapped[str] = mapped_column(String(20), nullable=False, default="ingest")  # ingest | reindex
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")  # queued|running|completed|failed
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    locked_by: Mapped[str | None] = mapped_column(String(100))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
