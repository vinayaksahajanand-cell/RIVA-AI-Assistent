from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict = {}
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class OkResponse(BaseModel):
    ok: bool = True
