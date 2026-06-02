from __future__ import annotations

import argparse
import json
from pathlib import Path
from time import sleep
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SPECIES_PROGRAM_PATH = ROOT / "catalog" / "species_program.json"
OUTPUT_PATH = ROOT / "catalog" / "inaturalist_reference_candidates.json"
SOURCE_RANKING_PATH = ROOT / "catalog" / "open_license_source_ranking.json"
USER_AGENT = "BonsaiTaxonHarvester/0.1"
REQUEST_DELAY_SECONDS = 1.0
RETRY_DELAYS_SECONDS = (1.5, 3.0, 6.0)
ALLOWED_LICENSE_CODES = ("cc0", "cc-by", "cc-by-sa")
SOURCE_NAME = "inaturalist"


def main() -> None:
    parser = argparse.ArgumentParser(description="Harvest a bounded, open-license iNaturalist candidate manifest for the Bonsai species program.")
    parser.add_argument("--max-photos-per-species", type=int, default=12)
    parser.add_argument("--include-extended", action="store_true")
    parser.add_argument("--include-disabled", action="store_true")
    parser.add_argument("--slugs", nargs="*", default=[])
    args = parser.parse_args()

    species_program = load_species_program(include_extended=args.include_extended, include_disabled=args.include_disabled)
    if args.slugs:
        requested_slugs = {slug.strip() for slug in args.slugs if slug.strip()}
        species_program = [entry for entry in species_program if entry["slug"] in requested_slugs]

    manifest = build_candidate_manifest(species_program, max_photos_per_species=args.max_photos_per_species)
    OUTPUT_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT_PATH), "entry_count": len(manifest["entries"])}, indent=2))


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


def build_candidate_manifest(species_program: list[dict[str, Any]], *, max_photos_per_species: int) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    source_priority = read_source_priority(SOURCE_NAME)

    for species_entry in species_program:
        taxon = resolve_taxon(species_entry)
        observations = []
        if taxon is not None:
            observations = fetch_open_license_observations(taxon["id"], max_photos_per_species=max_photos_per_species)

        entries.append(
            {
                "slug": species_entry["slug"],
                "label": species_entry["label"],
                "subtitle": species_entry.get("subtitle"),
                "taxonRank": species_entry.get("taxonRank"),
                "catalogTier": species_entry.get("catalogTier"),
                "recognitionEnabled": species_entry.get("recognitionEnabled", True),
                "careProfileSlug": species_entry.get("careProfileSlug"),
                "sourceName": SOURCE_NAME,
                "sourcePriority": source_priority,
                "resolvedTaxon": taxon,
                "candidatePhotos": observations,
            }
        )
        sleep(REQUEST_DELAY_SECONDS)

    return {
        "notes": [
            "This is an offline ingestion manifest. It is not loaded by the runtime app.",
            "The species program intentionally stays bounded so the capture flow remains fast and the care model stays maintainable.",
            "By default, disabled/manual-only species-program entries are skipped so the harvest stays aligned with the runtime recognition surface.",
            "Open-license filters are applied at both the observation and photo level.",
        ],
        "sourceName": SOURCE_NAME,
        "sourcePriority": source_priority,
        "sourceRanking": read_source_ranking(),
        "allowedLicenseCodes": list(ALLOWED_LICENSE_CODES),
        "entries": entries,
    }


def resolve_taxon(species_entry: dict[str, Any]) -> dict[str, Any] | None:
    query = build_taxon_query(species_entry)
    if not query:
        return None

    params = {
        "q": query,
        "per_page": "10",
        "is_active": "true",
    }
    taxon_rank = species_entry.get("taxonRank")
    if taxon_rank in {"species", "genus"}:
        params["rank"] = taxon_rank

    payload = read_json("https://api.inaturalist.org/v1/taxa/autocomplete", params=params)
    results = payload.get("results") or []
    if not isinstance(results, list) or not results:
        return None

    normalized_targets = {
        normalize_name(query),
        normalize_name(str(species_entry.get("label") or "")),
        normalize_name(str(species_entry.get("subtitle") or "")),
    }
    for alias in species_entry.get("aliases") or []:
        normalized_targets.add(normalize_name(str(alias)))

    ranked_results = sorted(
        (result for result in results if isinstance(result, dict)),
        key=lambda result: score_taxon_result(result, normalized_targets),
        reverse=True,
    )
    if not ranked_results:
        return None

    best_match = ranked_results[0]
    return {
        "id": best_match.get("id"),
        "name": best_match.get("name"),
        "preferredCommonName": best_match.get("preferred_common_name"),
        "rank": best_match.get("rank"),
        "matchedQuery": query,
    }


def build_taxon_query(species_entry: dict[str, Any]) -> str:
    subtitle = str(species_entry.get("subtitle") or "").strip()
    if subtitle:
        return subtitle.replace(" spp.", "").replace(" group", "")
    return str(species_entry.get("label") or "").strip()


def score_taxon_result(result: dict[str, Any], normalized_targets: set[str]) -> tuple[int, int]:
    scientific_name = normalize_name(str(result.get("name") or ""))
    common_name = normalize_name(str(result.get("preferred_common_name") or ""))
    exact_match = int(scientific_name in normalized_targets or common_name in normalized_targets)
    rank_score = 1 if str(result.get("rank") or "") in {"species", "genus"} else 0
    return exact_match, rank_score


def fetch_open_license_observations(taxon_id: int, *, max_photos_per_species: int) -> list[dict[str, Any]]:
    params = {
        "taxon_id": str(taxon_id),
        "quality_grade": "research",
        "photos": "true",
        "license": ",".join(ALLOWED_LICENSE_CODES),
        "photo_license": ",".join(ALLOWED_LICENSE_CODES),
        "per_page": "100",
        "page": "1",
        "order_by": "votes",
        "order": "desc",
    }
    payload = read_json("https://api.inaturalist.org/v1/observations", params=params)
    results = payload.get("results") or []
    if not isinstance(results, list):
        return []

    selected_photos: list[dict[str, Any]] = []
    seen_photo_ids: set[int] = set()
    for result in results:
        if not isinstance(result, dict):
            continue
        photos = result.get("photos") or []
        if not isinstance(photos, list):
            continue

        for photo in photos:
            if not isinstance(photo, dict):
                continue
            photo_id = photo.get("id")
            photo_license = str(photo.get("license_code") or "").lower()
            if not isinstance(photo_id, int) or photo_id in seen_photo_ids or photo_license not in ALLOWED_LICENSE_CODES:
                continue

            seen_photo_ids.add(photo_id)
            photo_url = str(photo.get("url") or "")
            selected_photos.append(
                {
                    "sourceName": SOURCE_NAME,
                    "sourcePriority": read_source_priority(SOURCE_NAME),
                    "observationId": result.get("id"),
                    "observationUrl": result.get("uri"),
                    "photoId": photo_id,
                    "imageUrl": build_inaturalist_image_variant_url(photo_url, "original"),
                    "previewUrl": build_inaturalist_image_variant_url(photo_url, "large"),
                    "thumbnailUrl": build_inaturalist_image_variant_url(photo_url, "square"),
                    "photoUrl": build_inaturalist_image_variant_url(photo_url, "original"),
                    "licenseCode": photo_license,
                    "photoLicenseCode": photo_license,
                    "observationLicenseCode": str(result.get("license_code") or "").lower() or None,
                    "attribution": photo.get("attribution"),
                    "observedOn": result.get("observed_on_string") or result.get("observed_on"),
                    "placeGuess": result.get("place_guess"),
                    "originalDimensions": photo.get("original_dimensions"),
                }
            )
            if len(selected_photos) >= max_photos_per_species:
                return selected_photos

    return selected_photos


def normalize_name(value: str) -> str:
    return " ".join(value.strip().lower().split())


def build_inaturalist_image_variant_url(photo_url: str, variant: str) -> str:
    normalized_url = photo_url.strip()
    if not normalized_url:
        return normalized_url

    for candidate_variant in ("square", "small", "medium", "large", "original"):
        token = f"/{candidate_variant}."
        if token in normalized_url:
            return normalized_url.replace(token, f"/{variant}.")

    return normalized_url


def read_source_ranking() -> list[dict[str, Any]]:
    raw_value = json.loads(SOURCE_RANKING_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_value, list):
        raise RuntimeError("open_license_source_ranking.json must contain a JSON array")
    return [entry for entry in raw_value if isinstance(entry, dict)]


def read_source_priority(source_name: str) -> int:
    for entry in read_source_ranking():
        if str(entry.get("source") or "") == source_name:
            priority = entry.get("priority")
            if isinstance(priority, int):
                return priority
            break
    raise RuntimeError(f"Missing source priority for {source_name}")


def read_json(base_url: str, *, params: dict[str, str]) -> dict[str, Any]:
    query = urlencode(params)
    payload = read_bytes(f"{base_url}?{query}")
    return json.loads(payload.decode("utf-8"))


def read_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})

    for attempt, retry_delay in enumerate((0.0, *RETRY_DELAYS_SECONDS), start=1):
        if retry_delay > 0:
            sleep(retry_delay)

        try:
            with urlopen(request, timeout=60) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 or attempt > len(RETRY_DELAYS_SECONDS):
                raise
        except URLError:
            if attempt > len(RETRY_DELAYS_SECONDS):
                raise

    raise RuntimeError(f"Unable to fetch {url}")


if __name__ == "__main__":
    main()