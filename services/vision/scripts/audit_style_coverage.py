from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
BENCHMARK_DIR = ROOT / "benchmark"
OUTPUT_PATH = BENCHMARK_DIR / "style_coverage_audit.json"
MIN_TREES_PER_STYLE = 3


def main() -> None:
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    audit = build_style_coverage_audit()
    OUTPUT_PATH.write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=2))


def build_style_coverage_audit() -> dict[str, object]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)

    for entry in catalog:
        if not entry.get("use_for_style_eval"):
            continue
        grouped[str(entry["style_label"])] .append(entry)

    eligible_labels: list[dict[str, object]] = []
    unsupported_labels: list[dict[str, object]] = []
    total_additional_trees_required = 0

    for label in sorted(grouped):
        entries = grouped[label]
        current_count = len(entries)
        current_entry_ids = [str(entry["id"]) for entry in entries]
        additional_trees_required = max(0, MIN_TREES_PER_STYLE - current_count)

        label_summary = {
            "label": label,
            "current_reviewed_tree_count": current_count,
            "current_entry_ids": current_entry_ids,
            "minimum_additional_distinct_trees_required": additional_trees_required,
        }

        if additional_trees_required == 0:
            eligible_labels.append(label_summary)
        else:
            total_additional_trees_required += additional_trees_required
            unsupported_labels.append(label_summary)

    unsupported_labels.sort(
        key=lambda item: (
            int(item["minimum_additional_distinct_trees_required"]),
            str(item["label"]),
        )
    )

    return {
        "style_label_count": len(grouped),
        "eligible_style_label_count": len(eligible_labels),
        "unsupported_style_label_count": len(unsupported_labels),
        "minimum_total_additional_distinct_trees_required": total_additional_trees_required,
        "notes": [
            "Current reviewed style benchmark requires at least 3 distinct trees per style label.",
            "Because the reviewed catalog currently has one image per tree, each additional reviewed image must come from a different tree to improve benchmark eligibility.",
        ],
        "eligible_labels": eligible_labels,
        "unsupported_labels": unsupported_labels,
    }


if __name__ == "__main__":
    main()