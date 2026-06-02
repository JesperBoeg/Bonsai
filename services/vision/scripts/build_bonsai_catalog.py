from __future__ import annotations

import json
import math
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlencode, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw, ImageOps


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 BonsaiCatalog/0.1"
REQUEST_DELAY_SECONDS = 1.5
RETRY_DELAYS_SECONDS = (2.0, 4.0, 8.0)
ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "catalog"
SEED_PATH = CATALOG_DIR / "bonsai_seed_candidates.json"
IMAGES_DIR = CATALOG_DIR / "images"
REVIEW_DIR = CATALOG_DIR / "review"
OUTPUT_PATH = CATALOG_DIR / "bonsai_catalog_candidates.generated.json"


def main() -> None:
    seeds = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    generated: list[dict[str, Any]] = []
    review_images: list[Path] = []

    for seed in seeds:
        metadata = fetch_commons_metadata(seed["page_url"])
        local_path = download_image(seed["id"], metadata["image_url"])
        generated_entry = {
            **seed,
            "file_title": metadata["file_title"],
            "description_url": metadata["description_url"],
            "image_url": metadata["image_url"],
            "license": metadata["license"],
            "artist": metadata["artist"],
            "description": metadata["description"],
            "categories": metadata["categories"],
            "local_path": str(local_path.relative_to(CATALOG_DIR)).replace("\\", "/"),
        }
        generated.append(generated_entry)
        review_images.append(local_path)
        time.sleep(REQUEST_DELAY_SECONDS)

    OUTPUT_PATH.write_text(json.dumps(generated, indent=2, ensure_ascii=False), encoding="utf-8")
    build_contact_sheets(generated)
    print(f"Generated {len(generated)} catalog candidates")
    print(f"Metadata: {OUTPUT_PATH}")
    print(f"Images: {IMAGES_DIR}")
    print(f"Review sheets: {REVIEW_DIR}")


def fetch_commons_metadata(page_url: str) -> dict[str, Any]:
    title = unquote(page_url.rsplit("/", 1)[-1])
    params = {
        "action": "query",
        "titles": title,
        "prop": "imageinfo|info",
        "iiprop": "url|extmetadata",
        "iiurlwidth": "1024",
        "inprop": "url",
        "format": "json",
    }
    api_url = f"https://commons.wikimedia.org/w/api.php?{urlencode(params)}"
    payload = request_json(api_url)

    pages = ((payload.get("query") or {}).get("pages") or {})
    if not pages:
        raise RuntimeError(f"No Commons metadata returned for {page_url}")

    page = next(iter(pages.values()))
    imageinfo = (page.get("imageinfo") or [{}])[0]
    extmetadata = imageinfo.get("extmetadata") or {}
    return {
        "file_title": page.get("title"),
        "description_url": imageinfo.get("descriptionurl") or page_url,
        "image_url": imageinfo.get("thumburl") or imageinfo.get("url"),
        "license": read_extmetadata(extmetadata, "LicenseShortName"),
        "artist": strip_html(read_extmetadata(extmetadata, "Artist")),
        "description": strip_html(read_extmetadata(extmetadata, "ImageDescription")),
        "categories": split_categories(read_extmetadata(extmetadata, "Categories")),
    }


def read_extmetadata(extmetadata: dict[str, Any], key: str) -> str | None:
    record = extmetadata.get(key)
    if not isinstance(record, dict):
        return None
    value = record.get("value")
    return value if isinstance(value, str) and value else None


def split_categories(raw_categories: str | None) -> list[str]:
    if not raw_categories:
        return []
    return [category.strip() for category in raw_categories.split("|") if category.strip()]


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def download_image(entry_id: str, image_url: str) -> Path:
    suffix = Path(urlparse(image_url).path).suffix or ".jpg"
    local_path = IMAGES_DIR / f"{entry_id}{suffix}"
    if local_path.exists():
        return local_path

    local_path.write_bytes(request_bytes(image_url))
    return local_path


def request_json(url: str) -> dict[str, Any]:
    payload = request_bytes(url)
    return json.loads(payload.decode("utf-8"))


def request_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})

    for attempt, retry_delay in enumerate((0.0, *RETRY_DELAYS_SECONDS), start=1):
        if retry_delay > 0:
            time.sleep(retry_delay)

        try:
            with urlopen(request) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 or attempt > len(RETRY_DELAYS_SECONDS):
                raise

    raise RuntimeError(f"Unable to fetch {url}")


def build_contact_sheets(entries: list[dict[str, Any]]) -> None:
    chunk_size = 9
    thumb_size = (280, 220)
    padding = 18
    label_height = 70
    columns = 3

    for index in range(0, len(entries), chunk_size):
        chunk = entries[index:index + chunk_size]
        rows = math.ceil(len(chunk) / columns)
        sheet_width = padding + columns * (thumb_size[0] + padding)
        sheet_height = padding + rows * (thumb_size[1] + label_height + padding)
        sheet = Image.new("RGB", (sheet_width, sheet_height), color=(244, 240, 232))
        draw = ImageDraw.Draw(sheet)

        for chunk_index, entry in enumerate(chunk):
            column = chunk_index % columns
            row = chunk_index // columns
            x = padding + column * (thumb_size[0] + padding)
            y = padding + row * (thumb_size[1] + label_height + padding)

            image_path = CATALOG_DIR / entry["local_path"]
            with Image.open(image_path) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                thumb = ImageOps.contain(image, thumb_size)

            thumb_x = x + (thumb_size[0] - thumb.width) // 2
            thumb_y = y + (thumb_size[1] - thumb.height) // 2
            sheet.paste(thumb, (thumb_x, thumb_y))
            draw.rectangle((x, y, x + thumb_size[0], y + thumb_size[1]), outline=(90, 78, 60), width=1)

            label_y = y + thumb_size[1] + 8
            draw.text((x, label_y), entry["id"], fill=(40, 34, 25))
            species_label = entry.get("species_label") or "species pending"
            style_label = entry.get("style_label") or "style pending"
            draw.text((x, label_y + 18), species_label, fill=(68, 58, 46))
            draw.text((x, label_y + 36), style_label, fill=(68, 58, 46))

        output_name = f"contact_sheet_{index // chunk_size + 1:02d}.jpg"
        sheet.save(REVIEW_DIR / output_name, quality=90)


if __name__ == "__main__":
    main()