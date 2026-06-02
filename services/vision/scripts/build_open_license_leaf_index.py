from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

from app.style_geometry import compute_foreground_mask, downsample_image


ROOT = Path(__file__).resolve().parents[1]
SPECIES_PROGRAM_PATH = ROOT / "catalog" / "species_program.json"
SOURCE_RANKING_PATH = ROOT / "catalog" / "open_license_source_ranking.json"
INATURALIST_MANIFEST_PATH = ROOT / "catalog" / "inaturalist_reference_candidates.json"
GBIF_MANIFEST_PATH = ROOT / "catalog" / "gbif_reference_candidates.json"
CANDIDATE_OUTPUT_PATH = ROOT / "catalog" / "open_license_leaf_candidates.json"
SOURCE_OVERRIDES_PATH = ROOT / "catalog" / "open_license_leaf_source_overrides.json"
SOURCE_CACHE_DIR = ROOT / "catalog" / "open_license_source_images"
PATCH_CACHE_DIR = ROOT / "catalog" / "open_license_leaf_patches"
USER_AGENT = "BonsaiOpenLicenseLeafIndex/0.1"
WORKING_MAX_DIMENSION = 1536
OUTPUT_MAX_DIMENSION = 1024
LEAF_CROPS_PER_IMAGE = 4
MIN_SOURCE_MAX_DIMENSION = 960
MIN_CROP_DIMENSION = 300
MIN_CROP_SCORE = 0.18
HERBARIUM_BRIGHT_NEUTRAL_RATIO = 0.45
HERBARIUM_SATURATION_THRESHOLD = 0.08
MAX_PATCH_BRIGHT_NEUTRAL_RATIO = 0.25
MIN_PATCH_SATURATION = 0.10
MAX_PATCH_DARK_RATIO = 0.55
AUTO_APPROVE_CROP_SCORE = 0.26
AUTO_APPROVE_MIN_MEAN_SATURATION = 0.12
AUTO_APPROVE_MIN_GREENISH_RATIO = 0.12
AUTO_APPROVE_MAX_BRIGHT_NEUTRAL_RATIO = 0.10
AUTO_APPROVE_MIN_CROP_AREA_RATIO = 0.035


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the cached open-license leaf retrieval index used by /recognize-leaf.")
    parser.add_argument("--max-images-per-species", type=int, default=8)
    parser.add_argument("--include-extended", action="store_true")
    parser.add_argument("--include-disabled", action="store_true")
    parser.add_argument("--cached-only", action="store_true")
    parser.add_argument("--slugs", nargs="*", default=[])
    args = parser.parse_args()

    species_program = load_species_program(include_extended=args.include_extended, include_disabled=args.include_disabled)
    if args.slugs:
        requested_slugs = {slug.strip() for slug in args.slugs if slug.strip()}
        species_program = [entry for entry in species_program if entry["slug"] in requested_slugs]

    source_ranking = load_source_ranking()
    source_manifests = load_source_manifests()
    source_overrides = load_source_overrides()
    index = build_open_license_leaf_index(
        species_program,
        source_ranking=source_ranking,
        source_manifests=source_manifests,
        source_overrides=source_overrides,
        max_images_per_species=args.max_images_per_species,
        cached_only=args.cached_only,
    )
    CANDIDATE_OUTPUT_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(CANDIDATE_OUTPUT_PATH), "entry_count": len(index["entries"])}, indent=2))


def load_species_program(*, include_extended: bool, include_disabled: bool) -> list[dict[str, Any]]:
    raw_entries = json.loads(SPECIES_PROGRAM_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_entries, list):
        raise RuntimeError("species_program.json must contain a JSON array")

    selected_entries: list[dict[str, Any]] = []
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            continue
        if raw_entry.get("catalogTier") == "extended" and not include_extended:
            continue
        if not raw_entry.get("recognitionEnabled", True) and not include_disabled:
            continue
        selected_entries.append(raw_entry)
    return selected_entries


def load_source_ranking() -> list[dict[str, Any]]:
    raw_value = json.loads(SOURCE_RANKING_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_value, list):
        raise RuntimeError("open_license_source_ranking.json must contain a JSON array")

    entries = [entry for entry in raw_value if isinstance(entry, dict)]
    entries.sort(key=lambda entry: int(entry.get("priority") or 999))
    return entries


def load_source_manifests() -> dict[str, dict[str, dict[str, Any]]]:
    manifests: dict[str, dict[str, dict[str, Any]]] = {}
    for source_name, manifest_path in (("inaturalist", INATURALIST_MANIFEST_PATH), ("gbif", GBIF_MANIFEST_PATH)):
        if not manifest_path.exists():
            manifests[source_name] = {}
            continue

        raw_value = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = raw_value.get("entries") if isinstance(raw_value, dict) else None
        if not isinstance(entries, list):
            manifests[source_name] = {}
            continue

        manifests[source_name] = {
            str(entry.get("slug")): entry
            for entry in entries
            if isinstance(entry, dict) and isinstance(entry.get("slug"), str)
        }

    return manifests


def load_source_overrides() -> dict[str, Any]:
    if not SOURCE_OVERRIDES_PATH.exists():
        return {"excludedSourceImages": set(), "manualCropBoxes": {}}

    raw_value = json.loads(SOURCE_OVERRIDES_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_value, dict):
        return {"excludedSourceImages": set(), "manualCropBoxes": {}}

    excluded_source_images: set[str] = set()
    for raw_entry in raw_value.get("excludedSourceImages", []):
        source_asset_id = parse_source_override_asset_id(raw_entry)
        if source_asset_id is not None:
            excluded_source_images.add(source_asset_id)

    manual_crop_boxes: dict[str, list[int]] = {}
    for raw_entry in raw_value.get("manualCropBoxes", []):
        if not isinstance(raw_entry, dict):
            continue
        source_asset_id = parse_source_override_asset_id(raw_entry)
        crop_box = normalize_manual_crop_box(raw_entry.get("cropBox"))
        if source_asset_id is None or crop_box is None:
            continue
        manual_crop_boxes[source_asset_id] = crop_box

    return {
        "excludedSourceImages": excluded_source_images,
        "manualCropBoxes": manual_crop_boxes,
    }


def parse_source_override_asset_id(raw_entry: Any) -> str | None:
    if not isinstance(raw_entry, dict):
        return None

    source_name = raw_entry.get("sourceName")
    slug = raw_entry.get("slug")
    external_id = raw_entry.get("externalId")
    if not isinstance(source_name, str) or not source_name.strip():
        return None
    if not isinstance(slug, str) or not slug.strip():
        return None
    if external_id is None:
        return None
    return build_source_asset_id(source_name.strip(), slug.strip(), external_id)


def build_open_license_leaf_index(
    species_program: list[dict[str, Any]],
    *,
    source_ranking: list[dict[str, Any]],
    source_manifests: dict[str, dict[str, dict[str, Any]]],
    source_overrides: dict[str, Any] | None = None,
    max_images_per_species: int,
    cached_only: bool = False,
) -> dict[str, Any]:
    SOURCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    PATCH_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []
    excluded_source_images = set((source_overrides or {}).get("excludedSourceImages", []))
    manual_crop_boxes = dict((source_overrides or {}).get("manualCropBoxes", {}))

    for species_entry in species_program:
        selected_count = 0
        seen_remote_urls: set[str] = set()

        for source_entry in source_ranking:
            if selected_count >= max_images_per_species:
                break

            source_name = str(source_entry.get("source") or "")
            source_priority = int(source_entry.get("priority") or 999)
            manifest_entry = source_manifests.get(source_name, {}).get(str(species_entry.get("slug")))
            if not manifest_entry:
                continue

            for candidate_photo in manifest_entry.get("candidatePhotos") or []:
                if selected_count >= max_images_per_species:
                    break
                if not isinstance(candidate_photo, dict):
                    continue

                source_asset_id = build_source_asset_id_for_candidate(source_name, str(species_entry["slug"]), candidate_photo)
                if source_asset_id in excluded_source_images:
                    continue

                remote_url = read_candidate_image_url(candidate_photo)
                if not remote_url or remote_url in seen_remote_urls:
                    continue

                source_image_path = cache_remote_image(
                    source_name,
                    str(species_entry["slug"]),
                    candidate_photo,
                    remote_url,
                    cached_only=cached_only,
                )
                if source_image_path is None:
                    continue

                leaf_patch = build_leaf_patch_from_source_image(
                    source_name,
                    str(species_entry["slug"]),
                    candidate_photo,
                    source_image_path,
                    manual_crop_box=manual_crop_boxes.get(source_asset_id),
                )
                if leaf_patch is None:
                    continue

                local_path, leaf_patch_metadata = leaf_patch
                seen_remote_urls.add(remote_url)
                selected_count += 1
                review_status, review_reasons = classify_leaf_patch_review_status(
                    source_name=source_name,
                    crop_score=float(leaf_patch_metadata["cropScore"]),
                    quality_metrics=leaf_patch_metadata["qualityMetrics"],
                    crop_area_ratio=float(leaf_patch_metadata["cropAreaRatio"]),
                )
                entries.append(
                    {
                        "id": build_index_entry_id(source_name, str(species_entry["slug"]), candidate_photo, crop_index=int(leaf_patch_metadata["cropIndex"])),
                        "slug": species_entry["slug"],
                        "speciesLabel": species_entry["label"],
                        "subtitle": species_entry.get("subtitle"),
                        "taxonRank": species_entry.get("taxonRank"),
                        "catalogTier": species_entry.get("catalogTier"),
                        "sourceAssetId": source_asset_id,
                        "sourceImagePath": str(source_image_path.relative_to(ROOT / "catalog")).replace("\\", "/"),
                        "localPath": str(local_path.relative_to(ROOT / "catalog")).replace("\\", "/"),
                        "sourceName": source_name,
                        "sourcePriority": source_priority,
                        "sourceRole": source_entry.get("role"),
                        "licenseCode": candidate_photo.get("licenseCode") or candidate_photo.get("photoLicenseCode"),
                        "remoteUrl": remote_url,
                        "recordUrl": candidate_photo.get("observationUrl") or candidate_photo.get("occurrenceUrl"),
                        "attribution": candidate_photo.get("attribution"),
                        "sourceImageSize": leaf_patch_metadata["sourceImageSize"],
                        "patchImageSize": leaf_patch_metadata["patchImageSize"],
                        "cropIndex": leaf_patch_metadata["cropIndex"],
                        "cropBox": leaf_patch_metadata["cropBox"],
                        "cropScore": leaf_patch_metadata["cropScore"],
                        "cropAreaRatio": leaf_patch_metadata["cropAreaRatio"],
                        "manualCropApplied": bool(leaf_patch_metadata.get("manualCropApplied")),
                        "reviewStatus": review_status,
                        "reviewReasons": review_reasons,
                        "qualityMetrics": leaf_patch_metadata["qualityMetrics"],
                        "sourceQualityMetrics": leaf_patch_metadata["sourceQualityMetrics"],
                    }
                )

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
        "entries": entries,
    }


def read_candidate_image_url(candidate_photo: dict[str, Any]) -> str | None:
    image_url = candidate_photo.get("imageUrl") or candidate_photo.get("photoUrl")
    return str(image_url).strip() if isinstance(image_url, str) and image_url.strip() else None


def build_source_asset_id(source_name: str, slug: str, external_id: Any) -> str:
    return f"{source_name}:{slug}:{sanitize_asset_id(external_id)}"


def read_candidate_external_id(candidate_photo: dict[str, Any]) -> Any:
    return candidate_photo.get("photoId") or candidate_photo.get("mediaId") or candidate_photo.get("observationId") or candidate_photo.get("occurrenceId") or "asset"


def build_source_asset_id_for_candidate(source_name: str, slug: str, candidate_photo: dict[str, Any]) -> str:
    return build_source_asset_id(source_name, slug, read_candidate_external_id(candidate_photo))


def build_index_entry_id(source_name: str, slug: str, candidate_photo: dict[str, Any], *, crop_index: int) -> str:
    return f"{build_source_asset_id_for_candidate(source_name, slug, candidate_photo)}:crop-{crop_index:02d}"


def cache_remote_image(
    source_name: str,
    slug: str,
    candidate_photo: dict[str, Any],
    remote_url: str,
    *,
    cached_only: bool,
) -> Path | None:
    source_dir = SOURCE_CACHE_DIR / source_name / slug
    source_dir.mkdir(parents=True, exist_ok=True)
    external_id = sanitize_asset_id(read_candidate_external_id(candidate_photo))
    suffix = determine_suffix(remote_url)
    target_path = source_dir / f"{external_id}{suffix}"
    if target_path.exists():
        return target_path
    if cached_only:
        return None

    request = Request(remote_url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=60) as response:
            target_path.write_bytes(response.read())
    except (HTTPError, URLError):
        return None
    return target_path


def build_leaf_patch_from_source_image(
    source_name: str,
    slug: str,
    candidate_photo: dict[str, Any],
    source_image_path: Path,
    *,
    manual_crop_box: list[int] | None = None,
) -> tuple[Path, dict[str, Any]] | None:
    with Image.open(source_image_path) as source_image_file:
        source_image = source_image_file.convert("RGB")

    if max(source_image.size) < MIN_SOURCE_MAX_DIMENSION:
        return None

    source_metrics = compute_image_quality_metrics(source_image)
    if is_herbarium_like(source_metrics):
        return None

    if manual_crop_box is not None:
        source_box = resolve_manual_crop_box(manual_crop_box, source_image.width, source_image.height)
        if source_box is None:
            return None

        crop_width = source_box[2] - source_box[0]
        crop_height = source_box[3] - source_box[1]
        if min(crop_width, crop_height) < MIN_CROP_DIMENSION:
            return None

        crop_image = source_image.crop(tuple(source_box))
        crop_metrics = compute_image_quality_metrics(crop_image)
        if not passes_leaf_crop_quality(crop_metrics, 1.0):
            return None

        crop_image = downsample_image(crop_image, max_dimension=OUTPUT_MAX_DIMENSION)
        leaf_patch_path = save_leaf_patch(source_name, slug, candidate_photo, 1, crop_image)
        crop_area_ratio = (crop_width * crop_height) / max(source_image.width * source_image.height, 1)
        return leaf_patch_path, {
            "sourceImageSize": [source_image.width, source_image.height],
            "patchImageSize": [crop_image.width, crop_image.height],
            "cropIndex": 1,
            "cropBox": source_box,
            "cropScore": 1.0,
            "cropAreaRatio": round(float(crop_area_ratio), 6),
            "manualCropApplied": True,
            "qualityMetrics": crop_metrics,
            "sourceQualityMetrics": source_metrics,
        }

    working_image = downsample_image(source_image, max_dimension=WORKING_MAX_DIMENSION)
    working_image_array = np.asarray(working_image, dtype=np.float32) / 255.0
    mask = compute_foreground_mask(working_image_array)
    crops = select_leaf_crops(working_image_array, mask)
    if not crops:
        return None

    scale_x = source_image.width / max(working_image.width, 1)
    scale_y = source_image.height / max(working_image.height, 1)

    for crop_index, crop in enumerate(crops, start=1):
        source_box = scale_box(crop["box"], scale_x, scale_y, source_image.width, source_image.height)
        crop_width = source_box[2] - source_box[0]
        crop_height = source_box[3] - source_box[1]
        if min(crop_width, crop_height) < MIN_CROP_DIMENSION:
            continue

        crop_image = source_image.crop(tuple(source_box))
        crop_metrics = compute_image_quality_metrics(crop_image)
        if not passes_leaf_crop_quality(crop_metrics, float(crop["score"])):
            continue

        crop_image = downsample_image(crop_image, max_dimension=OUTPUT_MAX_DIMENSION)
        leaf_patch_path = save_leaf_patch(source_name, slug, candidate_photo, crop_index, crop_image)
        crop_area_ratio = (crop_width * crop_height) / max(source_image.width * source_image.height, 1)
        return leaf_patch_path, {
            "sourceImageSize": [source_image.width, source_image.height],
            "patchImageSize": [crop_image.width, crop_image.height],
            "cropIndex": crop_index,
            "cropBox": source_box,
            "cropScore": round(float(crop["score"]), 6),
            "cropAreaRatio": round(float(crop_area_ratio), 6),
            "manualCropApplied": False,
            "qualityMetrics": crop_metrics,
            "sourceQualityMetrics": source_metrics,
        }

    return None


def classify_leaf_patch_review_status(
    *,
    source_name: str,
    crop_score: float,
    quality_metrics: dict[str, float],
    crop_area_ratio: float,
) -> tuple[str, list[str]]:
    reasons: list[str] = []

    if source_name != "inaturalist":
        reasons.append("secondary-source-review")
    if crop_score < AUTO_APPROVE_CROP_SCORE:
        reasons.append("borderline-crop-score")
    if quality_metrics["meanSaturation"] < AUTO_APPROVE_MIN_MEAN_SATURATION:
        reasons.append("low-saturation")
    if quality_metrics["greenishRatio"] < AUTO_APPROVE_MIN_GREENISH_RATIO:
        reasons.append("low-greenish-ratio")
    if quality_metrics["brightNeutralRatio"] > AUTO_APPROVE_MAX_BRIGHT_NEUTRAL_RATIO:
        reasons.append("too-much-neutral-background")
    if crop_area_ratio < AUTO_APPROVE_MIN_CROP_AREA_RATIO:
        reasons.append("tiny-crop-relative-to-source")

    if not reasons:
        return "auto-approved", []
    return "pending", reasons


def save_leaf_patch(source_name: str, slug: str, candidate_photo: dict[str, Any], crop_index: int, crop_image: Image.Image) -> Path:
    patch_dir = PATCH_CACHE_DIR / source_name / slug
    patch_dir.mkdir(parents=True, exist_ok=True)
    external_id = sanitize_asset_id(read_candidate_external_id(candidate_photo))
    target_path = patch_dir / f"{external_id}-crop-{crop_index:02d}.jpg"
    crop_image.save(target_path, format="JPEG", quality=95)
    return target_path


def compute_image_quality_metrics(image: Image.Image) -> dict[str, float]:
    image_array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    gray = image_array.mean(axis=2)
    saturation = image_array.max(axis=2) - image_array.min(axis=2)
    bright_neutral_ratio = float(((gray >= 0.88) & (saturation <= 0.08)).mean())
    greenish_ratio = float(((image_array[:, :, 1] > image_array[:, :, 0] + 0.03) & (image_array[:, :, 1] > image_array[:, :, 2] + 0.03)).mean())
    dark_ratio = float((gray <= 0.15).mean())
    return {
        "brightNeutralRatio": round(bright_neutral_ratio, 6),
        "meanSaturation": round(float(saturation.mean()), 6),
        "greenishRatio": round(greenish_ratio, 6),
        "darkRatio": round(dark_ratio, 6),
    }


def is_herbarium_like(metrics: dict[str, float]) -> bool:
    return metrics["brightNeutralRatio"] >= HERBARIUM_BRIGHT_NEUTRAL_RATIO and metrics["meanSaturation"] <= HERBARIUM_SATURATION_THRESHOLD


def passes_leaf_crop_quality(metrics: dict[str, float], crop_score: float) -> bool:
    if crop_score < MIN_CROP_SCORE:
        return False
    if metrics["brightNeutralRatio"] >= MAX_PATCH_BRIGHT_NEUTRAL_RATIO:
        return False
    if metrics["meanSaturation"] < MIN_PATCH_SATURATION:
        return False
    if metrics["darkRatio"] > MAX_PATCH_DARK_RATIO:
        return False
    return True


def determine_suffix(remote_url: str) -> str:
    suffix = Path(urlparse(remote_url).path).suffix.lower()
    return suffix if suffix else ".jpg"


def sanitize_asset_id(raw_value: Any) -> str:
    value = str(raw_value or "asset").strip()
    if not value:
        return "asset"

    parsed = urlparse(value)
    if parsed.scheme and parsed.netloc:
        candidate = Path(parsed.path).stem or parsed.netloc
    else:
        candidate = value

    sanitized = "".join(character if character.isalnum() or character in {"-", "_", "."} else "-" for character in candidate)
    sanitized = sanitized.strip("-._")
    return sanitized[:120] or "asset"


def select_leaf_crops(image: np.ndarray, mask: np.ndarray) -> list[dict[str, object]]:
    height, width, _ = image.shape
    gray = image.mean(axis=2)
    saturation = image.max(axis=2) - image.min(axis=2)
    texture = compute_texture(gray)
    min_dimension = min(height, width)
    crop_sizes = sorted({
        max(160, round(min_dimension * 0.18)),
        max(220, round(min_dimension * 0.24)),
        max(300, round(min_dimension * 0.32)),
    })
    candidates: list[dict[str, object]] = []
    minimum_output_box = max(320, round(min_dimension * 0.30))

    for crop_size in crop_sizes:
        step = max(20, crop_size // 5)
        max_row = max(0, height - crop_size)
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
                bright_neutral_ratio = float(((gray[top:bottom, left:right] >= 0.88) & (saturation[top:bottom, left:right] <= 0.08)).mean())
                dark_ratio = float((gray[top:bottom, left:right] < 0.18).mean())
                score = (
                    (foreground_ratio * 0.42)
                    + (saturation_mean * 0.24)
                    + (texture_mean * 0.28)
                    - (bright_neutral_ratio * 0.35)
                    - (dark_ratio * 0.10)
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
            expansion=1.25,
            minimum_size=minimum_output_box,
        )
        if all(compute_iou(expanded_box, existing["box"]) < 0.40 for existing in selected):
            selected.append({"box": expanded_box, "score": candidate["score"]})
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
    new_left = max(min(round(center_x - (target_size / 2.0)), image_width - target_size), 0)
    new_top = max(min(round(center_y - (target_size / 2.0)), image_height - target_size), 0)
    new_right = min(new_left + target_size, image_width)
    new_bottom = min(new_top + target_size, image_height)
    return [new_left, new_top, new_right, new_bottom]


def scale_box(box: list[int], scale_x: float, scale_y: float, image_width: int, image_height: int) -> list[int]:
    left = min(max(round(box[0] * scale_x), 0), max(image_width - 1, 0))
    top = min(max(round(box[1] * scale_y), 0), max(image_height - 1, 0))
    right = min(max(round(box[2] * scale_x), left + 1), image_width)
    bottom = min(max(round(box[3] * scale_y), top + 1), image_height)
    return [left, top, right, bottom]


def normalize_manual_crop_box(raw_value: Any) -> list[int] | None:
    if not isinstance(raw_value, list) or len(raw_value) != 4:
        return None

    normalized: list[int] = []
    for coordinate in raw_value:
        if not isinstance(coordinate, (int, float)):
            return None
        normalized.append(int(round(coordinate)))
    return normalized


def resolve_manual_crop_box(manual_crop_box: list[int], image_width: int, image_height: int) -> list[int] | None:
    left = min(max(manual_crop_box[0], 0), max(image_width - 1, 0))
    top = min(max(manual_crop_box[1], 0), max(image_height - 1, 0))
    right = min(max(manual_crop_box[2], left + 1), image_width)
    bottom = min(max(manual_crop_box[3], top + 1), image_height)
    if right <= left or bottom <= top:
        return None
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

    intersection_width = max(0, intersection_right - intersection_left)
    intersection_height = max(0, intersection_bottom - intersection_top)
    intersection_area = intersection_width * intersection_height
    if intersection_area <= 0:
        return 0.0

    left_area = max(0, left_right - left_left) * max(0, left_bottom - left_top)
    right_area = max(0, right_right - right_left) * max(0, right_bottom - right_top)
    union_area = left_area + right_area - intersection_area
    if union_area <= 0:
        return 0.0
    return intersection_area / union_area


if __name__ == "__main__":
    main()