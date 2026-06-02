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
OUTPUT_PATH = ROOT / "catalog" / "gbif_reference_candidates.json"
SOURCE_RANKING_PATH = ROOT / "catalog" / "open_license_source_ranking.json"
USER_AGENT = "BonsaiGbifHarvester/0.1"
REQUEST_DELAY_SECONDS = 0.75
RETRY_DELAYS_SECONDS = (1.5, 3.0, 6.0)
SOURCE_NAME = "gbif"
ALLOWED_LICENSE_CODES = ("cc0", "cc-by", "cc-by-sa")
GBIF_ALLOWED_LICENSES = {
    "cc0 1.0": "cc0",
    "cc by 4.0": "cc-by",
    "cc by-sa 4.0": "cc-by-sa",
    "https://creativecommons.org/publicdomain/zero/1.0/legalcode": "cc0",
    "https://creativecommons.org/licenses/by/4.0/legalcode": "cc-by",
    "https://creativecommons.org/licenses/by-sa/4.0/legalcode": "cc-by-sa",
    "http://creativecommons.org/publicdomain/zero/1.0/legalcode": "cc0",
    "http://creativecommons.org/licenses/by/4.0/legalcode": "cc-by",
    "http://creativecommons.org/licenses/by-sa/4.0/legalcode": "cc-by-sa",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Harvest a bounded, open-license GBIF candidate manifest for taxa with weak iNaturalist coverage.")
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
        candidate_photos = []
        if taxon is not None:
            candidate_photos = fetch_open_license_occurrences(taxon["usageKey"], max_photos_per_species=max_photos_per_species)

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
                "candidatePhotos": candidate_photos,
            }
        )
        sleep(REQUEST_DELAY_SECONDS)

    return {
        "notes": [
            "This is an offline ingestion manifest. It is not loaded by the runtime app.",
            "GBIF is a secondary backfill source. Use it only when iNaturalist coverage is weak.",
            "GBIF media licenses are filtered aggressively because many image-bearing occurrences are not permissive by default.",
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

    payload = read_json("https://api.gbif.org/v1/species/match", params={"name": query, "verbose": "true"})
    usage_key = payload.get("usageKey")
    if not isinstance(usage_key, int):
        return None

    return {
        "usageKey": usage_key,
        "scientificName": payload.get("scientificName"),
        "canonicalName": payload.get("canonicalName"),
        "rank": payload.get("rank"),
        "status": payload.get("status"),
        "matchType": payload.get("matchType"),
        "matchedQuery": query,
    }


def build_taxon_query(species_entry: dict[str, Any]) -> str:
    subtitle = str(species_entry.get("subtitle") or "").strip()
    if subtitle:
        return subtitle.replace(" spp.", "").replace(" group", "")
    return str(species_entry.get("label") or "").strip()


def fetch_open_license_occurrences(usage_key: int, *, max_photos_per_species: int) -> list[dict[str, Any]]:
    payload = read_json(
        "https://api.gbif.org/v1/occurrence/search",
        params={
            "mediaType": "StillImage",
            "taxon_key": str(usage_key),
            "limit": "100",
            "offset": "0",
        },
    )
    results = payload.get("results") or []
    if not isinstance(results, list):
        return []

    selected_photos: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for result in results:
        if not isinstance(result, dict):
            continue

        for media in result.get("media") or []:
            if not isinstance(media, dict):
                continue

            image_url = str(media.get("identifier") or "").strip()
            if not image_url or image_url in seen_urls:
                continue

            license_code = normalize_gbif_license(media.get("license") or result.get("license"))
            if license_code is None:
                continue

            seen_urls.add(image_url)
            selected_photos.append(
                {
                    "sourceName": SOURCE_NAME,
                    "sourcePriority": read_source_priority(SOURCE_NAME),
                    "occurrenceId": result.get("gbifID") or result.get("key"),
                    "occurrenceUrl": build_occurrence_url(result.get("key")),
                    "mediaId": media.get("identifier"),
                    "imageUrl": image_url,
                    "licenseCode": license_code,
                    "attribution": media.get("creator") or media.get("rightsHolder") or result.get("rightsHolder"),
                    "observedOn": result.get("eventDate"),
                    "placeGuess": ", ".join(
                        part for part in [result.get("locality"), result.get("stateProvince"), result.get("countryCode")] if isinstance(part, str) and part
                    ) or None,
                }
            )
            if len(selected_photos) >= max_photos_per_species:
                return selected_photos

    return selected_photos


def normalize_gbif_license(raw_value: Any) -> str | None:
    normalized = normalize_name(str(raw_value or ""))
    return GBIF_ALLOWED_LICENSES.get(normalized)


def build_occurrence_url(key: Any) -> str | None:
    if isinstance(key, int):
        return f"https://www.gbif.org/occurrence/{key}"
    if isinstance(key, str) and key.isdigit():
        return f"https://www.gbif.org/occurrence/{key}"
    return None


def normalize_name(value: str) -> str:
    return " ".join(value.strip().lower().split())


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