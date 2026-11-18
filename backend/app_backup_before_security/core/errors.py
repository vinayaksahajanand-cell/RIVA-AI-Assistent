"""Consistent error responses. Internal stack traces never reach clients."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

log = get_logger(__name__)


class AppError(Exception):
    """Base class for expected, user-facing errors."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None,
                 details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details or {}


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_error"


class ServiceUnavailable(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"


class RateLimited(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


def error_body(code: str, message: str, request_id: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}, "request_id": request_id}}


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or uuid.uuid4().hex


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code,
                            content=error_body(exc.code, exc.message, _request_id(request), exc.details))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error")
        return JSONResponse(status_code=exc.status_code,
                            content=error_body(code, str(exc.detail), _request_id(request)),
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": list(e.get("loc", [])), "msg": e.get("msg", "")} for e in exc.errors()]
        return JSONResponse(status_code=422,
                            content=error_body("validation_error", "Request validation failed.",
                                               _request_id(request), {"errors": errors}))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        rid = _request_id(request)
        log.exception("Unhandled error (request_id=%s)", rid)
        return JSONResponse(status_code=500,
                            content=error_body("internal_error", "An unexpected error occurred.", rid))
