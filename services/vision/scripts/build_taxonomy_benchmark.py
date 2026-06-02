from __future__ import annotations

from collections import defaultdict
import json
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
BENCHMARK_DIR = ROOT / "benchmark"
OUTPUT_PATH = BENCHMARK_DIR / "taxonomy_splits.json"
SEED = 20260519


def main() -> None:
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    benchmark = build_benchmark_manifest()
    OUTPUT_PATH.write_text(json.dumps(benchmark, indent=2), encoding="utf-8")
    print(f"Wrote taxonomy benchmark splits to {OUTPUT_PATH}")


def build_benchmark_manifest() -> dict[str, object]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {
        "seed": SEED,
        "catalog_count": len(catalog),
        "notes": [
            "Splits are task-specific and tree-disjoint.",
            "A class needs at least 3 trees to support train/validation/test with at least one example per split.",
            "Current identity benchmark is unavailable because the reviewed reference catalog contains one photo per tree.",
        ],
        "species": build_task_split(catalog, "species_label", "use_for_species_eval"),
        "style": build_task_split(catalog, "style_label", "use_for_style_eval"),
        "identity": {
            "available": False,
            "reason": "Each reviewed reference entry is a single-photo tree, so no unseen-photo identity benchmark can be built from this catalog yet.",
        },
    }


def build_task_split(catalog: list[dict[str, object]], label_key: str, eval_flag_key: str) -> dict[str, object]:
    rng = random.Random(f"{SEED}:{label_key}")
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)

    for entry in catalog:
        if not entry.get(eval_flag_key):
            continue
        grouped[str(entry[label_key])].append(entry)

    train_ids: list[str] = []
    validation_ids: list[str] = []
    test_ids: list[str] = []
    eligible_labels: list[dict[str, object]] = []
    excluded_labels: list[dict[str, object]] = []

    for label in sorted(grouped):
        entries = list(grouped[label])
        if len(entries) < 3:
            excluded_labels.append(
                {
                    "label": label,
                    "count": len(entries),
                    "reason": "requires at least 3 trees for train/validation/test",
                    "entry_ids": [str(entry["id"]) for entry in entries],
                }
            )
            continue

        rng.shuffle(entries)
        split_counts = allocate_split_counts(len(entries))
        train_slice = entries[: split_counts["train"]]
        validation_slice = entries[split_counts["train"] : split_counts["train"] + split_counts["validation"]]
        test_slice = entries[-split_counts["test"] :]

        train_ids.extend(str(entry["id"]) for entry in train_slice)
        validation_ids.extend(str(entry["id"]) for entry in validation_slice)
        test_ids.extend(str(entry["id"]) for entry in test_slice)
        eligible_labels.append(
            {
                "label": label,
                "count": len(entries),
                "train_ids": [str(entry["id"]) for entry in train_slice],
                "validation_ids": [str(entry["id"]) for entry in validation_slice],
                "test_ids": [str(entry["id"]) for entry in test_slice],
            }
        )

    return {
        "eligible_label_count": len(eligible_labels),
        "excluded_label_count": len(excluded_labels),
        "eligible_labels": eligible_labels,
        "excluded_labels": excluded_labels,
        "train_ids": sorted(train_ids),
        "validation_ids": sorted(validation_ids),
        "test_ids": sorted(test_ids),
    }


def allocate_split_counts(count: int) -> dict[str, int]:
    if count == 3:
        return {"train": 1, "validation": 1, "test": 1}

    validation_count = max(1, round(count * 0.2))
    test_count = max(1, round(count * 0.2))

    if validation_count + test_count >= count:
        validation_count = 1
        test_count = 1

    train_count = count - validation_count - test_count
    return {"train": train_count, "validation": validation_count, "test": test_count}


if __name__ == "__main__":
    main()