"""Fixed-window rate limiting backed by Redis (or memory in single-process dev)."""

from __future__ import annotations

import time

from fastapi import Request

from app.core.cache import get_cache
from app.core.config import get_settings
from app.core.errors import RateLimited


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limiter(bucket: str, per_minute_setting: str):
    """Build a FastAPI dependency limiting requests per user (or IP when anonymous)."""

    async def _dependency(request: Request) -> None:
        settings = get_settings()
        if not settings.rate_limit_enabled:
            return
        limit = int(getattr(settings, per_minute_setting))
        identity = getattr(request.state, "user_id", None) or _client_ip(request)
        window = int(time.time() // 60)
        key = f"riva:rl:{bucket}:{identity}:{window}"
        count = await get_cache().incr(key, ttl=70)
        if count > limit:
            raise RateLimited(f"Too many requests. Limit is {limit} per minute for this action.",
                              details={"retry_after_seconds": 60 - int(time.time() % 60)})

    return _dependency
