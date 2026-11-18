"""LangSmith tracing verified up to the network boundary.

A local HTTP server stands in for the LangSmith API. A chat request runs with tracing enabled;
the test then inspects the exact payloads the LangSmith SDK sent: the pipeline spans, the request
metadata, and that document text was redacted (TRACE_DOCUMENT_CONTENT=false).
"""

from __future__ import annotations

import gzip
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from pydantic import SecretStr

from tests.conftest import parse_sse, register, upload

SECRET_SENTENCE = b"The vault access code for the Lisbon office is TANGERINE-4471 and rotates monthly."


class _Capture(BaseHTTPRequestHandler):
    bodies: list[bytes] = []

    def log_message(self, *args):  # silence
        pass

    def _read(self) -> bytes:
        raw = self.rfile.read(int(self.headers.get("content-length") or 0))
        enc = (self.headers.get("content-encoding") or "").lower()
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "zstd":
            import zstandard

            raw = zstandard.ZstdDecompressor().decompressobj().decompress(raw)
        return raw

    def do_POST(self):  # noqa: N802
        _Capture.bodies.append(self.path.encode() + b"\n" + self._read())
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    do_PATCH = do_POST  # noqa: N815

    def do_GET(self):  # noqa: N802
        self.send_response(404)
        self.end_headers()


@pytest.fixture
def fake_langsmith(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Capture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _Capture.bodies = []
    from app.core.config import get_settings
    from app.observability import tracing

    s = get_settings()
    monkeypatch.setattr(s, "langsmith_tracing", True)
    monkeypatch.setattr(s, "langsmith_api_key", SecretStr("lsv2_pt_local_capture_only"))
    monkeypatch.setattr(s, "langsmith_endpoint", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(s, "langsmith_project", "RIVA-AI-test")
    monkeypatch.setattr(s, "trace_document_content", False)
    tracing.configure_tracing()
    assert tracing.tracing_enabled()
    yield _Capture
    tracing.flush()
    server.shutdown()
    monkeypatch.undo()
    import langsmith

    tracing._client = None
    tracing.configure_tracing()
    langsmith.configure(enabled=False)


async def test_chat_is_traced_with_redaction(client_factory, fake_langsmith):
    from app.observability import tracing

    c = await client_factory()
    await register(c, "tracer")
    await upload(c, {"security.txt": SECRET_SENTENCE})
    r = await c.post("/api/chat/stream", json={"message": "What is the vault access code for the Lisbon office?"})
    events = parse_sse(r.text)
    msg = next(d for e, d in events if e == "done")["message"]
    assert msg["metadata"]["langsmith_run_id"] == msg["metadata"]["run_id"]
    tracing.flush()

    sent = b"\n".join(fake_langsmith.bodies)
    assert sent, "the SDK sent nothing to the (fake) LangSmith endpoint"
    text = sent.decode("utf-8", errors="replace")
    for span in ("riva_chat", "analyze", "retrieve", "embed_query", "dense_retrieval", "bm25_retrieval", "rerank",
                 "grade", "answer_generation", "verify", "finalize"):
        assert span in text, f"span {span!r} missing from trace"
    assert msg["metadata"]["run_id"] in text, "root run id is the stored message run id"
    assert msg["conversation_id"] in text, "session/conversation id is attached as metadata"
    assert "retrieval_config" in text and "RIVA-AI-test" in text
    # Privacy: retrieved document text never leaves the process (chunks, contexts, prompt passages)...
    import re

    assert "[redacted" in text and "<passage" in text  # prompt structure kept, passage bodies masked
    for leak in (r'"content":\s*"The vault', r'"context_text":\s*"The vault', r'"snippet":\s*"The vault',
                 r'<passage[^>]*>(\\n|\n)The vault', r'"retrieved_contexts?":\s*\["The vault'):
        assert not re.search(leak, text), f"document text leaked via {leak}"
    # ...while the question and the generated answer remain traceable for debugging.
    assert "What is the vault access code" in text and '"answer":' in text


async def test_strict_mode_hides_questions_and_answers(client_factory, fake_langsmith, monkeypatch):
    from app.core.config import get_settings
    from app.observability import tracing

    monkeypatch.setattr(get_settings(), "trace_qa_content", False)
    tracing.configure_tracing()
    c = await client_factory()
    await register(c, "strict")
    await upload(c, {"vault.txt": SECRET_SENTENCE})
    await c.post("/api/chat/stream", json={"message": "What is the vault access code for the Lisbon office?"})
    tracing.flush()
    text = b"\n".join(fake_langsmith.bodies).decode("utf-8", errors="replace")
    assert "dense_retrieval" in text and "answer_generation" in text  # spans + timings still traced
    assert "TANGERINE" not in text and "vault access code" not in text
