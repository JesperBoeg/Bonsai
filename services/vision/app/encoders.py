from __future__ import annotations

from io import BytesIO
import os

import numpy as np
from PIL import Image, ImageOps

from app.caching import locked_lru_cache


PIXEL_BACKEND = "pixel-rgb-16"
DINOV2_BACKEND = "dinov2-base-pooler"


def get_identity_encoder_name() -> str:
    return parse_encoder_backend(os.getenv("BONSAI_IDENTITY_ENCODER", "dinov2"))


def get_taxonomy_encoder_name() -> str:
    return parse_encoder_backend(os.getenv("BONSAI_TAXONOMY_ENCODER", "dinov2"))


def get_leaf_encoder_name() -> str:
    return parse_encoder_backend(os.getenv("BONSAI_LEAF_ENCODER", "dinov2"))


def parse_encoder_backend(raw_value: str) -> str:
    normalized = raw_value.strip().lower()

    if normalized in {"pixel", "pixel-rgb-16"}:
        return PIXEL_BACKEND

    if normalized in {"dinov2", "dinov2-base", "dinov2-base-pooler"}:
        return DINOV2_BACKEND

    raise RuntimeError(f"Unsupported encoder backend: {raw_value}")


def compute_embedding_backend(image_bytes: bytes, encoder_name: str) -> list[float]:
    if encoder_name == PIXEL_BACKEND:
        return compute_pixel_embedding(image_bytes)

    if encoder_name == DINOV2_BACKEND:
        return compute_dinov2_embedding(image_bytes)

    raise RuntimeError(f"Unsupported encoder backend: {encoder_name}")


def compute_identity_embedding(image_bytes: bytes) -> list[float]:
    return compute_embedding_backend(image_bytes, get_identity_encoder_name())


def compute_taxonomy_embedding(image_bytes: bytes) -> list[float]:
    return compute_embedding_backend(image_bytes, get_taxonomy_encoder_name())


def compute_leaf_embedding(image_bytes: bytes) -> list[float]:
    return compute_embedding_backend(image_bytes, get_leaf_encoder_name())


def compute_pixel_embedding(image_bytes: bytes) -> list[float]:
    image = Image.open(BytesIO(image_bytes))
    image = image.convert("RGB")
    image = ImageOps.fit(image, (16, 16), method=Image.Resampling.LANCZOS)
    vector = np.asarray(image, dtype=np.float32).reshape(-1) / 255.0
    norm = np.linalg.norm(vector)

    if norm == 0:
        return vector.tolist()

    return (vector / norm).tolist()


def compute_dinov2_embedding(image_bytes: bytes) -> list[float]:
    import torch

    processor, model = load_dinov2_components()
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")

    with torch.inference_mode():
        outputs = model(**inputs)

    vector = outputs.pooler_output[0].detach().cpu().numpy().astype(np.float32)
    norm = np.linalg.norm(vector)

    if norm == 0:
        return vector.tolist()

    return (vector / norm).tolist()


@locked_lru_cache(maxsize=1)
def load_dinov2_components():
    from transformers import AutoImageProcessor, AutoModel

    model_name = os.getenv("BONSAI_DINOV2_MODEL", "facebook/dinov2-base")
    processor = AutoImageProcessor.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()
    return processor, model


def dinov2_components_loaded() -> bool:
    return load_dinov2_components.cache_info().currsize > 0