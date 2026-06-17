# Bonsai vision service — FastAPI + PyTorch (DINOv2) recognition endpoints.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.hf-cache

WORKDIR /app

# CPU-only PyTorch first, so the heavy CUDA wheels are never pulled in transitively.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch

# Remaining runtime dependencies (kept in sync with pyproject.toml).
RUN pip install \
    "fastapi>=0.115.0" \
    "numpy>=2.1.0" \
    "pillow>=11.0.0" \
    "pydantic>=2.9.0" \
    "python-multipart>=0.0.20" \
    "transformers>=5.0.0" \
    "uvicorn[standard]>=0.32.0"

# Application code and the reference catalog (images are embedded at startup).
COPY app ./app
COPY catalog ./catalog

ENV PORT=8001
EXPOSE 8001

# Model weights are downloaded from Hugging Face on first boot and cached in HF_HOME.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
