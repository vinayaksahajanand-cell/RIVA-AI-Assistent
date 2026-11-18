"""Workspace-level configurable settings (chunking, retrieval, generation, evaluation)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.config import get_settings

ChunkStrategy = Literal["recursive", "token", "semantic", "structure", "parent_child"]
RetrievalMode = Literal["hybrid", "dense", "bm25"]
Classification = Literal["public", "internal", "confidential", "restricted"]


def _s():
    return get_settings()


class ChunkingSettings(BaseModel):
    strategy: ChunkStrategy = Field(default_factory=lambda: _s().chunk_strategy)
    chunk_size: int = Field(default_factory=lambda: _s().chunk_size_tokens, ge=100, le=4000)
    chunk_overlap: int = Field(default_factory=lambda: _s().chunk_overlap_tokens, ge=0, le=1000)
    parent_chunk_size: int = Field(default_factory=lambda: _s().parent_chunk_size_tokens, ge=400, le=8000)
    child_chunk_size: int = Field(default_factory=lambda: _s().child_chunk_size_tokens, ge=100, le=2000)

    @model_validator(mode="after")
    def _check(self) -> ChunkingSettings:
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        if self.child_chunk_size >= self.parent_chunk_size:
            raise ValueError("child_chunk_size must be smaller than parent_chunk_size")
        return self


class RetrievalSettings(BaseModel):
    mode: RetrievalMode = "hybrid"
    top_k: int = Field(default_factory=lambda: _s().retrieval_top_k, ge=1, le=50)
    final_k: int = Field(default_factory=lambda: _s().final_context_k, ge=1, le=12)
    rrf_k: int = Field(default_factory=lambda: _s().rrf_k, ge=1, le=500)
    dense_weight: float = Field(default_factory=lambda: _s().dense_weight, ge=0, le=5)
    sparse_weight: float = Field(default_factory=lambda: _s().sparse_weight, ge=0, le=5)
    reranker_enabled: bool = Field(default_factory=lambda: _s().reranker_enabled)
    max_corrective_attempts: int = Field(default_factory=lambda: _s().max_corrective_attempts, ge=0, le=3)

    @model_validator(mode="after")
    def _check(self) -> RetrievalSettings:
        if self.final_k > self.top_k:
            self.final_k = self.top_k
        return self


class GenerationSettings(BaseModel):
    model: str = Field(default_factory=lambda: _s().llm_model, max_length=100)
    temperature: float = Field(default_factory=lambda: _s().llm_temperature, ge=0, le=2)
    max_tokens: int = Field(default_factory=lambda: _s().llm_max_tokens, ge=64, le=8192)
    grounded_only: bool = Field(default_factory=lambda: _s().grounded_only_default)


class EvaluationSettings(BaseModel):
    online_enabled: bool = Field(default_factory=lambda: _s().online_evaluation_enabled)


class SecuritySettings(BaseModel):
    """RBAC clearance and guardrail policy for a workspace (admin-only)."""

    role_clearance: dict[str, Classification] = Field(
        default_factory=lambda: {"manager": "confidential", "user": "internal"},
        description="Highest document classification each role may retrieve. Admins always see everything.")
    default_classification: Classification = "internal"
    guardrails_enabled: bool = True
    block_prompt_injection: bool = True
    llm_injection_check: bool = True
    exclude_flagged_chunks: bool = True
    redact_sensitive_output: bool = True
    show_diagnostics_to_users: bool = False

    @model_validator(mode="after")
    def _check(self) -> SecuritySettings:
        unknown = set(self.role_clearance) - {"manager", "user"}
        if unknown:
            raise ValueError(f"role_clearance only configures 'manager' and 'user' (got {sorted(unknown)})")
        return self


class WorkspaceSettings(BaseModel):
    chunking: ChunkingSettings = Field(default_factory=ChunkingSettings)
    retrieval: RetrievalSettings = Field(default_factory=RetrievalSettings)
    generation: GenerationSettings = Field(default_factory=GenerationSettings)
    evaluation: EvaluationSettings = Field(default_factory=EvaluationSettings)
    security: SecuritySettings = Field(default_factory=SecuritySettings)

    @classmethod
    def from_stored(cls, data: dict | None) -> WorkspaceSettings:
        try:
            return cls.model_validate(data or {})
        except Exception:
            return cls()


class SystemInfo(BaseModel):
    app_name: str
    version: str
    available_models: list[str]
    default_model: str
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int
    reranker_model: str | None
    llm_configured: bool
    langsmith_enabled: bool
    langsmith_project: str | None
    ocr_enabled: bool
    max_upload_mb: int
    supported_extensions: list[str]
    online_evaluation_available: bool
    registration_mode: str = "shared"
    classifications: list[str] = ["public", "internal", "confidential", "restricted"]
    roles: list[str] = ["admin", "manager", "user"]
