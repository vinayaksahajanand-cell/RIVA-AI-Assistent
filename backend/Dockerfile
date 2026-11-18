# RIVA AI backend (API + worker share this image)
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgl/libglib: OpenCV (used by RapidOCR); curl: container health checks
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Pre-download the local embedding + reranker models so first requests are fast (optional, ~150 MB).
ARG PRELOAD_MODELS=true
RUN if [ "$PRELOAD_MODELS" = "true" ]; then python -c "\
from fastembed import TextEmbedding; from fastembed.rerank.cross_encoder import TextCrossEncoder; \
TextEmbedding('BAAI/bge-small-en-v1.5'); TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2')"; fi

RUN useradd --create-home --uid 10001 riva && mkdir -p /data/storage && chown -R riva /app /data
USER riva

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fs http://localhost:8100/api/health || exit 1
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8100 --proxy-headers"]
