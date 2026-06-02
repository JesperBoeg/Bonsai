from __future__ import annotations

import json
from math import ceil
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_PATH = ROOT / "catalog" / "open_license_leaf_candidates.json"
OVERRIDES_PATH = ROOT / "catalog" / "open_license_leaf_review_overrides.json"
REVIEW_DIR = ROOT / "catalog" / "review" / "open_license_leaf"
QUEUE_PATH = REVIEW_DIR / "pending_review_queue.json"
THUMBNAIL_SIZE = 220
TEXT_HEIGHT = 88
PADDING = 20
COLUMNS = 4
ROWS = 3


def main() -> None:
    queue = build_pending_review_queue()
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    QUEUE_PATH.write_text(json.dumps(queue, indent=2), encoding="utf-8")
    build_contact_sheets(queue["entries"])
    print(json.dumps({"output": str(QUEUE_PATH), "entry_count": len(queue["entries"])}, indent=2))


def build_pending_review_queue() -> dict[str, Any]:
    raw_candidates = json.loads(CANDIDATE_PATH.read_text(encoding="utf-8"))
    candidate_entries = raw_candidates.get("entries") if isinstance(raw_candidates, dict) else None
    if not isinstance(candidate_entries, list):
        raise RuntimeError("open_license_leaf_candidates.json must contain an entries array")

    overrides = load_review_overrides()
    approved_ids = set(overrides.get("approved", []))
    rejected_ids = set(overrides.get("rejected", []))

    pending_entries = [
        entry
        for entry in candidate_entries
        if isinstance(entry, dict)
        and str(entry.get("id") or "")
        and str(entry.get("id")) not in approved_ids
        and str(entry.get("id")) not in rejected_ids
        and str(entry.get("reviewStatus") or "pending") == "pending"
    ]
    pending_entries.sort(key=lambda entry: (str(entry.get("sourceName") or ""), str(entry.get("slug") or ""), str(entry.get("id") or "")))

    return {
        "notes": [
            "This queue contains candidate leaf patches that require explicit review before entering the runtime index.",
            "Use open_license_leaf_review_overrides.json to approve or reject specific ids, then rerun build_reviewed_open_license_leaf_index.py.",
        ],
        "entries": pending_entries,
    }


def build_contact_sheets(entries: list[dict[str, Any]]) -> None:
    page_size = COLUMNS * ROWS
    font = ImageFont.load_default()
    page_width = (THUMBNAIL_SIZE + PADDING) * COLUMNS + PADDING
    page_height = (THUMBNAIL_SIZE + TEXT_HEIGHT + PADDING) * ROWS + PADDING

    for index, start in enumerate(range(0, len(entries), page_size), start=1):
        page = Image.new("RGB", (page_width, page_height), color=(245, 245, 245))
        draw = ImageDraw.Draw(page)
        chunk = entries[start:start + page_size]

        for chunk_index, entry in enumerate(chunk):
            column = chunk_index % COLUMNS
            row = chunk_index // COLUMNS
            left = PADDING + column * (THUMBNAIL_SIZE + PADDING)
            top = PADDING + row * (THUMBNAIL_SIZE + TEXT_HEIGHT + PADDING)
            image_path = ROOT / "catalog" / str(entry["localPath"])
            with Image.open(image_path) as preview_image_file:
                preview_image = preview_image_file.convert("RGB")
            preview_image.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE))
            image_left = left + max((THUMBNAIL_SIZE - preview_image.width) // 2, 0)
            image_top = top + max((THUMBNAIL_SIZE - preview_image.height) // 2, 0)
            page.paste(preview_image, (image_left, image_top))
            draw.rectangle((left, top, left + THUMBNAIL_SIZE, top + THUMBNAIL_SIZE), outline=(160, 160, 160), width=1)

            text_top = top + THUMBNAIL_SIZE + 8
            lines = [
                str(entry.get("id") or "")[-32:],
                str(entry.get("slug") or ""),
                f"{entry.get('sourceName')} | score {entry.get('cropScore')}",
                ",".join(str(reason) for reason in entry.get("reviewReasons") or []),
            ]
            for line_index, line in enumerate(lines):
                draw.text((left, text_top + line_index * 16), line[:34], fill=(20, 20, 20), font=font)

        output_path = REVIEW_DIR / f"pending-review-sheet-{index:03d}.jpg"
        page.save(output_path, format="JPEG", quality=92)


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