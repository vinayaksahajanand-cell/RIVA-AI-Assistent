"""Output guardrails: sensitive-data redaction, system-prompt leak detection and word-by-word streaming.

``WordStreamer`` turns raw LLM token deltas into whole words, redacting each completed span before it
is sent to the browser. Multi-word patterns (card numbers, phone numbers) are handled by holding back
digit-like words until the pattern is complete, so a secret is never partially streamed.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field


def _luhn_ok(digits: str) -> bool:
    nums = [int(d) for d in digits if d.isdigit()]
    if not 13 <= len(nums) <= 19:
        return False
    total = 0
    for i, n in enumerate(reversed(nums)):
        if i % 2 == 1:
            n *= 2
            n = n - 9 if n > 9 else n
        total += n
    return total % 10 == 0


@dataclass(frozen=True)
class Redaction:
    kind: str
    pattern: re.Pattern
    validator: Callable[[str], bool] | None = None


REDACTIONS: list[Redaction] = [
    Redaction("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)")),
    Redaction("api_key", re.compile(r"\b(sk-(proj-)?[A-Za-z0-9_\-]{16,}|lsv2_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|"
                                    r"gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_\-]{30,})\b")),
    Redaction("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")),
    Redaction("password", re.compile(r"(?i)\b(password|passwd|pwd|passcode|secret)\b(\s*(is|:|=)\s*)(\S{4,})")),
    Redaction("credit_card", re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), _luhn_ok),
    Redaction("iban", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")),
    Redaction("ssn", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    Redaction("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    # Phone numbers: international (+CC …), "(area) …" or dash/dot separated. Plain space-separated digit groups
    # are left alone so figures in tables and reports are not mangled.
    Redaction("phone", re.compile(
        r"(?<![\w+])(?:\+\d{1,3}[ .\-]?(?:\(?\d{1,4}\)?[ .\-]?){1,4}\d{2,4}"
        r"|\(\d{2,4}\)[ .\-]?\d{3,4}[ .\-]?\d{3,4}"
        r"|\d{3}[.\-]\d{3}[.\-]\d{4})(?![\w-])")),
]


def redact_sensitive(text: str) -> tuple[str, dict[str, int]]:
    """Mask secrets and personal data. Returns (redacted_text, {kind: count})."""
    found: dict[str, int] = {}
    for r in REDACTIONS:
        def _sub(m: re.Match, r: Redaction = r) -> str:
            value = m.group(0)
            if r.validator and not r.validator(value):
                return value
            found[r.kind] = found.get(r.kind, 0) + 1
            if r.kind == "password":
                return f"{m.group(1)}{m.group(2)}[REDACTED]"
            return f"[REDACTED {r.kind.upper().replace('_', ' ')}]"

        text = r.pattern.sub(_sub, text)
    return text, found


def leaks_system_prompt(answer: str, system_prompt: str, window: int = 60) -> bool:
    """True if the answer reproduces a long verbatim span of the system prompt."""
    norm_answer = " ".join(answer.split()).lower()
    norm_prompt = " ".join(system_prompt.split()).lower()
    if len(norm_prompt) < window:
        return False
    for start in range(0, len(norm_prompt) - window, window // 2):
        if norm_prompt[start:start + window] in norm_answer:
            return True
    return False


def sensitive_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for r in REDACTIONS:
        for m in r.pattern.finditer(text):
            if r.validator is None or r.validator(m.group(0)):
                spans.append(m.span())
    return spans


@dataclass
class WordStreamer:
    """Re-chunk LLM deltas into whole words (word-by-word streaming), redacting before release.

    With redaction on, the last ``window`` words are held back. Text is released only up to a cut point
    that is not inside a (possibly still growing) sensitive match, so multi-word secrets such as card
    numbers or "password: …" are never partially streamed.
    """

    emit: Callable[[str], None]
    redact: bool = False
    window: int = 6
    _buffer: str = ""
    _held: list[str] = field(default_factory=list)
    findings: dict[str, int] = field(default_factory=dict)

    def feed(self, delta: str) -> None:
        self._buffer += delta
        parts = re.findall(r"\S+\s+", self._buffer)  # complete words incl. trailing whitespace
        self._buffer = self._buffer[sum(len(p) for p in parts):]
        if not self.redact:
            for word in parts:
                self.emit(word)
            return
        self._held.extend(parts)
        self._drain(final=False)

    def _drain(self, final: bool) -> None:
        if not self._held or (not final and len(self._held) <= self.window):
            return
        text = "".join(self._held)
        cut = len(text) if final else sum(len(w) for w in self._held[: len(self._held) - self.window])
        for start, end in sensitive_spans(text):
            if start < cut < end:
                cut = start  # never split a secret across the release boundary
        release, rest = text[:cut], text[cut:]
        self._held = re.findall(r"\S+\s*|\s+", rest)
        if release:
            redacted, found = redact_sensitive(release)
            for k, v in found.items():
                self.findings[k] = self.findings.get(k, 0) + v
            for word in re.findall(r"\S+\s*|\s+", redacted):
                self.emit(word)

    def close(self) -> None:
        if self._buffer:
            if self.redact:
                self._held.append(self._buffer)
            else:
                self.emit(self._buffer)
            self._buffer = ""
        if self.redact:
            self._drain(final=True)
