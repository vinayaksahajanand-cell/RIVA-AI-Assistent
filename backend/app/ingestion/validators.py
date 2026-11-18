"""Upload validation: extension allow-list, size limits, magic-byte sniffing, fingerprinting."""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.errors import ValidationFailed

MIME_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".html": "text/html",
    ".htm": "text/html",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
SUPPORTED_EXTENSIONS = sorted(MIME_TYPES)
_TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".html", ".htm"}
_OOXML_PARTS = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}
_OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


@dataclass(frozen=True)
class ValidatedFile:
    filename: str
    ext: str
    mime_type: str
    size_bytes: int
    sha256: str


def sanitize_filename(name: str) -> str:
    name = unicodedata.normalize("NFKC", name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f<>:\"|?*]", "_", name).strip(" .")
    return name[:200] or "document"


def file_extension(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _looks_like_text(data: bytes) -> bool:
    sample = data[:8192]
    if b"\x00" in sample and not (sample.startswith(b"\xff\xfe") or sample.startswith(b"\xfe\xff")):
        return False
    return True


def validate_upload(filename: str, data: bytes) -> ValidatedFile:
    settings = get_settings()
    safe_name = sanitize_filename(filename)
    ext = file_extension(safe_name)
    if ext not in MIME_TYPES:
        raise ValidationFailed(f"Unsupported file type '{ext or 'none'}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")
    size = len(data)
    if size == 0:
        raise ValidationFailed("The file is empty.")
    if size > settings.max_upload_bytes:
        raise ValidationFailed(f"File exceeds the {settings.max_upload_mb} MB upload limit.")

    if ext == ".pdf":
        if b"%PDF-" not in data[:1024]:
            raise ValidationFailed("File content is not a valid PDF.")
    elif ext in _OOXML_PARTS:
        if not data.startswith(b"PK"):
            raise ValidationFailed(f"File content is not a valid {ext} (Office Open XML) document.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()
                if "[Content_Types].xml" not in names or not any(n.startswith(_OOXML_PARTS[ext]) for n in names):
                    raise ValidationFailed(f"File content does not match the {ext} format.")
                total_uncompressed = sum(i.file_size for i in zf.infolist())
                if total_uncompressed > settings.max_upload_bytes * 20:  # zip-bomb guard
                    raise ValidationFailed("Archive expands to an unsafe size.")
        except zipfile.BadZipFile as exc:
            raise ValidationFailed(f"File content is not a valid {ext} document.") from exc
    elif ext == ".doc":
        if not data.startswith(_OLE_MAGIC):
            raise ValidationFailed("File content is not a valid legacy Word (.doc) document.")
    elif ext in _TEXT_EXTS:
        if not _looks_like_text(data):
            raise ValidationFailed("File appears to be binary, not text.")

    return ValidatedFile(filename=safe_name, ext=ext, mime_type=MIME_TYPES[ext], size_bytes=size,
                         sha256=sha256_bytes(data))
