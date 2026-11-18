"""Local filesystem storage for original uploads (swap for S3/GCS by implementing the same interface)."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import NotFoundError


class LocalStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or get_settings().storage_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, workspace_id: uuid.UUID, document_id: uuid.UUID, version: int, filename: str, data: bytes) -> str:
        rel = Path(str(workspace_id)) / str(document_id) / f"v{version}" / filename
        target = self.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return rel.as_posix()

    def path(self, rel: str) -> Path:
        target = (self.root / rel).resolve()
        if self.root not in target.parents:
            raise NotFoundError("File not found.")
        if not target.exists():
            raise NotFoundError("The original file is no longer available.")
        return target

    def delete_document(self, workspace_id: uuid.UUID, document_id: uuid.UUID) -> None:
        folder = (self.root / str(workspace_id) / str(document_id)).resolve()
        if self.root in folder.parents and folder.exists():
            shutil.rmtree(folder, ignore_errors=True)


def get_storage() -> LocalStorage:
    return LocalStorage()
