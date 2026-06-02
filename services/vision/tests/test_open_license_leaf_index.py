from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.build_open_license_leaf_index import ROOT, build_open_license_leaf_index, classify_leaf_patch_review_status
from scripts.build_reviewed_open_license_leaf_index import build_reviewed_open_license_leaf_index
from scripts.harvest_inaturalist_taxa import build_inaturalist_image_variant_url


class OpenLicenseLeafIndexTest(unittest.TestCase):
    def test_source_ranking_prefers_inaturalist_and_uses_gbif_as_backfill(self) -> None:
        species_program = [
            {
                "slug": "acer-palmatum",
                "label": "Japanese maple",
                "subtitle": "Acer palmatum",
                "taxonRank": "species",
                "catalogTier": "core",
            }
        ]
        source_ranking = [
            {"source": "inaturalist", "priority": 1, "role": "primary"},
            {"source": "gbif", "priority": 2, "role": "secondary-backfill"},
        ]
        source_manifests = {
            "inaturalist": {
                "acer-palmatum": {
                    "candidatePhotos": [
                        {
                            "photoId": 10,
                            "imageUrl": "https://example.test/inat-1.jpg",
                            "licenseCode": "cc-by",
                            "observationUrl": "https://example.test/observation/10",
                        }
                    ]
                }
            },
            "gbif": {
                "acer-palmatum": {
                    "candidatePhotos": [
                        {
                            "mediaId": "gbif-20",
                            "imageUrl": "https://example.test/gbif-1.jpg",
                            "licenseCode": "cc-by",
                            "occurrenceUrl": "https://example.test/occurrence/20",
                        },
                        {
                            "mediaId": "gbif-21",
                            "imageUrl": "https://example.test/gbif-2.jpg",
                            "licenseCode": "cc-by-sa",
                            "occurrenceUrl": "https://example.test/occurrence/21",
                        },
                    ]
                }
            },
        }

        with (
            patch(
                "scripts.build_open_license_leaf_index.cache_remote_image",
                side_effect=lambda source_name, slug, candidate_photo, remote_url, cached_only=False: ROOT / "catalog" / "open_license_source_images" / source_name / slug / f"{candidate_photo.get('photoId') or candidate_photo.get('mediaId')}.jpg",
            ),
            patch(
                "scripts.build_open_license_leaf_index.build_leaf_patch_from_source_image",
                side_effect=lambda source_name, slug, candidate_photo, source_image_path, manual_crop_box=None: (
                    ROOT / "catalog" / "open_license_leaf_patches" / source_name / slug / f"{candidate_photo.get('photoId') or candidate_photo.get('mediaId')}-crop-01.jpg",
                    {
                        "sourceImageSize": [1600, 1200],
                        "patchImageSize": [768, 768],
                        "cropIndex": 1,
                        "cropBox": [0, 0, 768, 768],
                        "cropScore": 0.42,
                        "cropAreaRatio": 0.08,
                        "qualityMetrics": {
                            "brightNeutralRatio": 0.02,
                            "meanSaturation": 0.18,
                            "greenishRatio": 0.51,
                            "darkRatio": 0.03,
                        },
                        "sourceQualityMetrics": {
                            "brightNeutralRatio": 0.01,
                            "meanSaturation": 0.19,
                            "greenishRatio": 0.53,
                            "darkRatio": 0.02,
                        },
                    },
                ),
            ),
        ):
            index = build_open_license_leaf_index(
                species_program,
                source_ranking=source_ranking,
                source_manifests=source_manifests,
                max_images_per_species=2,
            )

        entries = index["entries"]
        self.assertEqual(2, len(entries))
        self.assertEqual("inaturalist", entries[0]["sourceName"])
        self.assertEqual(1, entries[0]["sourcePriority"])
        self.assertEqual("gbif", entries[1]["sourceName"])
        self.assertEqual(2, entries[1]["sourcePriority"])
        self.assertEqual("auto-approved", entries[0]["reviewStatus"])
        self.assertEqual("pending", entries[1]["reviewStatus"])

    def test_source_overrides_can_exclude_specific_source_images(self) -> None:
        species_program = [
            {
                "slug": "bougainvillea",
                "label": "Bougainvillea",
                "subtitle": "Bougainvillea spp.",
                "taxonRank": "genus",
                "catalogTier": "core",
            }
        ]
        source_ranking = [{"source": "inaturalist", "priority": 1, "role": "primary"}]
        source_manifests = {
            "inaturalist": {
                "bougainvillea": {
                    "candidatePhotos": [
                        {"photoId": 113376096, "imageUrl": "https://example.test/bad.jpg", "licenseCode": "cc-by"},
                        {"photoId": 113376200, "imageUrl": "https://example.test/good.jpg", "licenseCode": "cc-by"},
                    ]
                }
            }
        }
        seen_photo_ids: list[int] = []

        with (
            patch(
                "scripts.build_open_license_leaf_index.cache_remote_image",
                side_effect=lambda source_name, slug, candidate_photo, remote_url, cached_only=False: ROOT / "catalog" / "open_license_source_images" / source_name / slug / f"{candidate_photo.get('photoId')}.jpg",
            ),
            patch(
                "scripts.build_open_license_leaf_index.build_leaf_patch_from_source_image",
                side_effect=lambda source_name, slug, candidate_photo, source_image_path, manual_crop_box=None: (
                    seen_photo_ids.append(int(candidate_photo["photoId"])),
                    ROOT / "catalog" / "open_license_leaf_patches" / source_name / slug / f"{candidate_photo.get('photoId')}-crop-01.jpg",
                    {
                        "sourceImageSize": [1600, 1200],
                        "patchImageSize": [768, 768],
                        "cropIndex": 1,
                        "cropBox": [0, 0, 768, 768],
                        "cropScore": 0.42,
                        "cropAreaRatio": 0.08,
                        "manualCropApplied": False,
                        "qualityMetrics": {
                            "brightNeutralRatio": 0.02,
                            "meanSaturation": 0.18,
                            "greenishRatio": 0.51,
                            "darkRatio": 0.03,
                        },
                        "sourceQualityMetrics": {
                            "brightNeutralRatio": 0.01,
                            "meanSaturation": 0.19,
                            "greenishRatio": 0.53,
                            "darkRatio": 0.02,
                        },
                    },
                )[1:],
            ),
        ):
            index = build_open_license_leaf_index(
                species_program,
                source_ranking=source_ranking,
                source_manifests=source_manifests,
                source_overrides={
                    "excludedSourceImages": {"inaturalist:bougainvillea:113376096"},
                    "manualCropBoxes": {},
                },
                max_images_per_species=2,
            )

        self.assertEqual([113376200], seen_photo_ids)
        self.assertEqual(["inaturalist:bougainvillea:113376200:crop-01"], [entry["id"] for entry in index["entries"]])

    def test_manual_crop_override_is_forwarded_and_tracked(self) -> None:
        species_program = [
            {
                "slug": "acer-palmatum",
                "label": "Japanese maple",
                "subtitle": "Acer palmatum",
                "taxonRank": "species",
                "catalogTier": "core",
            }
        ]
        source_ranking = [{"source": "inaturalist", "priority": 1, "role": "primary"}]
        source_manifests = {
            "inaturalist": {
                "acer-palmatum": {
                    "candidatePhotos": [{"photoId": 10, "imageUrl": "https://example.test/inat-1.jpg", "licenseCode": "cc-by"}]
                }
            }
        }
        seen_manual_crop_boxes: list[list[int] | None] = []

        with (
            patch(
                "scripts.build_open_license_leaf_index.cache_remote_image",
                side_effect=lambda source_name, slug, candidate_photo, remote_url, cached_only=False: ROOT / "catalog" / "open_license_source_images" / source_name / slug / f"{candidate_photo.get('photoId')}.jpg",
            ),
            patch(
                "scripts.build_open_license_leaf_index.build_leaf_patch_from_source_image",
                side_effect=lambda source_name, slug, candidate_photo, source_image_path, manual_crop_box=None: (
                    seen_manual_crop_boxes.append(manual_crop_box),
                    ROOT / "catalog" / "open_license_leaf_patches" / source_name / slug / f"{candidate_photo.get('photoId')}-crop-01.jpg",
                    {
                        "sourceImageSize": [1600, 1200],
                        "patchImageSize": [768, 768],
                        "cropIndex": 1,
                        "cropBox": manual_crop_box,
                        "cropScore": 1.0,
                        "cropAreaRatio": 0.08,
                        "manualCropApplied": True,
                        "qualityMetrics": {
                            "brightNeutralRatio": 0.02,
                            "meanSaturation": 0.18,
                            "greenishRatio": 0.51,
                            "darkRatio": 0.03,
                        },
                        "sourceQualityMetrics": {
                            "brightNeutralRatio": 0.01,
                            "meanSaturation": 0.19,
                            "greenishRatio": 0.53,
                            "darkRatio": 0.02,
                        },
                    },
                )[1:],
            ),
        ):
            index = build_open_license_leaf_index(
                species_program,
                source_ranking=source_ranking,
                source_manifests=source_manifests,
                source_overrides={
                    "excludedSourceImages": set(),
                    "manualCropBoxes": {"inaturalist:acer-palmatum:10": [10, 20, 110, 120]},
                },
                max_images_per_species=1,
            )

        self.assertEqual([[10, 20, 110, 120]], seen_manual_crop_boxes)
        self.assertEqual("inaturalist:acer-palmatum:10", index["entries"][0]["sourceAssetId"])
        self.assertTrue(index["entries"][0]["manualCropApplied"])

    def test_review_status_requires_review_for_secondary_source_or_weak_crop(self) -> None:
        self.assertEqual(
            ("auto-approved", []),
            classify_leaf_patch_review_status(
                source_name="inaturalist",
                crop_score=0.34,
                quality_metrics={
                    "brightNeutralRatio": 0.02,
                    "meanSaturation": 0.19,
                    "greenishRatio": 0.48,
                    "darkRatio": 0.05,
                },
                crop_area_ratio=0.08,
            ),
        )
        review_status, reasons = classify_leaf_patch_review_status(
            source_name="gbif",
            crop_score=0.22,
            quality_metrics={
                "brightNeutralRatio": 0.12,
                "meanSaturation": 0.09,
                "greenishRatio": 0.05,
                "darkRatio": 0.04,
            },
            crop_area_ratio=0.02,
        )
        self.assertEqual("pending", review_status)
        self.assertIn("secondary-source-review", reasons)
        self.assertIn("low-saturation", reasons)

    def test_reviewed_runtime_index_excludes_pending_without_explicit_approval(self) -> None:
        candidates_path = ROOT / "catalog" / "open_license_leaf_candidates.json"
        overrides_path = ROOT / "catalog" / "open_license_leaf_review_overrides.json"
        original_candidates = candidates_path.read_text(encoding="utf-8") if candidates_path.exists() else None
        original_overrides = overrides_path.read_text(encoding="utf-8") if overrides_path.exists() else None
        try:
            candidates_path.write_text(
                json.dumps(
                    {
                        "sourceRanking": [],
                        "entries": [
                            {"id": "auto-1", "localPath": "open_license_leaf_patches/inaturalist/a.jpg", "reviewStatus": "auto-approved"},
                            {"id": "pending-1", "localPath": "open_license_leaf_patches/gbif/b.jpg", "reviewStatus": "pending"},
                            {"id": "pending-2", "localPath": "open_license_leaf_patches/gbif/c.jpg", "reviewStatus": "pending"},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            overrides_path.write_text(json.dumps({"approved": ["pending-2"], "rejected": []}), encoding="utf-8")

            reviewed_index = build_reviewed_open_license_leaf_index()

            self.assertEqual(["auto-1", "pending-2"], [entry["id"] for entry in reviewed_index["entries"]])
        finally:
            if original_candidates is None:
                candidates_path.unlink(missing_ok=True)
            else:
                candidates_path.write_text(original_candidates, encoding="utf-8")
            if original_overrides is None:
                overrides_path.unlink(missing_ok=True)
            else:
                overrides_path.write_text(original_overrides, encoding="utf-8")

    def test_inaturalist_variant_url_uses_original_resolution(self) -> None:
        square_url = "https://inaturalist-open-data.s3.amazonaws.com/photos/324775039/square.jpg"
        self.assertEqual(
            "https://inaturalist-open-data.s3.amazonaws.com/photos/324775039/original.jpg",
            build_inaturalist_image_variant_url(square_url, "original"),
        )


if __name__ == "__main__":
    unittest.main()