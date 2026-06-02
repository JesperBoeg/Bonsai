from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.build_open_license_leaf_index import (
    CANDIDATE_OUTPUT_PATH,
    build_open_license_leaf_index,
    load_source_manifests,
    load_source_overrides,
    load_source_ranking,
    load_species_program,
)
from scripts.build_reviewed_open_license_leaf_index import OUTPUT_PATH, build_reviewed_open_license_leaf_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh one slug inside the open-license leaf candidate/runtime manifests.")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--max-images-per-species", type=int, default=6)
    parser.add_argument("--cached-only", action="store_true")
    args = parser.parse_args()

    slug = args.slug.strip()
    species_program = [
        entry
        for entry in load_species_program(include_extended=False, include_disabled=False)
        if str(entry.get("slug")) == slug
    ]
    if not species_program:
        raise RuntimeError(f"Unknown or disabled slug: {slug}")

    source_ranking = load_source_ranking()
    refreshed_index = build_open_license_leaf_index(
        species_program,
        source_ranking=source_ranking,
        source_manifests=load_source_manifests(),
        source_overrides=load_source_overrides(),
        max_images_per_species=args.max_images_per_species,
        cached_only=args.cached_only,
    )

    existing_manifest = load_existing_candidate_manifest(source_ranking)
    entries = [
        entry
        for entry in existing_manifest["entries"]
        if isinstance(entry, dict) and str(entry.get("slug")) != slug
    ]
    entries.extend(refreshed_index["entries"])
    existing_manifest["entries"] = entries
    CANDIDATE_OUTPUT_PATH.write_text(json.dumps(existing_manifest, indent=2), encoding="utf-8")

    reviewed_index = build_reviewed_open_license_leaf_index()
    OUTPUT_PATH.write_text(json.dumps(reviewed_index, indent=2), encoding="utf-8")

    runtime_entries_for_slug = [
        entry
        for entry in reviewed_index["entries"]
        if isinstance(entry, dict) and str(entry.get("slug")) == slug
    ]
    print(
        json.dumps(
            {
                "slug": slug,
                "candidateEntryCount": len(existing_manifest["entries"]),
                "runtimeEntryCount": len(reviewed_index["entries"]),
                "slugCandidateIds": [entry["id"] for entry in refreshed_index["entries"] if isinstance(entry, dict) and isinstance(entry.get("id"), str)],
                "slugRuntimeIds": [entry["id"] for entry in runtime_entries_for_slug if isinstance(entry.get("id"), str)],
            }
        )
    )


def load_existing_candidate_manifest(source_ranking: list[dict[str, object]]) -> dict[str, object]:
    if not CANDIDATE_OUTPUT_PATH.exists():
        return {
            "notes": [
                "This is the candidate leaf patch manifest, not the runtime leaf retrieval index.",
                "It is built from cached high-resolution open-license source images, not from crops of the 55-image bonsai validation catalog.",
                "Each runtime entry is a derived leaf patch selected from the source image rather than the raw full image.",
                "Low-resolution assets, herbarium-style sheets, and low-quality leaf patches are filtered out during candidate construction.",
                "Suspicious but potentially usable patches are marked pending review instead of being sent straight into the runtime index.",
                "iNaturalist is the primary source; GBIF is only secondary backfill when iNaturalist coverage is weak.",
            ],
            "sourceRanking": source_ranking,
            "entries": [],
        }

    raw_value = json.loads(CANDIDATE_OUTPUT_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_value, dict):
        raise RuntimeError("open_license_leaf_candidates.json must contain a JSON object")

    entries = raw_value.get("entries")
    if not isinstance(entries, list):
        raise RuntimeError("open_license_leaf_candidates.json must contain an entries array")

    return {
        "notes": raw_value.get("notes", []),
        "sourceRanking": source_ranking,
        "entries": entries,
    }


if __name__ == "__main__":
    main()