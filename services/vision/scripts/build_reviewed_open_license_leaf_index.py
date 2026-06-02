from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_PATH = ROOT / "catalog" / "open_license_leaf_candidates.json"
OVERRIDES_PATH = ROOT / "catalog" / "open_license_leaf_review_overrides.json"
OUTPUT_PATH = ROOT / "catalog" / "open_license_leaf_index.json"


def main() -> None:
    reviewed_index = build_reviewed_open_license_leaf_index()
    OUTPUT_PATH.write_text(json.dumps(reviewed_index, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT_PATH), "entry_count": len(reviewed_index["entries"])}, indent=2))


def build_reviewed_open_license_leaf_index() -> dict[str, Any]:
    raw_candidates = json.loads(CANDIDATE_PATH.read_text(encoding="utf-8"))
    candidate_entries = raw_candidates.get("entries") if isinstance(raw_candidates, dict) else None
    if not isinstance(candidate_entries, list):
        raise RuntimeError("open_license_leaf_candidates.json must contain an entries array")

    overrides = load_review_overrides()
    approved_ids = set(overrides.get("approved", []))
    rejected_ids = set(overrides.get("rejected", []))

    reviewed_entries: list[dict[str, Any]] = []
    for entry in candidate_entries:
        if not isinstance(entry, dict):
            continue

        entry_id = str(entry.get("id") or "")
        if not entry_id or entry_id in rejected_ids:
            continue

        review_status = str(entry.get("reviewStatus") or "pending")
        if review_status == "auto-approved" or entry_id in approved_ids:
            reviewed_entry = dict(entry)
            reviewed_entry["reviewStatus"] = "approved" if entry_id in approved_ids else "auto-approved"
            reviewed_entries.append(reviewed_entry)

    return {
        "notes": [
            "This is the runtime leaf retrieval index used by /recognize-leaf.",
            "Entries appear here only if they were auto-approved by the candidate builder or explicitly approved in open_license_leaf_review_overrides.json.",
            "Pending and rejected candidate patches are excluded from the runtime index.",
        ],
        "sourceRanking": raw_candidates.get("sourceRanking", []),
        "entries": reviewed_entries,
    }


def load_review_overrides() -> dict[str, list[str]]:
    if not OVERRIDES_PATH.exists():
        return {"approved": [], "rejected": []}

    raw_value = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_value, dict):
        return {"approved": [], "rejected": []}

    approved = [str(entry) for entry in raw_value.get("approved", []) if isinstance(entry, str)]
    rejected = [str(entry) for entry in raw_value.get("rejected", []) if isinstance(entry, str)]
    return {"approved": approved, "rejected": rejected}


if __name__ == "__main__":
    main()