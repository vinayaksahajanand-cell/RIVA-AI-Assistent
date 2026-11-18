"""Input guardrails: detect prompt injection, jailbreaks, privilege escalation and secret extraction
in the *user's* message before anything is retrieved or sent to the LLM.

Two layers:
1. Deterministic patterns (this module) — fast, explainable, always on when guardrails are enabled.
2. An LLM judgement folded into the query-analysis call (``QueryAnalysis.is_prompt_attack``), so it
   catches paraphrased attacks without adding a separate model round-trip.
"""

from __future__ import annotations

import base64
import re
import unicodedata
from dataclasses import dataclass, field

BLOCK_MESSAGE = ("I can't help with that request. It looks like an attempt to override my instructions or to access "
                 "information outside your permissions, so it was blocked and logged for review.")


@dataclass
class GuardVerdict:
    blocked: bool
    category: str | None = None  # prompt_injection | jailbreak | privilege_escalation | secret_extraction
    reasons: list[str] = field(default_factory=list)
    source: str = "rules"  # rules | llm

    def as_dict(self) -> dict:
        return {"blocked": self.blocked, "category": self.category, "reasons": self.reasons, "source": self.source}


def _p(*patterns: str) -> list[re.Pattern]:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


RULES: dict[str, list[re.Pattern]] = {
    "prompt_injection": _p(
        r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|your|the|system)\b"
        r".{0,25}\b(instructions?|prompts?|rules?|guidelines|directives|constraints)\b",
        r"\bnew (system )?instructions?\s*:",
        r"\b(reveal|show|print|repeat|output|tell me|display|leak|what (is|are))\b.{0,30}\b(your|hidden|initial|"
        r"original|internal)\b.{0,15}\b(system prompt|instructions|prompt|directives)\b",
        r"\b(reveal|show|print|repeat|output|display|leak|what (is|are))\b.{0,30}\bsystem prompt\b",
        r"\brepeat (everything|all|the text) (above|before)\b",
        r"<\s*/?\s*(system|assistant|passage|instructions?)\s*>",
        r"\[\s*(system|INST)\s*\]",
        r"\byou are no longer\b",
    ),
    "jailbreak": _p(
        r"\b(DAN|do anything now|developer mode|jailbreak|jail-break|god mode|unfiltered mode)\b",
        r"\b(act|behave|pretend|roleplay|role-play)\b.{0,20}\b(as|like)\b.{0,30}\b(unrestricted|uncensored|evil|"
        r"without (any )?(rules|restrictions|filters|limits))\b",
        r"\byou are now\b.{0,40}\b(free|unrestricted|admin|root|an? ai without)\b",
        r"\bno (rules|restrictions|filters|guardrails) apply\b",
    ),
    "privilege_escalation": _p(
        r"\b(i am|i'm|as) (the |an? )?(admin|administrator|root|superuser|system owner|security officer)\b",
        r"\b(grant|give|elevate|escalate)\b.{0,20}\b(me|my)\b.{0,20}\b(access|permissions?|clearance|privileges?|"
        r"admin|role)\b",
        r"\b(bypass|ignore|disable|override|skip|turn off)\b.{0,30}\b(access control|rbac|clearance|permissions?|"
        r"classification|security|guardrails?|filters?|redaction)\b",
        r"\b(all|every|other users'?|everyone'?s?)\b.{0,15}\b(documents?|files?|conversations?|chats?)\b.{0,20}"
        r"\b(including|even|regardless)\b",
    ),
    # Only applied to least-privileged users: managers/admins may legitimately ask about classified documents.
    "classified_access": _p(
        r"\b(show|list|give|read|open|access|retrieve|dump)\b.{0,30}\b(restricted|confidential|classified|secret|"
        r"hidden|private)\b.{0,15}\b(documents?|files?|records?|data)\b",
    ),
    "secret_extraction": _p(
        r"\b(show|give|tell|reveal|list|print|dump|leak|send|what (is|are))\b.{0,20}\b(the |all |your |any )?"
        r"(admin |root |system |database |db |server )?(passwords?|api[ _-]?keys?|secret[ _-]?keys?|credentials|"
        r"access tokens?|connection strings?|private keys?|env(ironment)? variables)\b"
        r"(?!\s+(policy|policies|requirements?|rules?|reset|length|complexity|rotation|guidelines?))",
        r"\b(dump|export|exfiltrate|download)\b.{0,20}\b(the )?(database|vector (store|index)|embeddings|all "
        r"(documents|chunks|data))\b",
        r"\bOPENAI_API_KEY|SECRET_KEY|LANGCHAIN_API_KEY\b",
    ),
}


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[​-‏⁠﻿]", "", text)  # zero-width obfuscation
    return re.sub(r"\s+", " ", text)


def _decoded_variants(text: str) -> list[str]:
    """Catch simple encoding tricks (base64 payloads)."""
    out = []
    for token in re.findall(r"[A-Za-z0-9+/=]{24,}", text):
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8")
            if decoded.isprintable():
                out.append(decoded)
        except Exception:
            continue
    return out


def check_user_input(text: str, strict: bool = True) -> GuardVerdict:
    """strict=True for the least-privileged role (adds the classified-document access rules)."""
    candidates = [_normalise(text), *(_normalise(d) for d in _decoded_variants(text))]
    for category, patterns in RULES.items():
        if category == "classified_access" and not strict:
            continue
        for pattern in patterns:
            for candidate in candidates:
                match = pattern.search(candidate)
                if match:
                    return GuardVerdict(blocked=True, category=category,
                                        reasons=[f"matched {category} rule: “{match.group(0)[:80]}”"])
    return GuardVerdict(blocked=False)
