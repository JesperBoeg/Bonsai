from __future__ import annotations

from collections import Counter
from io import BytesIO
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import (
    Candidate,
    LeafReferenceCatalogMatch,
    ReferenceCatalogMatch,
    app,
    canonicalize_species_label,
    compute_embedding,
    compute_taxonomy_embedding,
    cosine_similarity,
    rank_leaf_reference_predictions,
    load_reference_catalog_embeddings,
    rank_reference_predictions,
    rank_reference_catalog_matches,
    rank_style_reference_catalog_matches,
)
from app.encoders import PIXEL_BACKEND
from app.style_geometry import compute_style_geometry_descriptor, score_style_prototype_similarity, validate_style_photo_background
from app.style_geometry import compute_style_geometry_metrics
from scripts.build_taxonomy_benchmark import build_benchmark_manifest
from scripts.evaluate_catalog_suggestion_coverage import evaluate_catalog_suggestion_coverage


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "bonsai_reference_catalog.json"
EXPECTED_STYLE_LABELS = {
    "Broom (Hokidachi)",
    "Cascade (Kengai)",
    "Double trunk (Sokan)",
    "Forest (Yose-ue)",
    "Formal upright (Chokkan)",
    "Growing in rock (Ishisuki)",
    "Growing on rock (Seki-joju)",
    "Informal upright (Moyogi)",
    "Literati (Bunjingi)",
    "Multi-trunk (Kabudachi)",
    "Raft (Ikadabuki)",
    "Semi-cascade (Han-kengai)",
    "Shari deadwood (Sharimiki)",
    "Slanting (Shakan)",
    "Windswept (Fukinagashi)",
}
MAX_IMAGES_PER_SPECIES = 3


def sanitize_image_bytes(image_bytes: bytes) -> bytes:
    with Image.open(BytesIO(image_bytes)) as image:
        sanitized_buffer = BytesIO()
        image.convert("RGB").save(sanitized_buffer, format="PNG")
        return sanitized_buffer.getvalue()


def build_style_quality_test_image(*, busy_background: bool) -> bytes:
    image = Image.new("RGB", (240, 320), (150, 154, 160))
    draw = ImageDraw.Draw(image)

    if busy_background:
        mosaic_palette = [
            (60, 92, 144),
            (166, 124, 84),
            (98, 150, 96),
            (174, 94, 122),
            (92, 96, 118),
            (204, 182, 124),
        ]
        for row in range(0, 320, 32):
            for column in range(0, 240, 32):
                color = mosaic_palette[((row // 32) + (column // 32)) % len(mosaic_palette)]
                draw.rectangle((column, row, min(column + 31, 239), min(row + 31, 319)), fill=color)
    else:
        draw.rectangle((0, 0, 239, 48), fill=(150, 154, 160))
        draw.rectangle((0, 48, 239, 319), fill=(150, 154, 160))

    draw.rounded_rectangle((68, 252, 172, 288), fill=(74, 52, 40), radius=3)
    draw.polygon(((114, 246), (104, 182), (116, 124), (132, 122), (140, 182), (136, 246)), fill=(122, 100, 78))
    draw.ellipse((54, 70, 132, 136), fill=(56, 108, 60))
    draw.ellipse((108, 52, 184, 116), fill=(52, 102, 58))
    draw.ellipse((78, 114, 170, 178), fill=(48, 96, 54))

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def build_panel_background_test_image() -> bytes:
    image = Image.new("RGB", (240, 320), (128, 136, 144))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 239, 44), fill=(170, 178, 188))
    draw.rectangle((0, 44, 26, 319), fill=(110, 118, 126))
    draw.rectangle((214, 44, 239, 319), fill=(110, 118, 126))
    draw.rectangle((26, 44, 214, 319), fill=(128, 136, 144))
    draw.rounded_rectangle((68, 252, 172, 288), fill=(74, 52, 40), radius=3)
    draw.line(((120, 246), (114, 198), (124, 150), (112, 106), (122, 64)), fill=(122, 100, 78), width=14)
    draw.ellipse((78, 152, 150, 196), fill=(56, 108, 60))
    draw.ellipse((110, 112, 184, 158), fill=(52, 102, 58))
    draw.ellipse((74, 74, 146, 122), fill=(50, 98, 56))
    draw.ellipse((100, 38, 160, 82), fill=(54, 104, 58))

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def build_style_prototype_query_image(style_variant: str) -> bytes:
    image = Image.new("RGB", (240, 320), (242, 239, 232))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((70, 252, 170, 288), fill=(74, 52, 40), radius=3)

    if style_variant == "moyogi":
        draw.line(((120, 248), (112, 204), (126, 160), (112, 118), (122, 74)), fill=(122, 100, 78), width=14)
        draw.ellipse((72, 152, 146, 196), fill=(56, 108, 60))
        draw.ellipse((110, 114, 188, 160), fill=(52, 102, 58))
        draw.ellipse((70, 76, 146, 124), fill=(50, 98, 56))
        draw.ellipse((98, 36, 160, 82), fill=(54, 104, 58))
    elif style_variant == "double-trunk":
        draw.line(((114, 248), (106, 202), (96, 156), (84, 112)), fill=(122, 100, 78), width=12)
        draw.line(((128, 248), (138, 206), (152, 162), (170, 116), (184, 72)), fill=(122, 100, 78), width=12)
        draw.ellipse((56, 96, 132, 150), fill=(56, 108, 60))
        draw.ellipse((114, 128, 190, 174), fill=(52, 102, 58))
        draw.ellipse((144, 62, 220, 118), fill=(50, 98, 56))
    else:
        raise AssertionError(f"Unsupported style variant: {style_variant}")

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def rank_reference_catalog_matches_holdout(entry_id: str, embedding: list[float]) -> list[ReferenceCatalogMatch]:
    matches: list[ReferenceCatalogMatch] = []

    for catalog_entry, reference_embedding in load_reference_catalog_embeddings(PIXEL_BACKEND):
        if catalog_entry.id == entry_id:
            continue

        matches.append(
            ReferenceCatalogMatch(
                id=catalog_entry.id,
                species_label=catalog_entry.species_label,
                style_label=catalog_entry.style_label,
                score=cosine_similarity(embedding, reference_embedding),
            )
        )

    matches.sort(key=lambda match: match.score, reverse=True)
    return matches[:5]


def classify_catalog_entry_holdout(entry: dict[str, object]) -> tuple[str | None, str | None, list[ReferenceCatalogMatch]]:
    image_path = ROOT / "catalog" / str(entry["local_path"])
    if not image_path.exists():
        raise AssertionError(f"Missing catalog image: {entry['id']}")

    sanitized_bytes = sanitize_image_bytes(image_path.read_bytes())
    image_embedding = compute_embedding(sanitized_bytes)
    reference_matches = rank_reference_catalog_matches_holdout(str(entry["id"]), image_embedding)

    species_predictions = rank_reference_predictions(reference_matches, "species")
    style_predictions = rank_reference_predictions(reference_matches, "style")

    species_top = species_predictions[0].label if species_predictions else None
    style_top = style_predictions[0].label if style_predictions else None
    return species_top, style_top, reference_matches

class CatalogRecognitionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        cls.client = TestClient(app)

    def test_reviewed_catalog_contains_expected_image_count(self) -> None:
        self.assertEqual(55, len(self.catalog))

    def test_reviewed_catalog_only_contains_active_accepted_entries(self) -> None:
        for entry in self.catalog:
            self.assertTrue(entry["use_for_species_eval"], entry["id"])
            self.assertTrue(entry["use_for_style_eval"], entry["id"])
            self.assertNotEqual("Unknown", entry["species_label"], entry["id"])

    def test_reviewed_catalog_covers_all_styles_and_caps_species(self) -> None:
        style_labels = {entry["style_label"] for entry in self.catalog}
        self.assertEqual(EXPECTED_STYLE_LABELS, style_labels)

        species_counts = Counter(entry["species_label"] for entry in self.catalog)
        over_cap = {species: count for species, count in species_counts.items() if count > MAX_IMAGES_PER_SPECIES}
        self.assertEqual({}, over_cap)

    def test_candidate_model_accepts_identity_embedding_metadata(self) -> None:
        self.assertEqual({"tree_id", "photo_id", "embedding", "embedding_model"}, set(Candidate.model_fields))

    def test_embedding_ignores_exif_orientation_metadata(self) -> None:
        image = Image.new("RGB", (4, 3))
        image.putdata(
            [
                (255, 0, 0),
                (0, 255, 0),
                (0, 0, 255),
                (255, 255, 0),
                (255, 0, 255),
                (0, 255, 255),
                (64, 64, 64),
                (128, 0, 0),
                (0, 128, 0),
                (0, 0, 128),
                (192, 192, 192),
                (255, 128, 0),
            ]
        )

        plain_buffer = BytesIO()
        image.save(plain_buffer, format="JPEG", quality=100)

        exif_buffer = BytesIO()
        exif = image.getexif()
        exif[274] = 6
        image.save(exif_buffer, format="JPEG", quality=100, exif=exif)

        plain_embedding = compute_embedding(plain_buffer.getvalue())
        exif_embedding = compute_embedding(exif_buffer.getvalue())

        self.assertEqual(len(plain_embedding), len(exif_embedding))
        for plain_value, exif_value in zip(plain_embedding, exif_embedding):
            self.assertAlmostEqual(plain_value, exif_value, places=6)


    def test_holdout_predictions_stay_bounded_to_top_three(self) -> None:
        for entry in self.catalog:
            image_path = ROOT / "catalog" / str(entry["local_path"])
            sanitized_bytes = sanitize_image_bytes(image_path.read_bytes())
            image_embedding = compute_embedding(sanitized_bytes)
            reference_matches = rank_reference_catalog_matches_holdout(str(entry["id"]), image_embedding)
            species_predictions = rank_reference_predictions(reference_matches, "species")
            style_predictions = rank_reference_predictions(reference_matches, "style")

            self.assertLessEqual(len(species_predictions), 3)
            self.assertLessEqual(len(style_predictions), 3)

    def test_species_predictions_collapse_aliases_to_canonical_program_entry(self) -> None:
        predictions = rank_reference_predictions(
            [
                ReferenceCatalogMatch(
                    id="alias-juniper-1",
                    species_label="Dwarf Japanese juniper",
                    style_label="Informal upright (Moyogi)",
                    score=0.92,
                ),
                ReferenceCatalogMatch(
                    id="alias-juniper-2",
                    species_label="Juniperus procumbens",
                    style_label="Slanting (Shakan)",
                    score=0.87,
                ),
            ],
            "species",
        )

        self.assertEqual(1, len(predictions))
        self.assertEqual(1, predictions[0].id)
        self.assertEqual("Japanese garden juniper", predictions[0].label)
        self.assertEqual("Juniperus procumbens", predictions[0].subtitle)
        self.assertAlmostEqual(1.0, predictions[0].confidence, places=6)

    def test_leaf_species_predictions_collapse_aliases_to_canonical_program_entry(self) -> None:
        predictions = rank_leaf_reference_predictions(
            [
                LeafReferenceCatalogMatch(id="leaf-ficus-1", species_label="Ficus retusa", score=0.91),
                LeafReferenceCatalogMatch(id="leaf-ficus-2", species_label="Banyan fig", score=0.86),
            ]
        )

        self.assertEqual(1, len(predictions))
        self.assertEqual(2, predictions[0].id)
        self.assertEqual("Banyan fig", predictions[0].label)
        self.assertEqual("Ficus retusa", predictions[0].subtitle)
        self.assertAlmostEqual(1.0, predictions[0].confidence, places=6)

    def test_species_predictions_preserve_unmapped_catalog_labels(self) -> None:
        predictions = rank_reference_predictions(
            [
                ReferenceCatalogMatch(
                    id="beech-korean",
                    species_label="Korean beech",
                    style_label="Formal upright (Chokkan)",
                    score=0.9,
                )
            ],
            "species",
        )

        self.assertEqual(1, len(predictions))
        self.assertIsNone(predictions[0].id)
        self.assertEqual("Korean beech", predictions[0].label)
        self.assertIsNone(predictions[0].subtitle)
        self.assertAlmostEqual(1.0, predictions[0].confidence, places=6)

    def test_task_specific_benchmark_manifest_is_honest_about_limitations(self) -> None:
        manifest = build_benchmark_manifest()

        self.assertEqual(55, manifest["catalog_count"])
        self.assertFalse(manifest["identity"]["available"])
        self.assertGreater(manifest["species"]["excluded_label_count"], 0)
        self.assertGreater(manifest["style"]["excluded_label_count"], 0)

        for task_name in ("species", "style"):
            task = manifest[task_name]
            train_ids = set(task["train_ids"])
            validation_ids = set(task["validation_ids"])
            test_ids = set(task["test_ids"])

            self.assertTrue(train_ids.isdisjoint(validation_ids))
            self.assertTrue(train_ids.isdisjoint(test_ids))
            self.assertTrue(validation_ids.isdisjoint(test_ids))

    def test_full_catalog_top_three_suggestions_cover_all_reviewed_images(self) -> None:
        result = evaluate_catalog_suggestion_coverage()

        self.assertEqual(55, result["catalog_count"])
        self.assertEqual(55, result["species"]["top3_hits"])
        self.assertEqual(55, result["style"]["top3_hits"])
        self.assertEqual([], result["species"]["failures"])
        self.assertEqual([], result["style"]["failures"])

    def test_current_style_path_produces_correct_label_in_top_three_for_supported_catalog_example(self) -> None:
        entry = next(item for item in self.catalog if item["id"] == "juniper-pescia-shakan")
        image_path = ROOT / "catalog" / str(entry["local_path"])
        image_bytes = image_path.read_bytes()
        taxonomy_embedding = compute_taxonomy_embedding(image_bytes)
        style_predictions = rank_reference_predictions(
            rank_style_reference_catalog_matches(
                taxonomy_embedding,
                compute_style_geometry_descriptor(image_bytes),
                query_style_metrics=compute_style_geometry_metrics(image_bytes),
            ),
            "style",
        )
        self.assertIn(entry["style_label"], [prediction.label for prediction in style_predictions[:3]])

    def test_style_photo_background_validation_accepts_solid_background(self) -> None:
        self.assertIsNone(validate_style_photo_background(build_style_quality_test_image(busy_background=False)))

    def test_style_photo_background_validation_rejects_busy_background(self) -> None:
        rejection = validate_style_photo_background(build_style_quality_test_image(busy_background=True))
        self.assertIsNotNone(rejection)
        self.assertIn("solid background", rejection or "")

    def test_style_photo_background_validation_accepts_centered_solid_panel(self) -> None:
        self.assertIsNone(validate_style_photo_background(build_panel_background_test_image()))

    def test_recognize_rejects_busy_background_for_existing_tree_candidates(self) -> None:
        response = self.client.post(
            "/recognize",
            files={"image": ("front.png", build_style_quality_test_image(busy_background=True), "image/png")},
            data={
                "candidates": json.dumps(
                    [
                        {
                            "treeId": "tree-1",
                            "photoId": "photo-1",
                            "embedding": [0.1, 0.2, 0.3],
                            "embeddingModel": "pixel-rgb-16",
                        }
                    ]
                )
            },
        )

        self.assertEqual(422, response.status_code)
        self.assertIn("solid background", response.json().get("detail", ""))

    def test_style_prototype_prior_prefers_moyogi_over_shakan_for_curved_upright_tree(self) -> None:
        descriptor = compute_style_geometry_descriptor(build_style_prototype_query_image("moyogi"))
        moyogi_score = score_style_prototype_similarity(descriptor, "Informal upright (Moyogi)")
        shakan_score = score_style_prototype_similarity(descriptor, "Slanting (Shakan)")

        self.assertIsNotNone(moyogi_score)
        self.assertIsNotNone(shakan_score)
        self.assertGreater(moyogi_score or 0.0, shakan_score or 0.0)

    def test_style_prototype_prior_prefers_double_trunk_for_split_trunk_tree(self) -> None:
        descriptor = compute_style_geometry_descriptor(build_style_prototype_query_image("double-trunk"))
        double_trunk_score = score_style_prototype_similarity(descriptor, "Double trunk (Sokan)")
        moyogi_score = score_style_prototype_similarity(descriptor, "Informal upright (Moyogi)")

        self.assertIsNotNone(double_trunk_score)
        self.assertIsNotNone(moyogi_score)
        self.assertGreater(double_trunk_score or 0.0, moyogi_score or 0.0)

    def test_style_geometry_metrics_detect_missing_support_and_double_trunk_shape(self) -> None:
        metrics = compute_style_geometry_metrics(build_style_prototype_query_image("double-trunk"))
        self.assertFalse(metrics.has_support_context)
        self.assertGreaterEqual(metrics.lower_peak_count, 0.12)
        self.assertLessEqual(metrics.lower_peak_count, 0.35)
        self.assertGreaterEqual(metrics.top_lower_shift, 0.025)



if __name__ == "__main__":
    unittest.main()