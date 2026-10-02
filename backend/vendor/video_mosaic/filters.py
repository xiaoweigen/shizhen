"""Frame filtering: skip black frames and near-duplicate frames."""

from collections.abc import Callable
from pathlib import Path

from PIL import Image


def is_black_frame(img: Image.Image, threshold: int = 15) -> bool:
    """Return True if the frame is mostly black."""
    grayscale = img.convert("L")
    pixels = list(grayscale.getdata())
    if not pixels:
        return True
    avg = sum(pixels) / len(pixels)
    return avg < threshold


def is_duplicate(img_a: Image.Image, img_b: Image.Image, threshold: float = 0.98) -> bool:
    """Return True if two frames are nearly identical (by average pixel similarity)."""
    if img_a.size != img_b.size:
        return False

    size = (64, 64)
    a = list(img_a.resize(size, Image.BILINEAR).convert("L").getdata())
    b = list(img_b.resize(size, Image.BILINEAR).convert("L").getdata())

    total = len(a)
    if total == 0:
        return True
    matching = sum(1 for x, y in zip(a, b) if abs(x - y) < 10)
    return (matching / total) >= threshold


def filter_frames(
    frames: list[tuple[Path, float]],
    skip_black: bool = False,
    skip_dupes: bool = False,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[list[tuple[Path, float]], int]:
    """Filter out black and/or duplicate frames.

    Returns:
        Tuple of (filtered_frames, removed_count).
    """
    if not skip_black and not skip_dupes:
        return frames, 0

    result: list[tuple[Path, float]] = []
    prev_img: Image.Image | None = None
    removed = 0
    total = len(frames)

    for i, (fpath, ts) in enumerate(frames):
        with Image.open(fpath) as img:
            if skip_black and is_black_frame(img):
                removed += 1
                if on_progress:
                    on_progress(i + 1, total)
                continue
            if skip_dupes and prev_img is not None and is_duplicate(prev_img, img):
                removed += 1
                if on_progress:
                    on_progress(i + 1, total)
                continue
            if prev_img is not None:
                prev_img.close()
            prev_img = img.copy()
        result.append((fpath, ts))
        if on_progress:
            on_progress(i + 1, total)

    if prev_img is not None:
        prev_img.close()

    return result, removed
