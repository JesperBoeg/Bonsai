from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw


GRID_SIZE = 16
PROFILE_BINS = 16
SUMMARY_FEATURE_COUNT = 13
DESCRIPTOR_SIZE = (GRID_SIZE * GRID_SIZE) + PROFILE_BINS + PROFILE_BINS + SUMMARY_FEATURE_COUNT
STYLE_PHOTO_BACKGROUND_GUIDANCE = (
    "Front photo rejected: use a clear solid background behind the bonsai. "
    "Place a plain board, cloth, or wall behind the tree and retake the photo."
)
MAX_BORDER_COLOR_SPREAD = 0.18
MAX_BACKGROUND_COLOR_SPREAD = 0.16
MAX_BORDER_FOREGROUND_RATIO = 0.08
MAX_CENTER_BACKGROUND_SPREAD = 0.42
STYLE_PROTOTYPE_CANVAS_SIZE = 256


@dataclass(frozen=True)
class StyleGeometryMetrics:
    has_support_context: bool
    aspect_ratio: float
    lower_peak_count: float
    top_lower_shift: float


@dataclass(frozen=True)
class StylePhotoAnalysis:
    background_guidance: str | None
    descriptor: list[float]
    metrics: StyleGeometryMetrics


def compute_style_geometry_descriptor(image_bytes: bytes) -> list[float]:
    image_array = load_style_image_array(image_bytes)
    return analyze_style_geometry(image_array)[0].tolist()


def compute_style_geometry_metrics(image_bytes: bytes) -> StyleGeometryMetrics:
    image_array = load_style_image_array(image_bytes)
    return analyze_style_geometry(image_array)[1]


def validate_style_photo_background(image_bytes: bytes) -> str | None:
    image_array = load_style_image_array(image_bytes)
    return validate_style_photo_background_array(image_array)


def analyze_style_photo(image_bytes: bytes) -> StylePhotoAnalysis:
    image_array = load_style_image_array(image_bytes)
    descriptor, metrics = analyze_style_geometry(image_array)
    return StylePhotoAnalysis(
        background_guidance=validate_style_photo_background_array(image_array),
        descriptor=descriptor.tolist(),
        metrics=metrics,
    )


def score_style_prototype_similarity(style_geometry_descriptor: list[float] | np.ndarray, style_label: str) -> float | None:
    prototype_descriptor = load_style_prototype_descriptors().get(style_label)
    if prototype_descriptor is None:
        return None

    return cosine_similarity(style_geometry_descriptor, prototype_descriptor)


def analyze_style_geometry(image: np.ndarray) -> tuple[np.ndarray, StyleGeometryMetrics]:
    mask = compute_foreground_mask(image)
    descriptor, metrics = build_descriptor(mask, return_metrics=True)
    return descriptor, metrics


def load_style_image_array(image_bytes: bytes) -> np.ndarray:
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    image = downsample_image(image)
    return np.asarray(image, dtype=np.float32) / 255.0


def validate_style_photo_background_array(image: np.ndarray) -> str | None:
    height, width, _ = image.shape
    border_mask = build_border_mask(height, width)
    border_pixels = image[border_mask]

    mask = compute_foreground_mask(image)
    if not mask.any():
        return STYLE_PHOTO_BACKGROUND_GUIDANCE

    center_background_pixels = extract_center_background_pixels(image, mask)
    if len(center_background_pixels) > 0 and measure_color_spread(center_background_pixels) <= MAX_CENTER_BACKGROUND_SPREAD:
        return None

    if measure_color_spread(border_pixels) > MAX_BORDER_COLOR_SPREAD:
        return STYLE_PHOTO_BACKGROUND_GUIDANCE

    if float(mask[border_mask].mean()) > MAX_BORDER_FOREGROUND_RATIO:
        return STYLE_PHOTO_BACKGROUND_GUIDANCE

    background_pixels = image[~mask]
    if len(background_pixels) == 0:
        return STYLE_PHOTO_BACKGROUND_GUIDANCE

    if measure_color_spread(background_pixels) > MAX_BACKGROUND_COLOR_SPREAD:
        return STYLE_PHOTO_BACKGROUND_GUIDANCE

    return None


def cosine_similarity(left: list[float] | np.ndarray, right: list[float] | np.ndarray) -> float:
    left_vector = np.asarray(left, dtype=np.float32)
    right_vector = np.asarray(right, dtype=np.float32)
    left_norm = np.linalg.norm(left_vector)
    right_norm = np.linalg.norm(right_vector)

    if left_norm == 0 or right_norm == 0:
        return 0.0

    similarity = float(np.dot(left_vector, right_vector) / (left_norm * right_norm))
    return max(min(similarity, 1.0), -1.0)


def blend_style_similarity(embedding_score: float, geometry_score: float, geometry_weight: float) -> float:
    clamped_weight = min(max(geometry_weight, 0.0), 1.0)
    return ((1.0 - clamped_weight) * embedding_score) + (clamped_weight * geometry_score)


def downsample_image(image: Image.Image, max_dimension: int = 256) -> Image.Image:
    width, height = image.size
    largest_dimension = max(width, height)
    if largest_dimension <= max_dimension:
        return image

    scale = max_dimension / float(largest_dimension)
    resized_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(resized_size, Image.Resampling.LANCZOS)


def build_border_mask(height: int, width: int) -> np.ndarray:
    border = max(2, round(min(height, width) * 0.06))
    border_mask = np.zeros((height, width), dtype=bool)
    border_mask[:border, :] = True
    border_mask[-border:, :] = True
    border_mask[:, :border] = True
    border_mask[:, -border:] = True
    return border_mask


def measure_color_spread(pixels: np.ndarray) -> float:
    if pixels.size == 0:
        return 1.0

    median_color = np.median(pixels, axis=0)
    distances = np.linalg.norm(pixels - median_color, axis=1)
    return float(np.percentile(distances, 90))


def extract_center_background_pixels(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    height, width, _ = image.shape
    row_start = round(height * 0.10)
    row_end = round(height * 0.82)
    column_start = round(width * 0.18)
    column_end = round(width * 0.82)
    center_mask = np.zeros((height, width), dtype=bool)
    center_mask[row_start:row_end, column_start:column_end] = True
    return image[center_mask & ~mask]


@lru_cache(maxsize=1)
def load_style_prototype_descriptors() -> dict[str, np.ndarray]:
    descriptors: dict[str, np.ndarray] = {}

    for label in (
        "Broom (Hokidachi)",
        "Double trunk (Sokan)",
        "Forest (Yose-ue)",
        "Formal upright (Chokkan)",
        "Informal upright (Moyogi)",
        "Literati (Bunjingi)",
        "Multi-trunk (Kabudachi)",
        "Raft (Ikadabuki)",
        "Slanting (Shakan)",
        "Windswept (Fukinagashi)",
    ):
        descriptors[label] = build_style_prototype_descriptor(label)

    return descriptors


def build_style_prototype_descriptor(style_label: str) -> np.ndarray:
    return build_descriptor(render_style_prototype_mask(style_label))


def render_style_prototype_mask(style_label: str) -> np.ndarray:
    image = Image.new("L", (STYLE_PROTOTYPE_CANVAS_SIZE, STYLE_PROTOTYPE_CANVAS_SIZE), 0)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((78, 220, 178, 242), fill=255, radius=5)

    if style_label == "Formal upright (Chokkan)":
        draw.line(((128, 220), (128, 170), (128, 118), (128, 66)), fill=255, width=18)
        draw.ellipse((84, 138, 172, 188), fill=255)
        draw.ellipse((74, 98, 182, 150), fill=255)
        draw.ellipse((92, 54, 164, 104), fill=255)
    elif style_label == "Informal upright (Moyogi)":
        draw.line(((126, 220), (116, 178), (136, 136), (118, 96), (128, 54)), fill=255, width=18)
        draw.ellipse((66, 144, 148, 192), fill=255)
        draw.ellipse((104, 108, 194, 156), fill=255)
        draw.ellipse((64, 74, 150, 124), fill=255)
        draw.ellipse((98, 36, 168, 84), fill=255)
    elif style_label == "Slanting (Shakan)":
        draw.line(((114, 220), (130, 176), (152, 134), (176, 92), (202, 52)), fill=255, width=18)
        draw.ellipse((82, 148, 164, 194), fill=255)
        draw.ellipse((128, 114, 214, 160), fill=255)
        draw.ellipse((146, 74, 230, 120), fill=255)
        draw.ellipse((170, 36, 236, 78), fill=255)
    elif style_label == "Double trunk (Sokan)":
        draw.line(((120, 220), (112, 178), (100, 136), (86, 94)), fill=255, width=14)
        draw.line(((132, 220), (142, 182), (156, 142), (174, 102), (188, 62)), fill=255, width=14)
        draw.ellipse((54, 82, 130, 138), fill=255)
        draw.ellipse((112, 122, 194, 172), fill=255)
        draw.ellipse((138, 58, 222, 118), fill=255)
    elif style_label == "Multi-trunk (Kabudachi)":
        for points in (
            ((102, 220), (94, 182), (86, 144), (80, 108)),
            ((116, 220), (112, 178), (108, 138), (104, 98)),
            ((132, 220), (136, 178), (142, 138), (148, 100)),
            ((146, 220), (154, 182), (164, 146), (176, 110)),
        ):
            draw.line(points, fill=255, width=12)
        draw.ellipse((54, 96, 122, 148), fill=255)
        draw.ellipse((86, 68, 164, 126), fill=255)
        draw.ellipse((130, 86, 208, 142), fill=255)
        draw.ellipse((152, 118, 222, 168), fill=255)
    elif style_label == "Broom (Hokidachi)":
        draw.line(((128, 220), (128, 174), (128, 130)), fill=255, width=18)
        draw.ellipse((58, 64, 198, 158), fill=255)
        draw.ellipse((76, 40, 180, 120), fill=255)
    elif style_label == "Literati (Bunjingi)":
        draw.line(((122, 220), (126, 184), (138, 144), (154, 106), (164, 68), (170, 42)), fill=255, width=10)
        draw.ellipse((144, 28, 212, 78), fill=255)
        draw.ellipse((126, 64, 182, 104), fill=255)
    elif style_label == "Forest (Yose-ue)":
        for points, width in (
            (((84, 220), (84, 170), (82, 122)), 12),
            (((112, 220), (112, 164), (112, 108)), 16),
            (((142, 220), (142, 176), (144, 126)), 12),
            (((164, 220), (166, 184), (170, 146)), 10),
        ):
            draw.line(points, fill=255, width=width)
        draw.ellipse((46, 82, 122, 136), fill=255)
        draw.ellipse((74, 56, 160, 128), fill=255)
        draw.ellipse((120, 70, 208, 140), fill=255)
        draw.ellipse((150, 102, 220, 156), fill=255)
    elif style_label == "Raft (Ikadabuki)":
        draw.line(((82, 206), (104, 196), (132, 186), (160, 178), (188, 168)), fill=255, width=16)
        for points in (
            ((108, 194), (108, 150), (108, 108)),
            ((138, 184), (138, 144), (138, 102)),
            ((168, 174), (168, 138), (168, 96)),
        ):
            draw.line(points, fill=255, width=11)
        draw.ellipse((78, 90, 136, 138), fill=255)
        draw.ellipse((110, 84, 168, 132), fill=255)
        draw.ellipse((140, 78, 198, 126), fill=255)
    elif style_label == "Windswept (Fukinagashi)":
        draw.line(((118, 220), (126, 182), (138, 144), (154, 104), (166, 68)), fill=255, width=16)
        draw.ellipse((116, 138, 198, 184), fill=255)
        draw.ellipse((134, 102, 220, 150), fill=255)
        draw.ellipse((150, 66, 232, 112), fill=255)
        draw.ellipse((166, 34, 236, 76), fill=255)
    else:
        return np.zeros((STYLE_PROTOTYPE_CANVAS_SIZE, STYLE_PROTOTYPE_CANVAS_SIZE), dtype=bool)

    return np.asarray(image, dtype=np.uint8) > 0


def compute_foreground_mask(image: np.ndarray) -> np.ndarray:
    height, width, _ = image.shape
    border_mask = build_border_mask(height, width)

    border_pixels = image[border_mask]
    background_color = np.median(border_pixels, axis=0)
    background_gray = np.median(border_pixels.mean(axis=1))
    background_saturation = np.median(border_pixels.max(axis=1) - border_pixels.min(axis=1))

    color_distance = np.linalg.norm(image - background_color, axis=2)
    gray = image.mean(axis=2)
    saturation = image.max(axis=2) - image.min(axis=2)

    border_distances = color_distance[border_mask]
    distance_threshold = max(float(np.percentile(border_distances, 95)) + 0.05, 0.12)
    saturation_threshold = max(float(background_saturation) + 0.08, 0.12)
    darkness_threshold = float(background_gray) - 0.12

    mask = (color_distance >= distance_threshold) | (saturation >= saturation_threshold) | (gray <= darkness_threshold)
    mask = majority_filter(mask, minimum_neighbors=4, iterations=1)
    mask = keep_largest_component(mask)
    mask = majority_filter(mask, minimum_neighbors=3, iterations=1)
    return mask


def majority_filter(mask: np.ndarray, minimum_neighbors: int, iterations: int) -> np.ndarray:
    filtered = mask.astype(np.uint8)
    for _ in range(iterations):
        padded = np.pad(filtered, 1)
        neighbor_count = np.zeros_like(filtered, dtype=np.uint8)

        for row_offset in (-1, 0, 1):
            for column_offset in (-1, 0, 1):
                neighbor_count += padded[
                    1 + row_offset : 1 + row_offset + filtered.shape[0],
                    1 + column_offset : 1 + column_offset + filtered.shape[1],
                ]

        filtered = (neighbor_count >= minimum_neighbors).astype(np.uint8)

    return filtered.astype(bool)


def keep_largest_component(mask: np.ndarray) -> np.ndarray:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    largest_component: list[tuple[int, int]] = []

    for row in range(height):
        for column in range(width):
            if not mask[row, column] or visited[row, column]:
                continue

            component: list[tuple[int, int]] = []
            stack = [(row, column)]
            visited[row, column] = True

            while stack:
                current_row, current_column = stack.pop()
                component.append((current_row, current_column))

                for row_delta in (-1, 0, 1):
                    for column_delta in (-1, 0, 1):
                        if row_delta == 0 and column_delta == 0:
                            continue

                        neighbor_row = current_row + row_delta
                        neighbor_column = current_column + column_delta
                        if neighbor_row < 0 or neighbor_row >= height or neighbor_column < 0 or neighbor_column >= width:
                            continue
                        if visited[neighbor_row, neighbor_column] or not mask[neighbor_row, neighbor_column]:
                            continue

                        visited[neighbor_row, neighbor_column] = True
                        stack.append((neighbor_row, neighbor_column))

            if len(component) > len(largest_component):
                largest_component = component

    if not largest_component:
        return np.zeros_like(mask, dtype=bool)

    filtered = np.zeros_like(mask, dtype=bool)
    for row, column in largest_component:
        filtered[row, column] = True
    return filtered


def build_descriptor(mask: np.ndarray, return_metrics: bool = False) -> np.ndarray | tuple[np.ndarray, StyleGeometryMetrics]:
    if not mask.any():
        empty_descriptor = np.zeros(DESCRIPTOR_SIZE, dtype=np.float32)
        if return_metrics:
            return empty_descriptor, StyleGeometryMetrics(
                has_support_context=False,
                aspect_ratio=0.0,
                lower_peak_count=0.0,
                top_lower_shift=0.0,
            )
        return empty_descriptor

    tree_mask, support_mask = split_tree_and_support_masks(mask)
    if not tree_mask.any():
        tree_mask = mask.copy()
        support_mask = np.zeros_like(mask, dtype=bool)

    coordinates = np.argwhere(tree_mask)
    min_row, min_column = coordinates.min(axis=0)
    max_row, max_column = coordinates.max(axis=0)
    cropped_mask = tree_mask[min_row : max_row + 1, min_column : max_column + 1].astype(np.float32)

    resized_mask = resize_mask(cropped_mask, GRID_SIZE)
    full_mask = tree_mask.astype(np.float32)
    row_profile = resize_profile(full_mask.sum(axis=1), PROFILE_BINS)
    column_profile = resize_profile(full_mask.sum(axis=0), PROFILE_BINS)
    total_mass = float(full_mask.sum())

    height, width = full_mask.shape
    centroid_row = float(coordinates[:, 0].mean() / max(height - 1, 1))
    centroid_column = float(coordinates[:, 1].mean() / max(width - 1, 1))
    bbox_height = float((max_row - min_row + 1) / height)
    bbox_width = float((max_column - min_column + 1) / width)
    aspect_ratio = bbox_width / max(bbox_height, 1e-6)
    top_half_ratio = float(full_mask[: height // 2, :].sum() / total_mass)
    horizontal_imbalance = abs(float(full_mask[:, : width // 2].sum() / total_mass) - 0.5) * 2.0
    bottom_third_ratio = float(full_mask[(2 * height) // 3 :, :].sum() / total_mass)
    axis_lean = compute_axis_lean(coordinates)
    lower_peak_count = compute_lower_peak_count(cropped_mask)
    top_lower_shift = compute_top_lower_shift(cropped_mask)
    support_mass_ratio = float(support_mask.sum() / max(mask.sum(), 1))
    support_height_ratio = float(support_mask.any(axis=1).sum() / max(mask.shape[0], 1))

    summary = np.asarray(
        [
            centroid_row,
            centroid_column,
            bbox_height,
            bbox_width,
            min(aspect_ratio, 4.0) / 4.0,
            top_half_ratio,
            horizontal_imbalance,
            bottom_third_ratio,
            axis_lean,
            lower_peak_count,
            top_lower_shift,
            support_mass_ratio,
            support_height_ratio,
        ],
        dtype=np.float32,
    )

    descriptor = np.concatenate([resized_mask.ravel(), row_profile, column_profile, summary]).astype(np.float32)
    norm = np.linalg.norm(descriptor)
    if norm != 0:
        descriptor = descriptor / norm

    if not return_metrics:
        return descriptor

    return descriptor, StyleGeometryMetrics(
        has_support_context=bool(support_mask.any()),
        aspect_ratio=float(aspect_ratio),
        lower_peak_count=float(lower_peak_count),
        top_lower_shift=float(top_lower_shift),
    )


def resize_mask(mask: np.ndarray, grid_size: int) -> np.ndarray:
    image = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    resized = image.resize((grid_size, grid_size), Image.Resampling.BILINEAR)
    return np.asarray(resized, dtype=np.float32) / 255.0


def resize_profile(profile: np.ndarray, size: int) -> np.ndarray:
    if float(profile.sum()) == 0.0:
        return np.zeros(size, dtype=np.float32)

    image = Image.fromarray(profile.astype(np.float32).reshape(1, -1), mode="F")
    resized = image.resize((size, 1), Image.Resampling.BILINEAR)
    values = np.asarray(resized, dtype=np.float32).reshape(-1)
    return values / max(float(values.sum()), 1e-6)


def split_tree_and_support_masks(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    row_occupancy = mask.mean(axis=1)
    search_start = round(mask.shape[0] * 0.65)
    support_start: int | None = None

    for row in range(search_start, mask.shape[0] - 2):
        window = row_occupancy[row : row + 3]
        if float(window.mean()) >= 0.45 and float(window.max()) >= 0.55:
            support_start = row
            break

    if support_start is None:
        return mask.copy(), np.zeros_like(mask, dtype=bool)

    tree_mask = mask.copy()
    tree_mask[support_start:, :] = False
    support_mask = mask.copy()
    support_mask[:support_start, :] = False

    if tree_mask.sum() < max(mask.sum() * 0.15, 32):
        return mask.copy(), np.zeros_like(mask, dtype=bool)

    return tree_mask, support_mask


def compute_axis_lean(coordinates: np.ndarray) -> float:
    if len(coordinates) < 3:
        return 0.0

    centered = coordinates.astype(np.float32)
    centered[:, 0] -= centered[:, 0].mean()
    centered[:, 1] -= centered[:, 1].mean()
    covariance = np.cov(centered.T)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    principal_vector = eigenvectors[:, int(np.argmax(eigenvalues))]
    vertical_magnitude = abs(float(principal_vector[0]))
    horizontal_magnitude = abs(float(principal_vector[1]))
    return horizontal_magnitude / max(vertical_magnitude + horizontal_magnitude, 1e-6)


def compute_lower_peak_count(cropped_mask: np.ndarray) -> float:
    start_row = max(0, round(cropped_mask.shape[0] * 0.35))
    end_row = max(start_row + 1, round(cropped_mask.shape[0] * 0.8))
    trunk_band = cropped_mask[start_row:end_row, :]
    signal = trunk_band.mean(axis=0)
    if signal.size < 3 or float(signal.max()) == 0.0:
        return 0.0

    smoothed = np.convolve(signal, np.asarray([0.25, 0.5, 0.25], dtype=np.float32), mode="same")
    threshold = max(float(smoothed.max()) * 0.35, 0.03)
    peak_count = 0
    in_peak = False

    for index in range(1, len(smoothed) - 1):
        is_peak = smoothed[index] >= threshold and smoothed[index] >= smoothed[index - 1] and smoothed[index] >= smoothed[index + 1]
        if is_peak and not in_peak:
            peak_count += 1
            in_peak = True
        elif smoothed[index] < threshold:
            in_peak = False

    return min(float(peak_count), 6.0) / 6.0


def compute_top_lower_shift(cropped_mask: np.ndarray) -> float:
    if not cropped_mask.any():
        return 0.0

    split_row = max(1, round(cropped_mask.shape[0] * 0.45))
    top = cropped_mask[:split_row, :]
    lower = cropped_mask[split_row:, :]
    if not top.any() or not lower.any():
        return 0.0

    top_columns = np.argwhere(top)[:, 1]
    lower_columns = np.argwhere(lower)[:, 1]
    shift = abs(float(top_columns.mean()) - float(lower_columns.mean()))
    return min(shift / max(cropped_mask.shape[1] - 1, 1), 1.0)