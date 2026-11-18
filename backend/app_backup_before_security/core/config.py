"""Centralised, environment-driven configuration.

Every setting can be supplied through environment variables or ``backend/.env``.
Secrets are never hard-coded; ``SecretStr`` keeps them out of logs and reprs.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Application ──────────────────────────────────────────────────────
    app_name: str = "RIVA AI"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    api_host: str = "0.0.0.0"
    api_port: int = 8100
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    log_level: str = "INFO"
    log_json: bool = False

    # ── Security ─────────────────────────────────────────────────────────
    secret_key: SecretStr = SecretStr("change-me-in-production-use-a-long-random-string")
    access_token_expire_minutes: int = 720
    session_cookie_name: str = "riva_session"
    cookie_secure: bool = False
    allow_registration: bool = True

    # ── Database / cache ─────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://riva:riva_dev_password@localhost:5434/riva"
    db_pool_size: int = 10
    db_max_overflow: int = 10
    redis_url: str = ""

    # ── Storage & uploads ────────────────────────────────────────────────
    storage_dir: Path = BACKEND_DIR / "storage"
    max_upload_mb: int = 50
    max_files_per_upload: int = 20

    # ── LLM provider ─────────────────────────────────────────────────────
    openai_api_key: SecretStr | None = None
    openai_base_url: str | None = None  # any OpenAI-compatible endpoint (Azure proxy, vLLM, Ollama /v1 ...)
    llm_model: str = "gpt-4.1-mini"
    fast_llm_model: str = "gpt-4.1-mini"  # used for query analysis, grading and verification
    available_models: str = "gpt-4.1-mini,gpt-4.1,gpt-4o-mini,gpt-5-mini"
    llm_temperature: float = 0.1
    llm_max_tokens: int = 1200
    llm_timeout_seconds: float = 60.0
    llm_max_retries: int = 2
    # JSON: {"model": {"input": usd_per_1M_tokens, "output": usd_per_1M_tokens}}
    model_pricing_json: str = ""

    # ── Embeddings ───────────────────────────────────────────────────────
    embedding_provider: Literal["openai", "fastembed"] = "openai"
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    embedding_batch_size: int = 64

    # ── Chunking defaults (overridable per workspace) ────────────────────
    chunk_strategy: Literal["recursive", "token", "semantic", "structure", "parent_child"] = "structure"
    chunk_size_tokens: int = 800
    chunk_overlap_tokens: int = 120
    parent_chunk_size_tokens: int = 2000
    child_chunk_size_tokens: int = 400

    # ── Retrieval defaults (overridable per workspace / request) ─────────
    retrieval_top_k: int = 10
    final_context_k: int = 5
    rrf_k: int = 60
    dense_weight: float = 1.0
    sparse_weight: float = 1.0
    bm25_k1: float = 1.2
    bm25_b: float = 0.75
    reranker_enabled: bool = True
    reranker_provider: Literal["cross-encoder", "none"] = "cross-encoder"
    reranker_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"
    hnsw_ef_search: int = 100
    max_corrective_attempts: int = 1
    grounded_only_default: bool = True
    conversation_memory_turns: int = 6

    # ── OCR ──────────────────────────────────────────────────────────────
    ocr_enabled: bool = True
    ocr_min_chars_per_page: int = 25
    ocr_dpi: int = 200

    # ── Background worker ────────────────────────────────────────────────
    embedded_worker: bool = True  # run the job worker inside the API process
    worker_poll_seconds: float = 2.0
    job_max_attempts: int = 3

    # ── Evaluation ───────────────────────────────────────────────────────
    online_evaluation_enabled: bool = True
    evaluation_llm_model: str = "gpt-4.1-mini"
    evaluation_embedding_model: str = "text-embedding-3-small"
    evaluation_timeout_seconds: float = 180.0
    deepeval_threshold: float = 0.7

    # ── Observability (LangSmith) ────────────────────────────────────────
    langsmith_tracing: bool = Field(default=False, validation_alias=AliasChoices("LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2"))
    langsmith_api_key: SecretStr | None = Field(default=None, validation_alias=AliasChoices("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"))
    langsmith_project: str = Field(default="RIVA-AI", validation_alias=AliasChoices("LANGSMITH_PROJECT", "LANGCHAIN_PROJECT"))
    langsmith_endpoint: str = Field(default="https://api.smith.langchain.com", validation_alias=AliasChoices("LANGSMITH_ENDPOINT", "LANGCHAIN_ENDPOINT"))
    trace_document_content: bool = False  # privacy: redact document text from traces unless enabled
    trace_qa_content: bool = True  # strict privacy when false: hide questions/answers too (timings/metadata kept)

    # ── Rate limiting ────────────────────────────────────────────────────
    rate_limit_enabled: bool = True
    rate_limit_chat_per_minute: int = 30
    rate_limit_upload_per_minute: int = 20
    rate_limit_auth_per_minute: int = 10

    @field_validator("langsmith_tracing", mode="before")
    @classmethod
    def _parse_bool(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return False
        return v

    @field_validator("openai_api_key", "langsmith_api_key", mode="before")
    @classmethod
    def _empty_secret_is_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    # ── Derived helpers ──────────────────────────────────────────────────
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def model_list(self) -> list[str]:
        models = [m.strip() for m in self.available_models.split(",") if m.strip()]
        if self.llm_model not in models:
            models.insert(0, self.llm_model)
        return models

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def llm_configured(self) -> bool:
        return self.openai_api_key is not None or bool(self.openai_base_url)

    @property
    def langsmith_enabled(self) -> bool:
        return bool(self.langsmith_tracing and self.langsmith_api_key)

    @property
    def sync_database_url(self) -> str:
        return self.database_url.replace("+asyncpg", "+psycopg")

    @property
    def model_pricing(self) -> dict[str, dict[str, float]]:
        if not self.model_pricing_json.strip():
            return {}
        try:
            data = json.loads(self.model_pricing_json)
            return {k: {"input": float(v["input"]), "output": float(v["output"])} for k, v in data.items()}
        except (ValueError, KeyError, TypeError):
            return {}


@lru_cache
def get_settings() -> Settings:
    return Settings()
