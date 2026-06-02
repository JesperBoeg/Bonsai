from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

from app.encoders import DINOV2_BACKEND, PIXEL_BACKEND, compute_embedding_backend
from app.main import ReferenceCatalogEntry, canonicalize_species_label, cosine_similarity
from app.style_geometry import blend_style_similarity, compute_style_geometry_descriptor, cosine_similarity as geometry_cosine_similarity
from scripts.build_taxonomy_benchmark import OUTPUT_PATH as SPLIT_OUTPUT_PATH, build_benchmark_manifest


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
BENCHMARK_DIR = ROOT / "benchmark"
RESULTS_PATH = BENCHMARK_DIR / "taxonomy_benchmark_results.json"
SUPPORTED_ENCODERS = (PIXEL_BACKEND, DINOV2_BACKEND)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Bonsai taxonomy benchmark with deterministic unseen-tree splits.")
    parser.add_argument("--encoder", choices=["pixel", "dinov2", "all"], default="all")
    args = parser.parse_args()

    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    if not SPLIT_OUTPUT_PATH.exists():
        SPLIT_OUTPUT_PATH.write_text(json.dumps(build_benchmark_manifest(), indent=2), encoding="utf-8")

    split_manifest = json.loads(SPLIT_OUTPUT_PATH.read_text(encoding="utf-8"))
    catalog = load_catalog_lookup()
    encoder_names = resolve_requested_encoders(args.encoder)
    results = {
        "split_manifest": str(SPLIT_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
        "encoders": {
            encoder_name: evaluate_encoder(catalog, split_manifest, encoder_name) for encoder_name in encoder_names
        },
    }
    RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


def resolve_requested_encoders(raw_value: str) -> list[str]:
    if raw_value == "pixel":
        return [PIXEL_BACKEND]
    if raw_value == "dinov2":
        return [DINOV2_BACKEND]
    return list(SUPPORTED_ENCODERS)


def load_catalog_lookup() -> dict[str, ReferenceCatalogEntry]:
    raw_entries = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {str(entry["id"]): ReferenceCatalogEntry.model_validate(entry) for entry in raw_entries}


def evaluate_encoder(
    catalog_lookup: dict[str, ReferenceCatalogEntry],
    split_manifest: dict[str, object],
    encoder_name: str,
) -> dict[str, object]:
    reference_embeddings = load_embeddings(catalog_lookup, encoder_name)
    style_descriptors = load_style_descriptors(catalog_lookup)
    geometry_weight = select_style_geometry_weight(catalog_lookup, split_manifest["style"], reference_embeddings, style_descriptors)
    return {
        "encoder": encoder_name,
        "style_geometry_weight": geometry_weight,
        "species": evaluate_task(catalog_lookup, split_manifest["species"], reference_embeddings, "species"),
        "style": evaluate_task(
            catalog_lookup,
            split_manifest["style"],
            reference_embeddings,
            "style",
            style_descriptors=style_descriptors,
            geometry_weight=geometry_weight,
        ),
        "identity": split_manifest["identity"],
    }


def load_embeddings(catalog_lookup: dict[str, ReferenceCatalogEntry], encoder_name: str) -> dict[str, list[float]]:
    embeddings: dict[str, list[float]] = {}

    for entry_id, entry in catalog_lookup.items():
        image_path = CATALOG_PATH.parent / entry.local_path
        embeddings[entry_id] = compute_embedding_backend(image_path.read_bytes(), encoder_name)

    return embeddings


def load_style_descriptors(catalog_lookup: dict[str, ReferenceCatalogEntry]) -> dict[str, list[float]]:
    descriptors: dict[str, list[float]] = {}

    for entry_id, entry in catalog_lookup.items():
        image_path = CATALOG_PATH.parent / entry.local_path
        descriptors[entry_id] = compute_style_geometry_descriptor(image_path.read_bytes())

    return descriptors


def evaluate_task(
    catalog_lookup: dict[str, ReferenceCatalogEntry],
    task_manifest: dict[str, object],
    reference_embeddings: dict[str, list[float]],
    taxonomy: str,
    style_descriptors: dict[str, list[float]] | None = None,
    geometry_weight: float = 0.0,
) -> dict[str, object]:
    train_ids = [str(entry_id) for entry_id in task_manifest["train_ids"]]
    validation_ids = [str(entry_id) for entry_id in task_manifest["validation_ids"]]
    test_ids = [str(entry_id) for entry_id in task_manifest["test_ids"]]

    return {
        "train_count": len(train_ids),
        "validation_count": len(validation_ids),
        "test_count": len(test_ids),
        "eligible_label_count": task_manifest["eligible_label_count"],
        "excluded_label_count": task_manifest["excluded_label_count"],
        "validation": score_split(
            catalog_lookup,
            reference_embeddings,
            train_ids,
            validation_ids,
            taxonomy,
            style_descriptors=style_descriptors,
            geometry_weight=geometry_weight,
        ),
        "test": score_split(
            catalog_lookup,
            reference_embeddings,
            train_ids,
            test_ids,
            taxonomy,
            style_descriptors=style_descriptors,
            geometry_weight=geometry_weight,
        ),
    }


def score_split(
    catalog_lookup: dict[str, ReferenceCatalogEntry],
    reference_embeddings: dict[str, list[float]],
    train_ids: list[str],
    query_ids: list[str],
    taxonomy: str,
    style_descriptors: dict[str, list[float]] | None = None,
    geometry_weight: float = 0.0,
) -> dict[str, object]:
    failures: list[dict[str, object]] = []
    top1_correct = 0
    top3_correct = 0

    for entry_id in query_ids:
        entry = catalog_lookup[entry_id]
        expected_label = canonicalize_species_label(entry.species_label) if taxonomy == "species" else entry.style_label
        ranked_matches = []

        for train_id in train_ids:
            train_entry = catalog_lookup[train_id]
            embedding_score = cosine_similarity(reference_embeddings[entry_id], reference_embeddings[train_id])
            score = embedding_score

            if taxonomy == "style" and style_descriptors is not None and geometry_weight > 0:
                geometry_score = geometry_cosine_similarity(style_descriptors[entry_id], style_descriptors[train_id])
                score = blend_style_similarity(embedding_score, geometry_score, geometry_weight)

            ranked_matches.append(
                {
                    "id": train_id,
                    "species_label": train_entry.species_label,
                    "style_label": train_entry.style_label,
                    "score": score,
                }
            )

        ranked_matches.sort(key=lambda match: match["score"], reverse=True)
        predictions = rank_predictions_from_matches(ranked_matches[:5], taxonomy)
        labels = [prediction["label"] for prediction in predictions]

        if labels[:1] == [expected_label]:
            top1_correct += 1
        if expected_label in labels[:3]:
            top3_correct += 1
        else:
            failures.append(
                {
                    "id": entry_id,
                    "expected": expected_label,
                    "predicted": labels[:3],
                    "top_matches": [
                        {
                            "id": match["id"],
                            "label": match["species_label"] if taxonomy == "species" else match["style_label"],
                            "score": round(match["score"], 6),
                        }
                        for match in ranked_matches[:3]
                    ],
                }
            )

    total = len(query_ids)
    return {
        "count": total,
        "top1_accuracy": round(top1_correct / total, 4) if total else None,
        "top3_accuracy": round(top3_correct / total, 4) if total else None,
        "first_top3_failures": failures[:5],
    }


def select_style_geometry_weight(
    catalog_lookup: dict[str, ReferenceCatalogEntry],
    style_manifest: dict[str, object],
    reference_embeddings: dict[str, list[float]],
    style_descriptors: dict[str, list[float]],
) -> float:
    candidate_weights = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    train_ids = [str(entry_id) for entry_id in style_manifest["train_ids"]]
    validation_ids = [str(entry_id) for entry_id in style_manifest["validation_ids"]]
    best_weight = 0.0
    best_score = (-1.0, -1.0, 0.0)

    for weight in candidate_weights:
        result = score_split(
            catalog_lookup,
            reference_embeddings,
            train_ids,
            validation_ids,
            "style",
            style_descriptors=style_descriptors,
            geometry_weight=weight,
        )
        score = (
            float(result["top3_accuracy"] or 0.0),
            float(result["top1_accuracy"] or 0.0),
            -weight,
        )
        if score > best_score:
            best_score = score
            best_weight = weight

    return best_weight


def rank_predictions_from_matches(matches: list[dict[str, object]], taxonomy: str) -> list[dict[str, object]]:
    aggregate_scores: dict[str, float] = defaultdict(float)

    for index, match in enumerate(matches):
        label = str(match["species_label"] if taxonomy == "species" else match["style_label"])
        if taxonomy == "species":
            label = canonicalize_species_label(label)
        score = float(match["score"])
        rank_weight = 1.0 / (index + 1)
        aggregate_scores[label] += max(score, 0.0) * rank_weight

    if not aggregate_scores:
        return []

    total_score = sum(aggregate_scores.values())
    predictions = [
        {
            "label": label,
            "confidence": round(score / total_score, 6) if total_score > 0 else 0.0,
        }
        for label, score in aggregate_scores.items()
    ]
    predictions.sort(key=lambda prediction: prediction["confidence"], reverse=True)
    return predictions[:3]


if __name__ == "__main__":
    main()