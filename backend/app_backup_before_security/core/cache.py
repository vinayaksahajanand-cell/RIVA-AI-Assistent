"""Tiny cache abstraction: Redis when ``REDIS_URL`` is configured, in-process LRU otherwise."""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class _MemoryBackend:
    def __init__(self, max_items: int = 2048) -> None:
        self._data: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
        self._max = max_items
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> bytes | None:
        async with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expires, value = item
            if expires and expires < time.time():
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    async def set(self, key: str, value: bytes, ttl: int) -> None:
        async with self._lock:
            self._data[key] = (time.time() + ttl if ttl else 0.0, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    async def incr(self, key: str, ttl: int) -> int:
        async with self._lock:
            expires, value = self._data.get(key, (time.time() + ttl, b"0"))
            if expires < time.time():
                expires, value = time.time() + ttl, b"0"
            n = int(value) + 1
            self._data[key] = (expires, str(n).encode())
            return n

    async def ping(self) -> bool:
        return True


class Cache:
    def __init__(self) -> None:
        self._redis = None
        self._memory = _MemoryBackend()
        url = get_settings().redis_url
        if url:
            try:
                import redis.asyncio as aioredis

                self._redis = aioredis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
            except Exception as exc:  # pragma: no cover - import/config failure
                log.warning("Redis unavailable (%s); using in-memory cache", exc)

    @property
    def backend_name(self) -> str:
        return "redis" if self._redis else "memory"

    async def get(self, key: str) -> bytes | None:
        if self._redis:
            try:
                return await self._redis.get(key)
            except Exception as exc:
                log.warning("Redis get failed: %s", exc)
        return await self._memory.get(key)

    async def set(self, key: str, value: bytes, ttl: int = 3600) -> None:
        if self._redis:
            try:
                await self._redis.set(key, value, ex=ttl)
                return
            except Exception as exc:
                log.warning("Redis set failed: %s", exc)
        await self._memory.set(key, value, ttl)

    async def incr(self, key: str, ttl: int) -> int:
        if self._redis:
            try:
                pipe = self._redis.pipeline()
                pipe.incr(key)
                pipe.expire(key, ttl, nx=True)
                count, _ = await pipe.execute()
                return int(count)
            except Exception as exc:
                log.warning("Redis incr failed: %s", exc)
        return await self._memory.incr(key, ttl)

    async def ping(self) -> bool:
        if self._redis:
            try:
                return bool(await self._redis.ping())
            except Exception:
                return False
        return True


_cache: Cache | None = None


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        _cache = Cache()
    return _cache
