from collections import defaultdict
from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import UnidentifiedImageError
from pydantic import AliasChoices, BaseModel, Field, TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from app.caching import locked_lru_cache
from app.encoders import (
    DINOV2_BACKEND,
    PIXEL_BACKEND,
    compute_embedding_backend,
    compute_identity_embedding,
    compute_leaf_embedding,
    compute_taxonomy_embedding,
    dinov2_components_loaded,
    get_identity_encoder_name,
    get_leaf_encoder_name,
    get_taxonomy_encoder_name,
    load_dinov2_components,
)
from app.style_geometry import (
    analyze_style_photo,
    blend_style_similarity,
    compute_style_geometry_descriptor,
    compute_style_geometry_metrics,
    cosine_similarity as geometry_cosine_similarity,
    score_style_prototype_similarity,
    StyleGeometryMetrics,
)


logger = logging.getLogger("bonsai.vision")

KNOWN_CANDIDATE_EMBEDDING_MODELS = {PIXEL_BACKEND, DINOV2_BACKEND}
DEFAULT_CANDIDATE_EMBEDDING_MODEL = PIXEL_BACKEND
NON_IMAGE_UPLOAD_DETAIL = "Uploaded file is not a readable image. Send a JPEG, PNG, or similar image file."

SERVICE_STATE: dict[str, object] = {
    "leaf_index_ready": False,
    "leaf_index_error": None,
    "style_catalog_ready": False,
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    preload_runtime_dependencies()
    yield


def preload_runtime_dependencies() -> None:
    if {
        get_identity_encoder_name(),
        get_taxonomy_encoder_name(),
        get_leaf_encoder_name(),
    } & {DINOV2_BACKEND}:
        try:
            load_dinov2_components()
        except Exception:
            logger.exception("Failed to preload DINOv2 components; embedding requests will retry lazily.")

    try:
        get_style_reference_features()
    except Exception:
        logger.exception("Failed to preload the style reference catalog; style predictions will retry lazily.")

    preload_leaf_reference_index()


def preload_leaf_reference_index() -> None:
    try:
        entries = load_leaf_reference_catalog_embeddings(get_leaf_encoder_name())
    except Exception as error:
        SERVICE_STATE["leaf_index_error"] = str(error)
        logger.exception(
            "Open-license leaf reference index failed to load at startup; "
            "/recognize-leaf is degraded and will return 503."
        )
        return

    SERVICE_STATE["leaf_index_ready"] = True
    logger.info("Leaf reference index preloaded with %d entries.", len(entries))


app = FastAPI(
    title="Bonsai Vision Service",
    version="0.1.0",
    description="Embeddings and recognition endpoints for the Bonsai app.",
    lifespan=lifespan,
)


class Candidate(BaseModel):
    tree_id: str = Field(validation_alias=AliasChoices("tree_id", "treeId"))
    photo_id: str = Field(validation_alias=AliasChoices("photo_id", "photoId"))
    embedding: list[float]
    embedding_model: str | None = Field(default=None, validation_alias=AliasChoices("embedding_model", "embeddingModel"))


class Prediction(BaseModel):
    id: int | None
    label: str
    subtitle: str | None = None
    confidence: float


class RecognitionMatch(BaseModel):
    tree_id: str
    photo_id: str
    score: float


class RecognitionResponse(BaseModel):
    embedding: list[float]
    embedding_model: str
    candidate_matches: list[RecognitionMatch]
    matched_tree_id: str | None = None
    match_score: float | None = None
    species_predictions: list[Prediction]
    style_predictions: list[Prediction]
    taxonomy_embedding_model: str
    hosted_fallback_recommended: bool = False
    fallback_reason: str | None = None


class LeafRecognitionResponse(BaseModel):
    embedding: list[float]
    embedding_model: str
    species_predictions: list[Prediction]
    reference_count: int


class ReferenceCatalogEntry(BaseModel):
    id: str
    local_path: str
    source_page_url: str
    species_label: str
    style_label: str
    use_for_species_eval: bool
    use_for_style_eval: bool


class ReferenceCatalogMatch(BaseModel):
    id: str
    species_label: str
    style_label: str
    score: float


class LeafReferenceCatalogEntry(BaseModel):
    id: str
    local_path: str = Field(validation_alias=AliasChoices("local_path", "localPath"))
    species_label: str = Field(validation_alias=AliasChoices("species_label", "speciesLabel"))
    subtitle: str | None = None
    taxon_rank: str | None = Field(default=None, validation_alias=AliasChoices("taxon_rank", "taxonRank"))
    source_name: str = Field(validation_alias=AliasChoices("source_name", "sourceName"))
    source_priority: int = Field(validation_alias=AliasChoices("source_priority", "sourcePriority"))
    license_code: str | None = Field(default=None, validation_alias=AliasChoices("license_code", "licenseCode"))
    remote_url: str | None = Field(default=None, validation_alias=AliasChoices("remote_url", "remoteUrl"))
    record_url: str | None = Field(default=None, validation_alias=AliasChoices("record_url", "recordUrl"))
    attribution: str | None = None


class LeafReferenceCatalogMatch(BaseModel):
    id: str
    species_label: str
    score: float
    source_name: str | None = None
    source_priority: int = 999


class SpeciesProgramEntry(BaseModel):
    id: int
    slug: str
    label: str
    subtitle: str | None = None
    aliases: list[str] = Field(default_factory=list)
    recognitionEnabled: bool = True


@app.get("/health")
def health() -> dict[str, bool | str]:
    return {
        "status": "ok",
        "models_loaded": are_required_models_loaded(),
        "leaf_index_ready": bool(SERVICE_STATE["leaf_index_ready"]),
        "style_catalog_ready": bool(SERVICE_STATE["style_catalog_ready"]),
    }


def are_required_models_loaded() -> bool:
    required_backends = {
        get_identity_encoder_name(),
        get_taxonomy_encoder_name(),
        get_leaf_encoder_name(),
    }
    if DINOV2_BACKEND not in required_backends:
        return True

    return dinov2_components_loaded()


@app.post("/recognize", response_model=RecognitionResponse)
async def recognize(
    image: UploadFile = File(...),
    candidates: str = Form(default="[]"),
    include_identity_matches: bool = Form(default=False),
    include_style_predictions: bool = Form(default=False),
) -> RecognitionResponse:
    image_bytes = await image.read()
    typed_candidates = parse_candidates(candidates) if include_identity_matches else []
    return await run_in_threadpool(
        recognize_sync,
        image_bytes,
        typed_candidates,
        include_identity_matches,
        include_style_predictions,
    )


def recognize_sync(
    image_bytes: bytes,
    typed_candidates: list[Candidate],
    include_identity_matches: bool,
    include_style_predictions: bool,
) -> RecognitionResponse:
    try:
        return recognize_sync_inner(
            image_bytes,
            typed_candidates,
            include_identity_matches,
            include_style_predictions,
        )
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=422, detail=NON_IMAGE_UPLOAD_DETAIL) from error


def recognize_sync_inner(
    image_bytes: bytes,
    typed_candidates: list[Candidate],
    include_identity_matches: bool,
    include_style_predictions: bool,
) -> RecognitionResponse:
    # The background-quality gate only guards style predictions: geometry-based
    # style scoring needs a clean silhouette. Identity-only captures must accept
    # arbitrary (e.g. garden) backgrounds.
    style_photo_analysis = analyze_style_photo(image_bytes) if include_style_predictions else None
    if style_photo_analysis is not None and style_photo_analysis.background_guidance is not None:
        raise HTTPException(status_code=422, detail=style_photo_analysis.background_guidance)

    identity_embedding = compute_embedding(image_bytes)
    taxonomy_embedding = compute_taxonomy_embedding(image_bytes) if include_style_predictions else None
    style_geometry_descriptor = style_photo_analysis.descriptor if style_photo_analysis is not None else None
    style_geometry_metrics = style_photo_analysis.metrics if style_photo_analysis is not None else None

    identity_matching_ran = include_identity_matches and bool(typed_candidates)
    ranked_matches = rank_candidates(image_bytes, identity_embedding, typed_candidates) if identity_matching_ran else []
    top_match = ranked_matches[0] if ranked_matches else None
    style_reference_matches = (
        rank_style_reference_catalog_matches(
            taxonomy_embedding,
            style_geometry_descriptor,
            query_style_metrics=style_geometry_metrics,
        )
        if include_style_predictions and taxonomy_embedding is not None and style_geometry_descriptor is not None
        else []
    )
    species_predictions: list[Prediction] = []
    style_predictions = rank_reference_predictions(style_reference_matches, "style") if include_style_predictions else []
    matched_tree_id = None
    match_score = None

    if top_match is not None:
        match_score = top_match.score

        if top_match.score >= get_confident_identity_match_threshold():
            matched_tree_id = top_match.tree_id

    hosted_fallback_recommended, fallback_reason = should_recommend_hosted_fallback(
        ranked_matches,
        species_predictions,
        style_predictions,
        identity_requested=identity_matching_ran,
        # /recognize never computes species predictions; that stream comes from
        # /recognize-leaf, so it must never factor into the fallback decision.
        species_requested=False,
        style_requested=include_style_predictions,
    )

    return RecognitionResponse(
        embedding=identity_embedding,
        embedding_model=get_identity_encoder_name(),
        candidate_matches=ranked_matches,
        matched_tree_id=matched_tree_id,
        match_score=match_score,
        species_predictions=species_predictions,
        style_predictions=style_predictions,
        taxonomy_embedding_model=get_taxonomy_encoder_name(),
        hosted_fallback_recommended=hosted_fallback_recommended,
        fallback_reason=fallback_reason,
    )


@app.post("/recognize-leaf", response_model=LeafRecognitionResponse)
async def recognize_leaf(
    image: UploadFile = File(...),
) -> LeafRecognitionResponse:
    image_bytes = await image.read()
    return await run_in_threadpool(recognize_leaf_sync, image_bytes)


def recognize_leaf_sync(image_bytes: bytes) -> LeafRecognitionResponse:
    reference_index = get_leaf_reference_index()

    try:
        leaf_embedding = compute_leaf_embedding(image_bytes)
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=422, detail=NON_IMAGE_UPLOAD_DETAIL) from error

    leaf_reference_matches = rank_leaf_reference_catalog_matches(leaf_embedding, reference_index)
    species_predictions = rank_leaf_reference_predictions(leaf_reference_matches)

    return LeafRecognitionResponse(
        embedding=leaf_embedding,
        embedding_model=get_leaf_encoder_name(),
        species_predictions=species_predictions,
        reference_count=len(reference_index),
    )


def get_leaf_reference_index() -> list[tuple[LeafReferenceCatalogEntry, list[float]]]:
    known_error = SERVICE_STATE["leaf_index_error"]
    if known_error is not None:
        raise HTTPException(status_code=503, detail=f"Leaf recognition is unavailable: {known_error}")

    try:
        entries = load_leaf_reference_catalog_embeddings(get_leaf_encoder_name())
    except Exception as error:
        SERVICE_STATE["leaf_index_error"] = str(error)
        logger.exception("Open-license leaf reference index failed to load; /recognize-leaf is degraded.")
        raise HTTPException(status_code=503, detail=f"Leaf recognition is unavailable: {error}") from error

    SERVICE_STATE["leaf_index_ready"] = True
    return entries


def parse_candidates(raw_candidates: str) -> list[Candidate]:
    if not raw_candidates:
        return []

    try:
        candidate_payload = json.loads(raw_candidates)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=422,
            detail=f"candidates must be a JSON array: {error.msg} (line {error.lineno}, column {error.colno}).",
        ) from error

    adapter = TypeAdapter(list[Candidate])
    try:
        return adapter.validate_python(candidate_payload)
    except ValidationError as error:
        first_error = error.errors()[0]
        location = ".".join(str(part) for part in first_error["loc"]) or "candidates"
        raise HTTPException(
            status_code=422,
            detail=f"candidates failed validation at {location}: {first_error['msg']}",
        ) from error


def compute_embedding(image_bytes: bytes) -> list[float]:
    return compute_identity_embedding(image_bytes)


def rank_candidates(
    image_bytes: bytes,
    identity_embedding: list[float],
    candidates: list[Candidate],
) -> list[RecognitionMatch]:
    """Score each candidate against a query embedding from its own encoder space.

    Candidates are grouped by their stored `embedding_model` (null means the
    legacy pixel encoder); one query embedding is computed per encoder family
    present. Candidates with unknown model names are skipped with a warning.
    """
    ranked_matches: list[RecognitionMatch] = []
    query_embeddings_by_model: dict[str, list[float]] = {get_identity_encoder_name(): identity_embedding}

    for candidate in candidates:
        model_name = candidate.embedding_model or DEFAULT_CANDIDATE_EMBEDDING_MODEL
        if model_name not in KNOWN_CANDIDATE_EMBEDDING_MODELS:
            logger.warning(
                "Skipping candidate tree=%s photo=%s with unknown embedding model %r.",
                candidate.tree_id,
                candidate.photo_id,
                model_name,
            )
            continue

        query_embedding = query_embeddings_by_model.get(model_name)
        if query_embedding is None:
            query_embedding = compute_embedding_backend(image_bytes, model_name)
            query_embeddings_by_model[model_name] = query_embedding

        score = cosine_similarity(query_embedding, candidate.embedding)
        ranked_matches.append(
            RecognitionMatch(
                tree_id=candidate.tree_id,
                photo_id=candidate.photo_id,
                score=score,
            )
        )

    ranked_matches.sort(key=lambda match: match.score, reverse=True)
    if not ranked_matches:
        return []

    top_score = ranked_matches[0].score
    plausible_matches = [
        match
        for match in ranked_matches
        if match.score >= get_identity_suggestion_score_floor() and (top_score - match.score) <= get_identity_suggestion_margin()
    ]
    return plausible_matches[:3]


def rank_reference_catalog_matches(embedding: list[float], taxonomy: str) -> list[ReferenceCatalogMatch]:
    matches: list[ReferenceCatalogMatch] = []

    for entry, reference_embedding in load_reference_catalog_embeddings(get_taxonomy_encoder_name()):
        if taxonomy == "species" and not entry.use_for_species_eval:
            continue
        if taxonomy == "style" and not entry.use_for_style_eval:
            continue

        score = cosine_similarity(embedding, reference_embedding)
        matches.append(
            ReferenceCatalogMatch(
                id=entry.id,
                species_label=entry.species_label,
                style_label=entry.style_label,
                score=score,
            )
        )

    matches.sort(key=lambda match: match.score, reverse=True)
    return matches[:5]


def rank_style_reference_catalog_matches(
    embedding: list[float],
    style_geometry_descriptor: list[float],
    query_style_metrics: StyleGeometryMetrics | None = None,
) -> list[ReferenceCatalogMatch]:
    matches: list[ReferenceCatalogMatch] = []
    geometry_weight = get_style_geometry_weight()
    prototype_weight = get_style_prototype_weight()

    for entry, reference_embedding, reference_geometry_descriptor in get_style_reference_features():
        if not entry.use_for_style_eval:
            continue

        embedding_score = cosine_similarity(embedding, reference_embedding)
        geometry_score = geometry_cosine_similarity(style_geometry_descriptor, reference_geometry_descriptor)
        score = blend_style_similarity(embedding_score, geometry_score, geometry_weight)
        if prototype_weight > 0:
            prototype_score = score_style_prototype_similarity(style_geometry_descriptor, entry.style_label)
            if prototype_score is not None:
                score = blend_style_similarity(score, prototype_score, prototype_weight)

        score = apply_style_label_prior(score, entry.style_label, query_style_metrics)
        matches.append(
            ReferenceCatalogMatch(
                id=entry.id,
                species_label=entry.species_label,
                style_label=entry.style_label,
                score=score,
            )
        )

    matches.sort(key=lambda match: match.score, reverse=True)
    return matches[:5]


def rank_leaf_reference_catalog_matches(
    embedding: list[float],
    reference_index: list[tuple[LeafReferenceCatalogEntry, list[float]]],
) -> list[LeafReferenceCatalogMatch]:
    matches: list[LeafReferenceCatalogMatch] = []

    for entry, reference_embedding in reference_index:
        score = cosine_similarity(embedding, reference_embedding)
        matches.append(
            LeafReferenceCatalogMatch(
                id=entry.id,
                species_label=entry.species_label,
                score=score,
                source_name=entry.source_name,
                source_priority=entry.source_priority,
            )
        )

    matches.sort(key=lambda match: (-match.score, match.source_priority, match.id))
    return matches[:12]


def rank_leaf_reference_predictions(matches: list[LeafReferenceCatalogMatch]) -> list[Prediction]:
    weighted_species_labels: list[tuple[str, float]] = []
    for index, match in enumerate(matches):
        rank_weight = 1.0 / (index + 1)
        weighted_species_labels.append((match.species_label, max(match.score, 0.0) * rank_weight))

    return rank_species_predictions(weighted_species_labels)


def rank_reference_predictions(matches: list[ReferenceCatalogMatch], taxonomy: str) -> list[Prediction]:
    if taxonomy == "species":
        weighted_species_labels: list[tuple[str, float]] = []

        for index, match in enumerate(matches):
            if not match.species_label:
                continue

            rank_weight = 1.0 / (index + 1)
            weighted_species_labels.append((match.species_label, max(match.score, 0.0) * rank_weight))

        return rank_species_predictions(weighted_species_labels)

    aggregate_scores: dict[str, float] = defaultdict(float)

    for index, match in enumerate(matches):
        label = match.style_label
        if not label:
            continue

        rank_weight = 1.0 / (index + 1)
        aggregate_scores[label] += max(match.score, 0.0) * rank_weight

    if not aggregate_scores:
        return []

    total_score = sum(aggregate_scores.values())
    predictions = [
        Prediction(id=None, label=label, confidence=score / total_score if total_score > 0 else 0.0)
        for label, score in aggregate_scores.items()
    ]
    predictions.sort(key=lambda prediction: prediction.confidence, reverse=True)
    return predictions[:3]


def rank_species_predictions(weighted_species_labels: list[tuple[str, float]]) -> list[Prediction]:
    aggregate_scores: dict[str, float] = defaultdict(float)
    prediction_metadata: dict[str, tuple[int | None, str, str | None]] = {}

    for raw_label, weighted_score in weighted_species_labels:
        prediction_id, prediction_label, prediction_subtitle = resolve_species_prediction_metadata(raw_label)
        prediction_key = f"catalog:{prediction_id}" if prediction_id is not None else f"label:{normalize_lookup_key(prediction_label)}"

        aggregate_scores[prediction_key] += weighted_score
        if prediction_key not in prediction_metadata:
            prediction_metadata[prediction_key] = (prediction_id, prediction_label, prediction_subtitle)

    if not aggregate_scores:
        return []

    total_score = sum(aggregate_scores.values())
    predictions = [
        Prediction(
            id=prediction_metadata[prediction_key][0],
            label=prediction_metadata[prediction_key][1],
            subtitle=prediction_metadata[prediction_key][2],
            confidence=score / total_score if total_score > 0 else 0.0,
        )
        for prediction_key, score in aggregate_scores.items()
    ]
    predictions.sort(key=lambda prediction: prediction.confidence, reverse=True)
    return predictions[:3]


def canonicalize_species_label(label: str) -> str:
    return resolve_species_prediction_metadata(label)[1]


def resolve_species_prediction_metadata(label: str) -> tuple[int | None, str, str | None]:
    resolved_entry = resolve_species_program_entry(label)
    if resolved_entry is None:
        return None, label, None

    return resolved_entry.id, resolved_entry.label, resolved_entry.subtitle


def resolve_species_program_entry(label: str) -> SpeciesProgramEntry | None:
    return load_species_prediction_lookup().get(normalize_lookup_key(label))


@locked_lru_cache(maxsize=1)
def load_species_prediction_lookup() -> dict[str, SpeciesProgramEntry]:
    lookup: dict[str, SpeciesProgramEntry] = {}

    for entry in load_species_program_entries():
        for key in build_species_lookup_keys(entry):
            lookup.setdefault(key, entry)

    return lookup


@locked_lru_cache(maxsize=1)
def load_species_program_entries() -> list[SpeciesProgramEntry]:
    species_program_path = Path(__file__).resolve().parents[1] / "catalog" / "species_program.json"
    if not species_program_path.exists():
        return []

    raw_entries = json.loads(species_program_path.read_text(encoding="utf-8"))
    if not isinstance(raw_entries, list):
        return []

    adapter = TypeAdapter(list[SpeciesProgramEntry])
    return [entry for entry in adapter.validate_python(raw_entries) if entry.recognitionEnabled]


def build_species_lookup_keys(entry: SpeciesProgramEntry) -> list[str]:
    values = [entry.label, entry.subtitle or "", *entry.aliases]
    return [
        key
        for key in dict.fromkeys(normalize_lookup_key(value) for value in values)
        if key
    ]


def normalize_lookup_key(value: str) -> str:
    return value.strip().lower()


@locked_lru_cache(maxsize=4)
def load_reference_catalog_embeddings(encoder_name: str) -> list[tuple[ReferenceCatalogEntry, list[float]]]:
    catalog_path = Path(__file__).resolve().parents[1] / "catalog" / "bonsai_reference_catalog.json"
    raw_entries = json.loads(catalog_path.read_text(encoding="utf-8"))
    adapter = TypeAdapter(list[ReferenceCatalogEntry])
    catalog_entries = adapter.validate_python(raw_entries)
    loaded_entries: list[tuple[ReferenceCatalogEntry, list[float]]] = []

    for entry in catalog_entries:
        image_path = catalog_path.parent / entry.local_path
        if not image_path.exists():
            continue
        loaded_entries.append((entry, compute_embedding_backend(image_path.read_bytes(), encoder_name)))

    return loaded_entries


def get_style_reference_features() -> list[tuple[ReferenceCatalogEntry, list[float], list[float]]]:
    features = load_style_reference_catalog_features(get_taxonomy_encoder_name())
    SERVICE_STATE["style_catalog_ready"] = True
    return features


@locked_lru_cache(maxsize=4)
def load_style_reference_catalog_features(encoder_name: str) -> list[tuple[ReferenceCatalogEntry, list[float], list[float]]]:
    catalog_path = Path(__file__).resolve().parents[1] / "catalog" / "bonsai_reference_catalog.json"
    raw_entries = json.loads(catalog_path.read_text(encoding="utf-8"))
    adapter = TypeAdapter(list[ReferenceCatalogEntry])
    catalog_entries = adapter.validate_python(raw_entries)
    loaded_entries: list[tuple[ReferenceCatalogEntry, list[float], list[float]]] = []

    for entry in catalog_entries:
        image_path = catalog_path.parent / entry.local_path
        if not image_path.exists():
            continue

        image_bytes = image_path.read_bytes()
        loaded_entries.append(
            (
                entry,
                compute_embedding_backend(image_bytes, encoder_name),
                compute_style_geometry_descriptor(image_bytes),
            )
        )

    return loaded_entries


@locked_lru_cache(maxsize=4)
def load_leaf_reference_catalog_embeddings(encoder_name: str) -> list[tuple[LeafReferenceCatalogEntry, list[float]]]:
    catalog_path = Path(__file__).resolve().parents[1] / "catalog" / "open_license_leaf_index.json"
    if not catalog_path.exists():
        raise RuntimeError(
            "Open-license leaf index is missing. Run scripts/harvest_inaturalist_taxa.py, "
            "scripts/harvest_gbif_taxa.py, and scripts/build_open_license_leaf_index.py first."
        )

    raw_entries = json.loads(catalog_path.read_text(encoding="utf-8"))
    raw_catalog_entries = raw_entries.get("entries") if isinstance(raw_entries, dict) else None
    if not isinstance(raw_catalog_entries, list):
        raise RuntimeError("open_license_leaf_index.json must contain an entries array.")

    adapter = TypeAdapter(list[LeafReferenceCatalogEntry])
    catalog_entries = adapter.validate_python(raw_catalog_entries)
    loaded_entries: list[tuple[LeafReferenceCatalogEntry, list[float]]] = []

    for entry in catalog_entries:
        image_path = catalog_path.parent / entry.local_path
        if not image_path.exists():
            raise RuntimeError(f"Open-license leaf image is missing: {entry.local_path}")

        loaded_entries.append((entry, compute_embedding_backend(image_path.read_bytes(), encoder_name)))

    return loaded_entries


def get_identity_suggestion_score_floor() -> float:
    return float(os.getenv("BONSAI_IDENTITY_SUGGESTION_SCORE_FLOOR", "0.88"))


def get_identity_suggestion_margin() -> float:
    return float(os.getenv("BONSAI_IDENTITY_SUGGESTION_MARGIN", "0.08"))


def get_confident_identity_match_threshold() -> float:
    return float(os.getenv("BONSAI_IDENTITY_CONFIDENT_MATCH_THRESHOLD", "0.94"))


def get_species_uncertainty_floor() -> float:
    return float(os.getenv("BONSAI_SPECIES_TOP1_CONFIDENCE_FLOOR", "0.45"))


def get_style_uncertainty_floor() -> float:
    return float(os.getenv("BONSAI_STYLE_TOP1_CONFIDENCE_FLOOR", "0.40"))


def get_style_geometry_weight() -> float:
    return float(os.getenv("BONSAI_STYLE_GEOMETRY_WEIGHT", "0.40"))


def get_style_prototype_weight() -> float:
    return float(os.getenv("BONSAI_STYLE_PROTOTYPE_WEIGHT", "0.18"))


def get_style_missing_support_penalty() -> float:
    return float(os.getenv("BONSAI_STYLE_MISSING_SUPPORT_PENALTY", "0.08"))


def get_style_double_trunk_bonus() -> float:
    return float(os.getenv("BONSAI_STYLE_DOUBLE_TRUNK_BONUS", "0.12"))


def apply_style_label_prior(score: float, style_label: str, query_style_metrics: StyleGeometryMetrics | None) -> float:
    if query_style_metrics is None:
        return score

    adjusted_score = score

    if not query_style_metrics.has_support_context and style_label in {
        "Growing in rock (Ishisuki)",
        "Growing on rock (Seki-joju)",
    }:
        adjusted_score -= get_style_missing_support_penalty()

    if (
        style_label == "Double trunk (Sokan)"
        and not query_style_metrics.has_support_context
        and 0.12 <= query_style_metrics.lower_peak_count <= 0.30
        and query_style_metrics.top_lower_shift >= 0.025
        and query_style_metrics.aspect_ratio <= 0.70
    ):
        adjusted_score += get_style_double_trunk_bonus()

    return adjusted_score


def get_prediction_gap_floor() -> float:
    return float(os.getenv("BONSAI_PREDICTION_GAP_FLOOR", "0.08"))


def should_recommend_hosted_fallback(
    candidate_matches: list[RecognitionMatch],
    species_predictions: list[Prediction],
    style_predictions: list[Prediction],
    *,
    identity_requested: bool,
    species_requested: bool,
    style_requested: bool,
) -> tuple[bool, str | None]:
    """Recommend the hosted fallback only based on streams that actually ran.

    A stream that was never requested (empty by construction) must not count
    as "uncertain" and must never appear in the fallback reason.
    """
    reasons: list[str] = []

    if species_requested and is_prediction_uncertain(species_predictions, get_species_uncertainty_floor()):
        reasons.append("species suggestions are low-confidence or tightly clustered")

    if style_requested and is_prediction_uncertain(style_predictions, get_style_uncertainty_floor()):
        reasons.append("style suggestions are low-confidence or tightly clustered")

    if identity_requested and (
        not candidate_matches or candidate_matches[0].score < get_identity_suggestion_score_floor()
    ):
        reasons.append("identity matcher found no plausible existing-tree shortlist")

    if not reasons:
        return False, None

    return True, "; ".join(reasons)


def is_prediction_uncertain(predictions: list[Prediction], confidence_floor: float) -> bool:
    if not predictions:
        return True

    top_confidence = predictions[0].confidence
    second_confidence = predictions[1].confidence if len(predictions) > 1 else 0.0
    return top_confidence < confidence_floor or (top_confidence - second_confidence) < get_prediction_gap_floor()


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        return 0.0

    left_vector = np.asarray(left, dtype=np.float32)
    right_vector = np.asarray(right, dtype=np.float32)
    left_norm = np.linalg.norm(left_vector)
    right_norm = np.linalg.norm(right_vector)

    if left_norm == 0 or right_norm == 0:
        return 0.0

    similarity = float(np.dot(left_vector, right_vector) / (left_norm * right_norm))
    return max(min(similarity, 1.0), -1.0)
