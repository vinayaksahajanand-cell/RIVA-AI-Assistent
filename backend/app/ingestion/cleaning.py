"""Text normalisation, header/footer removal and prompt-injection heuristics."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE = re.compile(r"[ \t ]+")
_MULTI_NEWLINE = re.compile(r"\n{3,}")
_BULLET_START = re.compile(r"^\s*([-*•▪◦·]|\d+[.)]|[a-zA-Z][.)])\s+")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0e-\x1f\x7f]")

_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts|messages)",
        r"disregard (all |any )?(the )?(previous|prior|above|system)",
        r"you are now (a|an|in) ",
        r"\bsystem prompt\b",
        r"\bnew instructions?:",
        r"reveal (your|the) (system|hidden) (prompt|instructions)",
        r"<\s*/?\s*(system|assistant|passage)\s*>",
        r"act as (an? )?(unrestricted|jailbroken|developer mode)",
    )
]


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = _MULTI_SPACE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _MULTI_NEWLINE.sub("\n\n", text).strip()


def reflow_paragraphs(text: str) -> str:
    """Join hard-wrapped lines (common in PDFs) while keeping paragraphs, bullets and short lines."""
    out: list[str] = []
    for para in text.split("\n\n"):
        lines = [ln for ln in para.split("\n") if ln.strip()]
        merged: list[str] = []
        for line in lines:
            if (merged and not _BULLET_START.match(line) and len(merged[-1]) > 40
                    and not merged[-1].endswith((".", ":", ";", "?", "!", "|"))):
                merged[-1] = f"{merged[-1]} {line}"
            else:
                merged.append(line)
        out.append("\n".join(merged))
    return "\n\n".join(p for p in out if p)


def _line_signature(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def remove_repeated_headers_footers(pages: list[str], min_pages: int = 3, ratio: float = 0.6) -> list[str]:
    """Drop lines that recur at the top/bottom of most pages (running headers, footers, page numbers)."""
    if len(pages) < min_pages:
        return pages
    def window(n_lines: int) -> int:
        # Short pages: only the very first/last line can be a running header/footer.
        return 2 if n_lines >= 6 else 1

    counter: Counter[str] = Counter()
    for page in pages:
        lines = [ln for ln in page.split("\n") if ln.strip()]
        w = window(len(lines))
        counter.update({_line_signature(ln) for ln in lines[:w] + lines[-w:]})
    threshold = max(2, int(len(pages) * ratio))
    repeated = {sig for sig, n in counter.items() if n >= threshold and len(sig) < 120}
    if not repeated:
        return pages
    cleaned = []
    for page in pages:
        lines = page.split("\n")
        non_empty_idx = [i for i, ln in enumerate(lines) if ln.strip()]
        w = window(len(non_empty_idx))
        edge_idx = set(non_empty_idx[:w] + non_empty_idx[-w:])
        cleaned.append("\n".join(ln for i, ln in enumerate(lines)
                                 if not (i in edge_idx and _line_signature(ln) in repeated)))
    return cleaned


def detect_prompt_injection(text: str) -> list[str]:
    return [p.pattern for p in _INJECTION_PATTERNS if p.search(text)]
