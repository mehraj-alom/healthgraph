# Lightweight Python 3.11 base image
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*


# Production builds pass REQUIREMENTS=requirements.prod.txt (pinned).
# Default keeps local/dev behavior identical.
ARG REQUIREMENTS=requirements.txt
COPY ${REQUIREMENTS} requirements.txt

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt


RUN python -m spacy download en_core_web_sm

COPY . .


RUN mkdir -p /app/storage/documents

# Production hygiene: never run the API as root. The app only needs to read
# its own code, write the storage scratch dir, and bind $PORT (>1024).
RUN useradd -m -u 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser


EXPOSE 8000

# P7: liveness probe for orchestrators (cheap static endpoint; readiness
# gating is the separate /ready endpoint).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]