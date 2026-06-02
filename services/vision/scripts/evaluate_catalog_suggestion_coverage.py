from __future__ import annotations

import json
from pathlib import Path

from app.main import (
    canonicalize_species_label,
    compute_taxonomy_embedding,
    rank_reference_catalog_matches,
    rank_reference_predictions,
    rank_style_reference_catalog_matches,
)
from app.style_geometry import compute_style_geometry_descriptor, compute_style_geometry_metrics


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
BENCHMARK_DIR = ROOT / "benchmark"
OUTPUT_PATH = BENCHMARK_DIR / "catalog_suggestion_coverage.json"


def main() -> None:
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    result = evaluate_catalog_suggestion_coverage()
    OUTPUT_PATH.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


def evaluate_catalog_suggestion_coverage() -> dict[str, object]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    species_failures: list[dict[str, object]] = []
    style_failures: list[dict[str, object]] = []
    species_hits = 0
    style_hits = 0

    for entry in catalog:
        image_bytes = (ROOT / "catalog" / str(entry["local_path"])).read_bytes()
        taxonomy_embedding = compute_taxonomy_embedding(image_bytes)
        style_geometry_descriptor = compute_style_geometry_descriptor(image_bytes)
        style_geometry_metrics = compute_style_geometry_metrics(image_bytes)

        species_predictions = rank_reference_predictions(rank_reference_catalog_matches(taxonomy_embedding, "species"), "species")
        style_predictions = rank_reference_predictions(
            rank_style_reference_catalog_matches(taxonomy_embedding, style_geometry_descriptor, query_style_metrics=style_geometry_metrics),
            "style",
        )

        species_labels = [prediction.label for prediction in species_predictions]
        style_labels = [prediction.label for prediction in style_predictions]
        expected_species_label = canonicalize_species_label(str(entry["species_label"]))

        if expected_species_label in species_labels[:3]:
            species_hits += 1
        else:
            species_failures.append(
                {
                    "id": str(entry["id"]),
                    "expected": expected_species_label,
                    "expected_raw": str(entry["species_label"]),
                    "predicted": species_labels[:3],
                }
            )

        if str(entry["style_label"]) in style_labels[:3]:
            style_hits += 1
        else:
            style_failures.append(
                {
                    "id": str(entry["id"]),
                    "expected": str(entry["style_label"]),
                    "predicted": style_labels[:3],
                }
            )

    total = len(catalog)
    return {
        "catalog_count": total,
        "notes": [
            "This evaluation scores each reviewed catalog image against the full reviewed catalog, so the query image is present in the reference pool.",
            "This is a product-acceptance coverage check for the current 55-image suggestion set, not a replacement for honest holdout evaluation.",
        ],
        "species": {
            "top3_hits": species_hits,
            "top3_accuracy": round(species_hits / total, 4) if total else None,
            "failures": species_failures,
        },
        "style": {
            "top3_hits": style_hits,
            "top3_accuracy": round(style_hits / total, 4) if total else None,
            "failures": style_failures,
        },
    }


if __name__ == "__main__":
    main()