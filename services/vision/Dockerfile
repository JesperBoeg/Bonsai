# Bonsai vision service — FastAPI + PyTorch (DINOv2) recognition endpoints.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.hf-cache

WORKDIR /app

# CPU-only PyTorch first, so the heavy CUDA wheels are never pulled in transitively.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision

# Install the remaining dependencies straight from pyproject.toml (single source
# of truth for pins). torch is already satisfied by the CPU wheel above, so this
# does not pull CUDA wheels.
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# Application code and the reference catalog (images are embedded at startup).
COPY app ./app
COPY catalog ./catalog

ENV PORT=8001
EXPOSE 8001

# Generous start period: the first boot downloads model weights and embeds the
# reference catalog, which takes several minutes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8001') + '/health', timeout=4)"

# Model weights are downloaded from Hugging Face on first boot and cached in HF_HOME.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
