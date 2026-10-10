# Build: dependencies resolved from uv.lock (Mailato comes from its git tag).
FROM python:3.13-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.6.14 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY assets ./assets
COPY data ./data
COPY contracts ./contracts
# The service runs as uid 1000: whatever mode the files had on the build host, make them readable.
RUN chmod -R a+rX /app/src /app/assets /app/data /app/contracts && uv sync --frozen --no-dev

# Runtime: Pango for WeasyPrint, nothing else.
FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    XDG_CACHE_HOME=/tmp/cache \
    RAPPORT_DATA_DIR=/data \
    RAPPORT_CACHE_DIR=/data/cache
USER 1000:1000
EXPOSE 8000
# One worker: PDF layout is serialised in-process to keep memory flat.
CMD ["uvicorn", "sncf_rapport.api:app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]
