from __future__ import annotations

"""Validation-only synthetic leaf crop builder.

This script derives crops from the reviewed 55-image bonsai catalog so the repo can
smoke-test leaf retrieval behavior on a tiny internal set. It is not the production
leaf ingestion path and should not be treated as the base species engine.

By default it uses the locally reviewed catalog images so the validation set can be
rebuilt deterministically without depending on Wikimedia rate limits.
"""

import argparse
import json
from math import ceil, floor
from pathlib import Path
from time import sleep
from urllib.parse import quote, unquote, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

from app.style_geometry import compute_foreground_mask, downsample_image


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
SOURCE_DIR = ROOT / "catalog" / "leaves" / "source"
LEAF_DIR = ROOT / "catalog" / "leaves" / "generated"
OUTPUT_PATH = ROOT / "catalog" / "leaf_reference_catalog.json"
LEAF_CROPS_PER_IMAGE = 6
WORKING_MAX_DIMENSION = 1024
OUTPUT_MAX_DIMENSION = 768
HTTP_USER_AGENT = "BonsaiLeafCatalog/1.0"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the validation-only leaf reference catalog.")
    parser.add_argument("--use-wikimedia-originals", action="store_true")
    args = parser.parse_args()

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    LEAF_DIR.mkdir(parents=True, exist_ok=True)
    clear_directory(LEAF_DIR)
    manifest = build_leaf_reference_catalog(use_wikimedia_originals=args.use_wikimedia_originals)
    OUTPUT_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT_PATH), "count": len(manifest)}, indent=2))


def build_leaf_reference_catalog(*, use_wikimedia_originals: bool = False) -> list[dict[str, object]]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    manifest: list[dict[str, object]] = []

    for entry in catalog:
        source_image, source_origin = load_source_image(entry, use_wikimedia_originals=use_wikimedia_originals)
        working_image = downsample_image(source_image, max_dimension=WORKING_MAX_DIMENSION)
        working_image_array = np.asarray(working_image, dtype=np.float32) / 255.0
        mask = compute_foreground_mask(working_image_array)
        crops = select_leaf_crops(working_image_array, mask)
        scale_x = source_image.width / max(working_image.width, 1)
        scale_y = source_image.height / max(working_image.height, 1)

        for crop_index, crop in enumerate(crops, start=1):
            crop_id = f"{entry['id']}-leaf-{crop_index:02d}"
            crop_filename = f"{crop_id}.png"
            crop_path = LEAF_DIR / crop_filename
            source_box = scale_box(crop["box"], scale_x, scale_y, source_image.width, source_image.height)
            crop_image = source_image.crop(tuple(source_box))
            crop_image = downsample_image(crop_image, max_dimension=OUTPUT_MAX_DIMENSION)
            crop_image.save(crop_path)
            manifest.append(
                {
                    "id": crop_id,
                    "local_path": f"leaves/generated/{crop_filename}",
                    "source_entry_id": str(entry["id"]),
                    "source_page_url": str(entry["source_page_url"]),
                    "species_label": str(entry["species_label"]),
                    "source_origin": source_origin,
                    "source_image_size": [source_image.width, source_image.height],
                    "saved_image_size": [crop_image.width, crop_image.height],
                    "crop_index": crop_index,
                    "crop_box": source_box,
                    "working_crop_box": crop["box"],
                    "crop_score": round(float(crop["score"]), 6),
                }
            )

    return manifest


def clear_directory(directory: Path) -> None:
    for path in directory.glob("*"):
        if path.is_file():
            path.unlink()


def load_source_image(entry: dict[str, object], *, use_wikimedia_originals: bool) -> tuple[Image.Image, str]:
    source_page_url = str(entry["source_page_url"])
    source_domain = urlparse(source_page_url).netloc.lower()

    if use_wikimedia_originals and source_domain == "commons.wikimedia.org":
        source_path = download_wikimedia_original(str(entry["id"]), source_page_url)
        return Image.open(source_path).convert("RGB"), "wikimedia-original"

    local_path = CATALOG_PATH.parent / str(entry["local_path"])
    return Image.open(local_path).convert("RGB"), "catalog-local"


def download_wikimedia_original(entry_id: str, source_page_url: str) -> Path:
    cached_paths = sorted(SOURCE_DIR.glob(f"{entry_id}.*"))
    if cached_paths:
        return cached_paths[0]

    file_title = extract_wikimedia_file_title(source_page_url)
    api_url = (
        "https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo"
        "&iiprop=url|size&format=json&titles="
        f"{quote(file_title, safe=':')}"
    )
    payload = json.loads(read_remote_bytes(api_url).decode("utf-8"))
    page = next(iter(payload["query"]["pages"].values()))
    image_info = page.get("imageinfo")
    if not image_info:
        raise RuntimeError(f"Missing imageinfo for {file_title}")

    original_url = str(image_info[0]["url"])
    suffix = Path(urlparse(original_url).path).suffix.lower() or ".jpg"
    target_path = SOURCE_DIR / f"{entry_id}{suffix}"
    target_path.write_bytes(read_remote_bytes(original_url))
    return target_path


def extract_wikimedia_file_title(source_page_url: str) -> str:
    parsed = urlparse(source_page_url)
    prefix = "/wiki/"
    if not parsed.path.startswith(prefix):
        raise RuntimeError(f"Unsupported Wikimedia source page: {source_page_url}")
    return unquote(parsed.path[len(prefix):]).replace("_", " ")


def read_remote_bytes(url: str) -> bytes:
    for attempt in range(5):
        request = Request(url, headers={"User-Agent": HTTP_USER_AGENT})
        try:
            with urlopen(request, timeout=60) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            sleep(1.5 * (attempt + 1))

    raise RuntimeError(f"Failed to download remote asset: {url}")


def select_leaf_crops(image: np.ndarray, mask: np.ndarray) -> list[dict[str, object]]:
    height, width, _ = image.shape
    gray = image.mean(axis=2)
    saturation = image.max(axis=2) - image.min(axis=2)
    texture = compute_texture(gray)
    min_dimension = min(height, width)
    crop_sizes = sorted({
        max(96, round(min_dimension * 0.12)),
        max(128, round(min_dimension * 0.16)),
        max(160, round(min_dimension * 0.20)),
    })
    candidates: list[dict[str, object]] = []
    minimum_output_box = max(128, round(min_dimension * 0.18))

    for crop_size in crop_sizes:
        step = max(18, crop_size // 4)
        max_row = max(0, round(height * 0.82) - crop_size)
        max_column = max(0, width - crop_size)

        for top in range(0, max_row + 1, step):
            for left in range(0, max_column + 1, step):
                bottom = top + crop_size
                right = left + crop_size
                mask_crop = mask[top:bottom, left:right]
                if mask_crop.size == 0:
                    continue

                foreground_ratio = float(mask_crop.mean())
                saturation_mean = float(saturation[top:bottom, left:right].mean())
                texture_mean = float(texture[top:bottom, left:right].mean())
                darkness_ratio = float((gray[top:bottom, left:right] < 0.24).mean())
                top_bias = 1.0 - (((top + crop_size / 2) / max(height, 1)) ** 1.2)
                score = (
                    (foreground_ratio * 0.45)
                    + (saturation_mean * 0.20)
                    + (texture_mean * 0.25)
                    + (top_bias * 0.20)
                    - (darkness_ratio * 0.15)
                )

                candidates.append(
                    {
                        "box": [left, top, right, bottom],
                        "score": score,
                    }
                )

    candidates.sort(key=lambda candidate: float(candidate["score"]), reverse=True)
    selected: list[dict[str, object]] = []

    for candidate in candidates:
        expanded_box = expand_box(
            candidate["box"],
            image_width=width,
            image_height=height,
            expansion=1.35,
            minimum_size=minimum_output_box,
        )
        if all(compute_iou(expanded_box, existing["box"]) < 0.45 for existing in selected):
            selected.append(
                {
                    "box": expanded_box,
                    "score": candidate["score"],
                }
            )
        if len(selected) == LEAF_CROPS_PER_IMAGE:
            break

    return selected


def expand_box(
    box: list[int],
    image_width: int,
    image_height: int,
    expansion: float,
    minimum_size: int,
) -> list[int]:
    left, top, right, bottom = box
    box_width = right - left
    box_height = bottom - top
    target_size = max(minimum_size, round(max(box_width, box_height) * expansion))
    target_size = min(target_size, image_width, image_height)

    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    new_left = floor(center_x - (target_size / 2.0))
    new_top = floor(center_y - (target_size / 2.0))
    new_left = min(max(new_left, 0), max(image_width - target_size, 0))
    new_top = min(max(new_top, 0), max(image_height - target_size, 0))
    new_right = min(new_left + target_size, image_width)
    new_bottom = min(new_top + target_size, image_height)
    return [new_left, new_top, new_right, new_bottom]


def scale_box(box: list[int], scale_x: float, scale_y: float, image_width: int, image_height: int) -> list[int]:
    left = min(max(floor(box[0] * scale_x), 0), max(image_width - 1, 0))
    top = min(max(floor(box[1] * scale_y), 0), max(image_height - 1, 0))
    right = min(max(ceil(box[2] * scale_x), left + 1), image_width)
    bottom = min(max(ceil(box[3] * scale_y), top + 1), image_height)
    return [left, top, right, bottom]


def compute_texture(gray: np.ndarray) -> np.ndarray:
    gradient_vertical = np.abs(np.diff(gray, axis=0, append=gray[-1:, :]))
    gradient_horizontal = np.abs(np.diff(gray, axis=1, append=gray[:, -1:]))
    texture = gradient_vertical + gradient_horizontal
    max_value = float(texture.max())
    if max_value <= 0:
        return texture
    return texture / max_value


def compute_iou(left_box: list[int], right_box: list[int]) -> float:
    left_left, left_top, left_right, left_bottom = left_box
    right_left, right_top, right_right, right_bottom = right_box
    intersection_left = max(left_left, right_left)
    intersection_top = max(left_top, right_top)
    intersection_right = min(left_right, right_right)
    intersection_bottom = min(left_bottom, right_bottom)

    if intersection_left >= intersection_right or intersection_top >= intersection_bottom:
        return 0.0

    intersection_area = (intersection_right - intersection_left) * (intersection_bottom - intersection_top)
    left_area = (left_right - left_left) * (left_bottom - left_top)
    right_area = (right_right - right_left) * (right_bottom - right_top)
    union_area = left_area + right_area - intersection_area
    return intersection_area / max(union_area, 1)


if __name__ == "__main__":
    main()