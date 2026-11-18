"""Configurable chunking strategies.

Strategies
----------
``recursive``     token-measured recursive character splitting over the whole document
``token``         fixed-size token windows (tiktoken)
``semantic``      embedding-similarity breakpoints (LangChain SemanticChunker) inside sections
``structure``     section-aware: never crosses headings, keeps tables intact, merges tiny sections
``parent_child``  large parent chunks for context + small child chunks for precise retrieval

All strategies preserve page ranges and section titles through an offset map, so every
chunk can be cited with real page numbers.
"""

from __future__ import annotations

import bisect
import hashlib
from dataclasses import dataclass, field
from functools import lru_cache

import tiktoken
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter, TokenTextSplitter

from app.core.logging import get_logger
from app.ingestion.extractors import Block
from app.schemas.settings import ChunkingSettings

log = get_logger(__name__)

ENCODING = "cl100k_base"
_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""]


@lru_cache
def _encoder():
    return tiktoken.get_encoding(ENCODING)


def count_tokens(text: str) -> int:
    return len(_encoder().encode(text, disallowed_special=()))


@dataclass
class ChunkDraft:
    content: str
    section_title: str | None
    page_number: int | None
    page_end: int | None
    chunk_type: str = "standard"  # standard | parent | child
    parent_ref: int | None = None  # index into the returned list for child → parent
    token_count: int = 0
    metadata: dict = field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(" ".join(self.content.lower().split()).encode()).hexdigest()


@dataclass
class _Segment:
    text: str
    page: int | None
    section: str | None
    kind: str


@dataclass
class _Section:
    title: str | None
    segments: list[_Segment]

    @property
    def tokens(self) -> int:
        return sum(count_tokens(s.text) for s in self.segments)


class _OffsetText:
    """Concatenated text with a lookup from character offset → (page, section)."""

    def __init__(self, segments: list[_Segment], joiner: str = "\n\n") -> None:
        self.starts: list[int] = []
        self.meta: list[tuple[int | None, str | None]] = []
        parts: list[str] = []
        pos = 0
        for seg in segments:
            if parts:
                parts.append(joiner)
                pos += len(joiner)
            self.starts.append(pos)
            self.meta.append((seg.page, seg.section))
            parts.append(seg.text)
            pos += len(seg.text)
        self.text = "".join(parts)

    def at(self, offset: int) -> tuple[int | None, str | None]:
        if not self.starts:
            return None, None
        i = max(0, bisect.bisect_right(self.starts, offset) - 1)
        return self.meta[i]

    def page_range(self, start: int, end: int) -> tuple[int | None, int | None]:
        i0 = max(0, bisect.bisect_right(self.starts, start) - 1)
        i1 = max(0, bisect.bisect_right(self.starts, max(start, end - 1)) - 1)
        pages = [p for p, _ in self.meta[i0:i1 + 1] if p is not None]
        return (min(pages), max(pages)) if pages else (None, None)


def _recursive_splitter(size: int, overlap: int) -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name=ENCODING, chunk_size=size, chunk_overlap=overlap, separators=_SEPARATORS,
        add_start_index=True, disallowed_special=(),
    )


def _build_sections(blocks: list[Block]) -> list[_Section]:
    sections: list[_Section] = []
    stack: list[tuple[int, str]] = []
    current = _Section(title=None, segments=[])
    for block in blocks:
        if block.kind == "heading":
            if current.segments:
                sections.append(current)
            level = max(1, block.level or 1)
            stack = [(lvl, t) for lvl, t in stack if lvl < level] + [(level, block.text.strip())]
            title = " › ".join(t for _, t in stack)[:500]
            current = _Section(title=title, segments=[])
        else:
            current.segments.append(_Segment(text=block.text, page=block.page, section=current.title, kind=block.kind))
    if current.segments:
        sections.append(current)
    return sections


def _split_offset_text(ot: _OffsetText, splitter, chunk_type: str = "standard",
                       fixed_section: str | None = None) -> list[ChunkDraft]:
    drafts: list[ChunkDraft] = []
    if not ot.text.strip():
        return drafts
    for doc in splitter.create_documents([ot.text]):
        content = doc.page_content.strip()
        if not content:
            continue
        start = doc.metadata.get("start_index", -1)
        if start is None or start < 0:
            start = max(0, ot.text.find(content[:50]))
        page_start, page_end = ot.page_range(start, start + len(doc.page_content))
        _, section = ot.at(start)
        drafts.append(ChunkDraft(content=content, section_title=fixed_section or section,
                                 page_number=page_start, page_end=page_end, chunk_type=chunk_type,
                                 token_count=count_tokens(content)))
    return drafts


def _split_table(seg: _Segment, size: int, section: str | None) -> list[ChunkDraft]:
    """Keep tables whole when they fit; otherwise split by rows and repeat the header row(s)."""
    tokens = count_tokens(seg.text)
    meta = {"content_type": "table"}
    if tokens <= size:
        return [ChunkDraft(content=seg.text, section_title=section, page_number=seg.page, page_end=seg.page,
                           token_count=tokens, metadata=meta)]
    lines = seg.text.split("\n")
    header = lines[:2] if len(lines) > 2 and set(lines[1].replace("|", "").strip()) <= {"-", " ", ":"} else []
    body = lines[len(header):]
    drafts, current, current_tokens = [], list(header), count_tokens("\n".join(header))
    for line in body:
        line_tokens = count_tokens(line) + 1
        if current_tokens + line_tokens > size and len(current) > len(header):
            text = "\n".join(current)
            drafts.append(ChunkDraft(content=text, section_title=section, page_number=seg.page, page_end=seg.page,
                                     token_count=count_tokens(text), metadata=dict(meta)))
            current, current_tokens = list(header), count_tokens("\n".join(header))
        current.append(line)
        current_tokens += line_tokens
    if len(current) > len(header):
        text = "\n".join(current)
        drafts.append(ChunkDraft(content=text, section_title=section, page_number=seg.page, page_end=seg.page,
                                 token_count=count_tokens(text), metadata=dict(meta)))
    return drafts


def _common_title(a: str | None, b: str | None) -> str | None:
    """Deepest shared heading path of two sections, so merged chunks are not mislabeled."""
    if not a or not b:
        return a or b
    pa, pb = a.split(" › "), b.split(" › ")
    common = []
    for x, y in zip(pa, pb, strict=False):
        if x != y:
            break
        common.append(x)
    return " › ".join(common) if common else a


def _heading_prefix(title: str | None, text: str) -> str:
    """Keep a merged section's own heading (last path element) as a line above its text."""
    return f"{title.split(' › ')[-1]}\n{text}" if title else text


def _merge_small_sections(sections: list[_Section], size: int) -> list[_Section]:
    """Merge consecutive tiny sections (e.g. a heading with one line) so chunks carry enough context."""
    merged: list[_Section] = []
    small = max(60, size // 6)
    for sec in sections:
        if (merged and merged[-1].tokens < small and merged[-1].tokens + sec.tokens <= size
                and not any(s.kind == "table" for s in sec.segments)):
            prev = merged[-1]
            merged[-1] = _Section(title=_common_title(prev.title, sec.title),
                                  segments=prev.segments + [_Segment(_heading_prefix(sec.title, s.text) if i == 0
                                                                     else s.text, s.page, s.section, s.kind)
                                                            for i, s in enumerate(sec.segments)])
        else:
            merged.append(sec)
    return merged


def _structure_chunks(sections: list[_Section], size: int, overlap: int) -> list[ChunkDraft]:
    splitter = _recursive_splitter(size, overlap)
    drafts: list[ChunkDraft] = []
    for sec in _merge_small_sections(sections, size):
        text_run: list[_Segment] = []

        def flush_run(_sec=sec, _run=text_run) -> None:
            if _run:
                drafts.extend(_split_offset_text(_OffsetText(list(_run)), splitter, fixed_section=_sec.title))
                _run.clear()

        for seg in sec.segments:
            if seg.kind == "table":
                flush_run()
                drafts.extend(_split_table(seg, size, sec.title))
            else:
                text_run.append(seg)
        flush_run()
    return drafts


def _semantic_chunks(sections: list[_Section], settings: ChunkingSettings, embeddings: Embeddings) -> list[ChunkDraft]:
    from langchain_experimental.text_splitter import SemanticChunker

    chunker = SemanticChunker(embeddings, breakpoint_threshold_type="percentile", add_start_index=True)
    guard = _recursive_splitter(settings.chunk_size, settings.chunk_overlap)
    drafts: list[ChunkDraft] = []
    for sec in sections:
        text_segments = [s for s in sec.segments if s.kind != "table"]
        for seg in sec.segments:
            if seg.kind == "table":
                drafts.extend(_split_table(seg, settings.chunk_size, sec.title))
        if not text_segments:
            continue
        ot = _OffsetText(text_segments)
        try:
            pieces = _split_offset_text(ot, chunker, fixed_section=sec.title)
        except Exception as exc:  # embedding failures fall back to recursive splitting
            log.warning("Semantic chunking failed (%s); falling back to recursive", exc)
            pieces = _split_offset_text(ot, guard, fixed_section=sec.title)
        for piece in pieces:
            if piece.token_count > settings.chunk_size:
                sub = _OffsetText([_Segment(piece.content, piece.page_number, sec.title, "text")])
                drafts.extend(_split_offset_text(sub, guard, fixed_section=sec.title))
            else:
                drafts.append(piece)
    return drafts


def _parent_child_chunks(sections: list[_Section], settings: ChunkingSettings) -> list[ChunkDraft]:
    parents = _structure_chunks(sections, settings.parent_chunk_size, 0)
    child_overlap = min(settings.chunk_overlap, settings.child_chunk_size // 4)
    child_splitter = _recursive_splitter(settings.child_chunk_size, child_overlap)
    out: list[ChunkDraft] = []
    for parent in parents:
        parent.chunk_type = "parent"
        parent_index = len(out)
        out.append(parent)
        page_mid = parent.page_number
        children = _split_offset_text(_OffsetText([_Segment(parent.content, page_mid, parent.section_title, "text")]),
                                      child_splitter, chunk_type="child", fixed_section=parent.section_title)
        for child in children:
            child.parent_ref = parent_index
            child.page_number, child.page_end = parent.page_number, parent.page_end
            child.metadata = dict(parent.metadata)
            out.append(child)
    return out


def chunk_blocks(blocks: list[Block], settings: ChunkingSettings, embeddings: Embeddings | None = None) -> list[ChunkDraft]:
    sections = _build_sections(blocks)
    strategy = settings.strategy
    if strategy == "recursive":
        segments = [s for sec in sections for s in sec.segments]
        drafts = _split_offset_text(_OffsetText(segments), _recursive_splitter(settings.chunk_size, settings.chunk_overlap))
    elif strategy == "token":
        splitter = TokenTextSplitter(encoding_name=ENCODING, chunk_size=settings.chunk_size,
                                     chunk_overlap=settings.chunk_overlap, add_start_index=True)
        segments = [s for sec in sections for s in sec.segments]
        drafts = _split_offset_text(_OffsetText(segments), splitter)
    elif strategy == "semantic":
        if embeddings is None:
            raise ValueError("Semantic chunking requires an embeddings model.")
        drafts = _semantic_chunks(sections, settings, embeddings)
    elif strategy == "parent_child":
        drafts = _parent_child_chunks(sections, settings)
    else:
        drafts = _structure_chunks(sections, settings.chunk_size, settings.chunk_overlap)

    for d in drafts:
        d.metadata.setdefault("strategy", strategy)
        if not d.token_count:
            d.token_count = count_tokens(d.content)
    return [d for d in drafts if d.content.strip()]
