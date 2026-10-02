"""Mosaic composition: arrange frames into a grid image."""

import math
from collections.abc import Callable
from pathlib import Path

from PIL import Image, ImageDraw

from .utils import fmt_timestamp, load_font

MAX_CANVAS_PIXELS = 178_000_000  # Pillow's default DecompressionBomb limit


def compose_mosaic(
    frames: list[tuple[Path, float]],
    output_path: str,
    cols: int | None = None,
    thumb_width: int = 720,
    padding: int = 2,
    bg_color: str = "#1a1a1a",
    labels: bool = False,
    header_info: dict | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> Image.Image:
    """Arrange frames into a grid and save the resulting image. Returns the canvas."""
    if not frames:
        raise ValueError("No frames to compose.")

    # Determine thumbnail size from the first frame's aspect ratio
    with Image.open(frames[0][0]) as sample:
        if sample.width == 0:
            raise ValueError("First frame has zero width — corrupted image.")
        aspect = sample.height / sample.width
    thumb_height = int(thumb_width * aspect)

    total = len(frames)
    if cols is None:
        cols = math.ceil(math.sqrt(total))
    if cols < 1:
        raise ValueError("cols must be at least 1.")
    rows = math.ceil(total / cols)

    # Scale font size proportionally to thumbnail width
    font_size = max(12, int(thumb_width * 0.04))
    label_h = int(font_size * 1.6) if labels else 0
    cell_w = thumb_width + padding
    cell_h = thumb_height + padding + label_h

    # Header
    header_h = 0
    header_font = None
    header_font_small = None
    if header_info:
        header_font = load_font(max(16, int(thumb_width * 0.05)))
        header_font_small = load_font(max(12, int(thumb_width * 0.035)))
        header_h = int(font_size * 5)

    canvas_w = cols * cell_w + padding
    canvas_h = rows * cell_h + padding + header_h

    canvas = Image.new("RGB", (canvas_w, canvas_h), bg_color)
    draw = ImageDraw.Draw(canvas)

    # Draw header
    if header_info and header_font and header_font_small:
        hx = padding + 8
        hy = padding + 8
        draw.text((hx, hy), header_info["filename"], fill="#ffffff", font=header_font)
        meta_line = (
            f"{header_info['width']}×{header_info['height']}  •  "
            f"{header_info['duration']:.1f}s  •  "
            f"{header_info['fps']:.2f} fps  •  "
            f"{total} frames"
        )
        draw.text((hx, hy + int(font_size * 2)), meta_line, fill="#888888", font=header_font_small)

    # Font for labels
    font = load_font(font_size) if labels else None

    for idx, (fpath, ts) in enumerate(frames):
        col = idx % cols
        row = idx // cols
        x = padding + col * cell_w
        y = padding + row * cell_h + header_h

        with Image.open(fpath) as img:
            resized = img.resize((thumb_width, thumb_height), Image.LANCZOS)
        canvas.paste(resized, (x, y))
        resized.close()

        if labels and font is not None:
            label_text = f"#{idx + 1}  {fmt_timestamp(ts)}"
            draw.text(
                (x + 6, y + thumb_height + (label_h - font_size) // 2),
                label_text,
                fill="#cccccc",
                font=font,
            )

        if on_progress:
            on_progress(idx + 1, total)

    # Save image
    ext = Path(output_path).suffix.lower()
    save_kwargs: dict = {}
    if ext in (".jpg", ".jpeg"):
        save_kwargs = {"quality": 92, "optimize": True}
    elif ext == ".webp":
        save_kwargs = {"quality": 90}
    elif ext == ".png":
        save_kwargs = {"compress_level": 6}

    canvas.save(output_path, **save_kwargs)
    return canvas
