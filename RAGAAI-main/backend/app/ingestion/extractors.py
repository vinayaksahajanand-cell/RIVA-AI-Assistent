"""Format-specific extraction into a common block structure.

Every extractor returns an :class:`ExtractedDocument` – an ordered list of blocks
(text / heading / table) annotated with page numbers – so chunking can preserve
document structure and citations can point at real pages.
"""

from __future__ import annotations

import csv
import io
import re
import shutil
import statistics
import struct
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from charset_normalizer import from_bytes

from app.core.config import get_settings
from app.core.logging import get_logger
from app.ingestion.cleaning import normalize_text, reflow_paragraphs, remove_repeated_headers_footers

log = get_logger(__name__)


@dataclass
class Block:
    text: str
    page: int | None = None
    kind: str = "text"  # text | heading | table
    level: int = 0  # heading level (1 = top)


@dataclass
class ExtractedDocument:
    blocks: list[Block]
    page_count: int | None = None
    title: str | None = None
    metadata: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def text_length(self) -> int:
        return sum(len(b.text) for b in self.blocks)


class ExtractionError(Exception):
    pass


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def decode_text(data: bytes) -> str:
    for bom, enc in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
        if data.startswith(bom):
            return data.decode(enc, errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        best = from_bytes(data).best()
        return str(best) if best is not None else data.decode("latin-1", errors="replace")


def rows_to_markdown(rows: list[list[str | None]]) -> str:
    clean = [[re.sub(r"\s+", " ", str(c or "")).strip() for c in row] for row in rows if row]
    clean = [r for r in clean if any(r)]
    if not clean:
        return ""
    width = max(len(r) for r in clean)
    clean = [r + [""] * (width - len(r)) for r in clean]
    header, body = clean[0], clean[1:]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(lines)


def rows_to_records(header: list[str], rows: list[list[str]], start_row: int) -> str:
    """Render rows as 'Header: value' records — far more retrievable than raw CSV lines."""
    out = []
    for offset, row in enumerate(rows):
        pairs = [f"{h or f'col{j + 1}'}: {v}" for j, (h, v) in enumerate(zip(header, row, strict=False))
                 if str(v).strip()]
        if pairs:
            out.append(f"Row {start_row + offset}: " + "; ".join(pairs))
    return "\n".join(out)


def tabular_blocks(header: list[str], rows: list[list[str]], page: int | None, rows_per_block: int = 25) -> list[Block]:
    blocks = []
    for i in range(0, len(rows), rows_per_block):
        text = rows_to_records(header, rows[i:i + rows_per_block], start_row=i + 2)
        if text:
            blocks.append(Block(text=text, page=page, kind="table"))
    return blocks


# ──────────────────────────────────────────────────────────────────────────────
# PDF
# ──────────────────────────────────────────────────────────────────────────────

def extract_pdf(path: Path) -> ExtractedDocument:
    import pdfplumber

    settings = get_settings()
    warnings: list[str] = []
    pages_lines: list[list[tuple[str, float]]] = []
    pages_tables: list[list[str]] = []
    ocr_pages: dict[int, str] = {}
    all_sizes: list[float] = []

    with pdfplumber.open(str(path)) as pdf:
        meta = {k: str(v) for k, v in (pdf.metadata or {}).items() if isinstance(v, (str, int, float))}
        page_count = len(pdf.pages)
        for index, page in enumerate(pdf.pages):
            try:
                tables = page.find_tables()
            except Exception:
                tables = []
            bboxes = [t.bbox for t in tables]

            def outside_tables(obj, _bboxes=bboxes):
                if obj.get("object_type") != "char" or not _bboxes:
                    return True
                cx = (obj["x0"] + obj["x1"]) / 2
                cy = (obj["top"] + obj["bottom"]) / 2
                return not any(x0 <= cx <= x1 and top <= cy <= bottom for x0, top, x1, bottom in _bboxes)

            text_page = page.filter(outside_tables) if bboxes else page
            lines: list[tuple[str, float]] = []
            try:
                for line in text_page.extract_text_lines(x_tolerance=1.5, y_tolerance=3, return_chars=True):
                    sizes = [c.get("size", 0.0) for c in line.get("chars", []) if c.get("text", "").strip()]
                    size = max(sizes) if sizes else 0.0
                    if line.get("text", "").strip():
                        lines.append((line["text"], size))
                        all_sizes.extend(sizes)
            except Exception as exc:  # pragma: no cover - malformed page
                warnings.append(f"page {index + 1}: text extraction failed ({exc})")
            pages_lines.append(lines)

            md_tables = []
            for t in tables:
                try:
                    md = rows_to_markdown(t.extract())
                    if md:
                        md_tables.append(md)
                except Exception:
                    continue
            pages_tables.append(md_tables)

            char_count = sum(len(t) for t, _ in lines) + sum(len(t) for t in md_tables)
            if settings.ocr_enabled and char_count < settings.ocr_min_chars_per_page:
                try:
                    from app.ingestion.ocr import ocr_pdf_page

                    text, conf = ocr_pdf_page(str(path), index, settings.ocr_dpi)
                    if text.strip():
                        ocr_pages[index] = text
                        log.info("OCR page %d of %s (confidence %.2f)", index + 1, path.name, conf)
                except Exception as exc:
                    warnings.append(f"page {index + 1}: OCR failed ({exc})")

    body_size = statistics.median(all_sizes) if all_sizes else 0.0

    # Running header/footer removal operates on plain page text.
    page_texts = ["\n".join(t for t, _ in lines) for lines in pages_lines]
    cleaned_pages = remove_repeated_headers_footers(page_texts)

    blocks: list[Block] = []
    for index, lines in enumerate(pages_lines):
        page_no = index + 1
        if index in ocr_pages:
            blocks.append(Block(text=reflow_paragraphs(normalize_text(ocr_pages[index])), page=page_no))
            continue
        kept = set(cleaned_pages[index].split("\n"))
        buffer: list[str] = []

        def flush(_page=page_no, _buffer=buffer):
            if _buffer:
                text = reflow_paragraphs(normalize_text("\n".join(_buffer)))
                if text:
                    blocks.append(Block(text=text, page=_page))
                _buffer.clear()

        for text, size in lines:
            if text not in kept:
                continue
            stripped = text.strip()
            is_heading = (body_size > 0 and size >= body_size * 1.2 and 2 < len(stripped) <= 120
                          and not stripped.endswith((".", ",", ";")))
            if is_heading:
                flush()
                level = 1 if size >= body_size * 1.6 else 2
                blocks.append(Block(text=normalize_text(stripped), page=page_no, kind="heading", level=level))
            else:
                buffer.append(text)
        flush()
        for md in pages_tables[index]:
            blocks.append(Block(text=md, page=page_no, kind="table"))

    if ocr_pages:
        warnings.append(f"OCR applied to {len(ocr_pages)} page(s)")
    return ExtractedDocument(blocks=blocks, page_count=page_count, title=meta.get("Title") or None,
                             metadata={"pdf": meta, "ocr_pages": sorted(p + 1 for p in ocr_pages)},
                             warnings=warnings)


# ──────────────────────────────────────────────────────────────────────────────
# Word (.docx / .doc)
# ──────────────────────────────────────────────────────────────────────────────

def extract_docx(path: Path) -> ExtractedDocument:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(str(path))
    props = document.core_properties
    blocks: list[Block] = []
    page = 1
    w_ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

    for element in document.element.body.iterchildren():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "p":
            # Explicit and last-rendered page breaks give (approximate) page numbers.
            breaks = sum(1 for br in element.iter(f"{w_ns}br") if br.get(f"{w_ns}type") == "page")
            breaks += sum(1 for _ in element.iter(f"{w_ns}lastRenderedPageBreak"))
            para = Paragraph(element, document)
            text = normalize_text(para.text)
            style = (para.style.name if para.style is not None else "") or ""
            if text:
                if style.lower().startswith("heading") or style == "Title":
                    match = re.search(r"(\d+)", style)
                    level = int(match.group(1)) if match else 1
                    blocks.append(Block(text=text, page=page, kind="heading", level=level))
                elif style.lower().startswith("list"):
                    blocks.append(Block(text=f"- {text}", page=page))
                else:
                    blocks.append(Block(text=text, page=page))
            page += breaks
        elif tag == "tbl":
            table = Table(element, document)
            rows = [[cell.text for cell in row.cells] for row in table.rows]
            md = rows_to_markdown(rows)
            if md:
                blocks.append(Block(text=md, page=page, kind="table"))

    merged = _merge_text_blocks(blocks)
    return ExtractedDocument(blocks=merged, page_count=page if page > 1 else None, title=props.title or None,
                             metadata={"author": props.author or None, "page_numbers_estimated": True})


def _merge_text_blocks(blocks: list[Block]) -> list[Block]:
    """Merge consecutive paragraph blocks on the same page into one block (keeps headings/tables)."""
    merged: list[Block] = []
    for b in blocks:
        if merged and b.kind == "text" and merged[-1].kind == "text" and merged[-1].page == b.page:
            merged[-1].text = f"{merged[-1].text}\n\n{b.text}"
        else:
            merged.append(Block(text=b.text, page=b.page, kind=b.kind, level=b.level))
    return merged


def _doc_via_libreoffice(path: Path) -> ExtractedDocument | None:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        for candidate in (r"C:\Program Files\LibreOffice\program\soffice.exe",
                          r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"):
            if Path(candidate).exists():
                soffice = candidate
                break
    if not soffice:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([soffice, "--headless", "--convert-to", "docx", "--outdir", tmp, str(path)],
                       check=True, capture_output=True, timeout=120)
        converted = Path(tmp) / (path.stem + ".docx")
        if not converted.exists():
            return None
        doc = extract_docx(converted)
        doc.metadata["converted_with"] = "libreoffice"
        return doc


def _doc_piece_table_text(path: Path) -> str:
    """Extract the main text stream of a Word 97-2003 binary file via its piece table (MS-DOC spec)."""
    import olefile

    with olefile.OleFileIO(str(path)) as ole:
        word = ole.openstream("WordDocument").read()
        flags = struct.unpack_from("<H", word, 0x000A)[0]
        if flags & 0x0100:
            raise ExtractionError("Encrypted .doc files are not supported.")
        table_name = "1Table" if flags & 0x0200 else "0Table"
        if not ole.exists(table_name):
            raise ExtractionError("Corrupt .doc file: table stream missing.")
        table = ole.openstream(table_name).read()

    ccp_text = struct.unpack_from("<i", word, 0x004C)[0]
    fc_clx, lcb_clx = struct.unpack_from("<II", word, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    pos = 0
    while pos < len(clx) and clx[pos] == 0x01:  # skip Prc (property modifiers)
        cb = struct.unpack_from("<H", clx, pos + 1)[0]
        pos += 3 + cb
    if pos >= len(clx) or clx[pos] != 0x02:
        raise ExtractionError("Corrupt .doc file: piece table not found.")
    lcb = struct.unpack_from("<I", clx, pos + 1)[0]
    plc = clx[pos + 5:pos + 5 + lcb]
    n = (lcb - 4) // 12
    cps = struct.unpack_from(f"<{n + 1}i", plc, 0)
    parts: list[str] = []
    for i in range(n):
        start_cp, end_cp = cps[i], cps[i + 1]
        if start_cp >= ccp_text:
            break
        end_cp = min(end_cp, ccp_text)
        fc = struct.unpack_from("<I", plc, (n + 1) * 4 + i * 8 + 2)[0]
        count = end_cp - start_cp
        if fc & 0x40000000:
            offset = (fc & 0xBFFFFFFF) // 2
            parts.append(word[offset:offset + count].decode("cp1252", errors="replace"))
        else:
            parts.append(word[fc:fc + 2 * count].decode("utf-16-le", errors="replace"))
    text = "".join(parts)
    text = re.sub(r"\x13[^\x14\x15]*\x14?", "", text)  # field instructions
    text = text.replace("\x15", "").replace("\x07", "\t").replace("\x0c", "\n\n").replace("\r", "\n")
    return text


def extract_doc(path: Path) -> ExtractedDocument:
    try:
        converted = _doc_via_libreoffice(path)
        if converted is not None:
            return converted
    except Exception as exc:
        log.warning("LibreOffice conversion failed for %s: %s", path.name, exc)
    text = normalize_text(_doc_piece_table_text(path))
    if not text:
        raise ExtractionError("No text could be extracted from the .doc file.")
    return extract_plaintext_blocks(text, metadata={"extraction": "doc_piece_table"},
                                    warnings=["Legacy .doc extracted without layout; headings and tables "
                                              "are not preserved. Install LibreOffice for higher fidelity."])


# ──────────────────────────────────────────────────────────────────────────────
# Plain text / Markdown
# ──────────────────────────────────────────────────────────────────────────────

def extract_plaintext_blocks(text: str, metadata: dict | None = None, warnings: list[str] | None = None,
                             page: int | None = None) -> ExtractedDocument:
    blocks = [Block(text=p.strip(), page=page) for p in normalize_text(text).split("\n\n") if p.strip()]
    return ExtractedDocument(blocks=_merge_text_blocks(blocks), metadata=metadata or {}, warnings=warnings or [])


def extract_txt(path: Path) -> ExtractedDocument:
    return extract_plaintext_blocks(decode_text(path.read_bytes()))


_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def extract_markdown(path: Path) -> ExtractedDocument:
    text = decode_text(path.read_bytes()).replace("\r\n", "\n")
    blocks: list[Block] = []
    buffer: list[str] = []
    in_fence = False
    title = None

    def flush() -> None:
        content = "\n".join(buffer).strip()
        if content:
            blocks.append(Block(text=normalize_text(content) if not in_fence else content))
        buffer.clear()

    for line in text.split("\n"):
        if line.strip().startswith(("```", "~~~")):
            in_fence = not in_fence
            buffer.append(line)
            continue
        match = None if in_fence else _MD_HEADING.match(line)
        if match:
            flush()
            heading = match.group(2).strip()
            level = len(match.group(1))
            title = title or (heading if level == 1 else None)
            blocks.append(Block(text=heading, kind="heading", level=level))
        else:
            buffer.append(line)
    flush()
    return ExtractedDocument(blocks=blocks, title=title)


# ──────────────────────────────────────────────────────────────────────────────
# Spreadsheets
# ──────────────────────────────────────────────────────────────────────────────

def extract_csv(path: Path) -> ExtractedDocument:
    text = decode_text(path.read_bytes())
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if not rows:
        raise ExtractionError("The CSV file contains no rows.")
    header = [h.strip() for h in rows[0]]
    blocks = [Block(text=f"Columns: {', '.join(h for h in header if h)}", kind="text")]
    blocks += tabular_blocks(header, [[c.strip() for c in r] for r in rows[1:]], page=None)
    return ExtractedDocument(blocks=blocks, metadata={"rows": len(rows) - 1, "columns": header})


def extract_xlsx(path: Path) -> ExtractedDocument:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    blocks: list[Block] = []
    sheets_meta = []
    try:
        for sheet_index, ws in enumerate(wb.worksheets, start=1):
            rows = []
            for row in ws.iter_rows(values_only=True):
                values = ["" if v is None else str(v) for v in row]
                if any(v.strip() for v in values):
                    rows.append(values)
            sheets_meta.append({"name": ws.title, "rows": max(0, len(rows) - 1)})
            if not rows:
                continue
            header = [h.strip() for h in rows[0]]
            blocks.append(Block(text=f"Sheet: {ws.title}", page=sheet_index, kind="heading", level=1))
            blocks.append(Block(text=f"Columns: {', '.join(h for h in header if h)}", page=sheet_index))
            blocks += tabular_blocks(header, rows[1:], page=sheet_index)
    finally:
        wb.close()
    return ExtractedDocument(blocks=blocks, page_count=len(sheets_meta),
                             metadata={"sheets": sheets_meta, "page_numbers_are_sheets": True})


# ──────────────────────────────────────────────────────────────────────────────
# HTML
# ──────────────────────────────────────────────────────────────────────────────

def extract_html(path: Path) -> ExtractedDocument:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(decode_text(path.read_bytes()), "lxml")
    title = soup.title.get_text(strip=True) if soup.title else None
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "svg", "form", "iframe"]):
        tag.decompose()
    root = soup.body or soup
    blocks: list[Block] = []
    for el in root.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre", "table", "blockquote", "dd", "dt"]):
        if el.find_parent(["table"]) and el.name != "table":
            continue
        if el.name != "li" and el.find_parent(["li"]):
            continue
        if el.name == "table":
            rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])] for tr in el.find_all("tr")]
            md = rows_to_markdown(rows)
            if md:
                blocks.append(Block(text=md, kind="table"))
        elif el.name.startswith("h"):
            text = el.get_text(" ", strip=True)
            if text:
                blocks.append(Block(text=text, kind="heading", level=int(el.name[1])))
        else:
            text = el.get_text(" ", strip=True) if el.name != "pre" else el.get_text()
            if text.strip():
                blocks.append(Block(text=f"- {text}" if el.name == "li" else normalize_text(text)))
    if not blocks:
        return extract_plaintext_blocks(root.get_text("\n"))
    return ExtractedDocument(blocks=_merge_text_blocks(blocks), title=title)


# ──────────────────────────────────────────────────────────────────────────────
# PowerPoint
# ──────────────────────────────────────────────────────────────────────────────

def extract_pptx(path: Path) -> ExtractedDocument:
    from pptx import Presentation

    prs = Presentation(str(path))
    blocks: list[Block] = []
    for number, slide in enumerate(prs.slides, start=1):
        title_shape = slide.shapes.title
        title = normalize_text(title_shape.text_frame.text) if title_shape is not None and title_shape.has_text_frame else ""
        blocks.append(Block(text=f"Slide {number}: {title}" if title else f"Slide {number}", page=number,
                            kind="heading", level=1))
        texts = []
        for shape in slide.shapes:
            if title_shape is not None and shape.shape_id == title_shape.shape_id:
                continue
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = "".join(run.text for run in para.runs).strip()
                    if line:
                        texts.append(("  " * para.level) + f"- {line}" if para.level else line)
            if getattr(shape, "has_table", False) and shape.has_table:
                rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
                md = rows_to_markdown(rows)
                if md:
                    blocks.append(Block(text=md, page=number, kind="table"))
        if texts:
            blocks.append(Block(text=normalize_text("\n".join(texts)), page=number))
        if slide.has_notes_slide:
            notes = normalize_text(slide.notes_slide.notes_text_frame.text or "")
            if notes:
                blocks.append(Block(text=f"Speaker notes: {notes}", page=number))
    title = prs.core_properties.title or None
    return ExtractedDocument(blocks=blocks, page_count=len(prs.slides), title=title,
                             metadata={"page_numbers_are_slides": True})


# ──────────────────────────────────────────────────────────────────────────────

EXTRACTORS = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".doc": extract_doc,
    ".txt": extract_txt,
    ".md": extract_markdown,
    ".markdown": extract_markdown,
    ".csv": extract_csv,
    ".xlsx": extract_xlsx,
    ".html": extract_html,
    ".htm": extract_html,
    ".pptx": extract_pptx,
}


def extract(path: Path, ext: str) -> ExtractedDocument:
    extractor = EXTRACTORS.get(ext)
    if extractor is None:
        raise ExtractionError(f"No extractor for '{ext}'.")
    try:
        doc = extractor(path)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(f"Could not read the {ext} file: {exc.__class__.__name__}: {exc}") from exc
    doc.blocks = [b for b in doc.blocks if b.text.strip()]
    if not any(b.kind != "heading" for b in doc.blocks):
        hint = " The PDF may be scanned; enable OCR (OCR_ENABLED=true)." if ext == ".pdf" else ""
        raise ExtractionError("No extractable text was found in the document." + hint)
    return doc
