from __future__ import annotations

import json
import shutil
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "catalog"
CANDIDATE_PATH = CATALOG_DIR / "open_license_leaf_candidates.json"
LEGACY_DIRECTORIES = [
    CATALOG_DIR / "open_license_leaves",
    CATALOG_DIR / "images",
]
OPTIONAL_CACHE_DIRECTORIES = [
    CATALOG_DIR / "leaves" / "source",
]
LEGACY_REVIEW_GLOBS = [
    (CATALOG_DIR / "review", "captured_contact_sheet_*.png"),
]
VALIDATION_ONLY_ASSETS = [
    CATALOG_DIR / "leaf_reference_catalog.json",
    CATALOG_DIR / "leaves",
]


def main() -> None:
    removed_directories: list[str] = []
    removed_files: list[str] = []
    pruned_source_images: list[str] = []
    pruned_leaf_patches: list[str] = []

    for directory in LEGACY_DIRECTORIES:
        if not directory.exists():
            continue
        shutil.rmtree(directory)
        removed_directories.append(relative_catalog_path(directory))

    for parent, pattern in LEGACY_REVIEW_GLOBS:
        if not parent.exists():
            continue
        for path in sorted(parent.glob(pattern)):
            path.unlink()
            removed_files.append(relative_catalog_path(path))

    for directory in OPTIONAL_CACHE_DIRECTORIES:
        if not directory.exists():
            continue
        shutil.rmtree(directory)
        removed_directories.append(relative_catalog_path(directory))

    expected_source_images, expected_leaf_patches = load_expected_open_license_cache_files()
    pruned_source_images = prune_unexpected_files(CATALOG_DIR / "open_license_source_images", expected_source_images)
    pruned_leaf_patches = prune_unexpected_files(CATALOG_DIR / "open_license_leaf_patches", expected_leaf_patches)

    print(
        json.dumps(
            {
                "removedDirectories": removed_directories,
                "removedFiles": removed_files,
                "prunedSourceImages": pruned_source_images,
                "prunedLeafPatches": pruned_leaf_patches,
                "keptValidationOnlyAssets": [relative_catalog_path(path) for path in VALIDATION_ONLY_ASSETS if path.exists()],
            },
            indent=2,
        )
    )


def relative_catalog_path(path: Path) -> str:
    return str(path.relative_to(CATALOG_DIR)).replace("\\", "/")


def load_expected_open_license_cache_files() -> tuple[set[Path], set[Path]]:
    raw_candidates = json.loads(CANDIDATE_PATH.read_text(encoding="utf-8"))
    candidate_entries = raw_candidates.get("entries") if isinstance(raw_candidates, dict) else None
    if not isinstance(candidate_entries, list):
        raise RuntimeError("open_license_leaf_candidates.json must contain an entries array")

    expected_source_images: set[Path] = set()
    expected_leaf_patches: set[Path] = set()

    for entry in candidate_entries:
        if not isinstance(entry, dict):
            continue

        local_path = entry.get("localPath")
        entry_id = entry.get("id")
        remote_url = entry.get("remoteUrl")
        if isinstance(local_path, str) and local_path.strip():
            expected_leaf_patches.add(Path(local_path))

        if not isinstance(entry_id, str) or not entry_id.strip() or not isinstance(remote_url, str) or not remote_url.strip():
            continue

        parts = entry_id.split(":")
        if len(parts) < 4:
            continue

        source_name, slug, asset_id = parts[0], parts[1], parts[2]
        expected_source_images.add(Path("open_license_source_images") / source_name / slug / f"{asset_id}{determine_suffix(remote_url)}")

    return expected_source_images, expected_leaf_patches


def determine_suffix(remote_url: str) -> str:
    suffix = Path(urlparse(remote_url).path).suffix.lower()
    return suffix if suffix else ".jpg"


def prune_unexpected_files(root: Path, expected_files: set[Path]) -> list[str]:
    if not root.exists():
        return []

    removed_files: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue

        relative_path = path.relative_to(CATALOG_DIR)
        if relative_path in expected_files:
            continue

        path.unlink()
        removed_files.append(str(relative_path).replace("\\", "/"))

    remove_empty_directories(root)
    return removed_files


def remove_empty_directories(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()


if __name__ == "__main__":
    main()