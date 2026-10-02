"""Shared utilities: timestamp parsing/formatting, font loading."""

import math

from PIL import ImageFont


def fmt_timestamp(seconds: float) -> str:
    """Format seconds as HH:MM:SS.ms or MM:SS.ms if < 1 hour."""
    if math.isnan(seconds) or math.isinf(seconds):
        return "??:??.??"
    if seconds < 0:
        return f"-{fmt_timestamp(-seconds)}"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:05.2f}"
    return f"{m:02d}:{s:05.2f}"


def parse_timestamp(value: str) -> float:
    """Parse a timestamp like '1:30', '01:02:03', '90', '1:30.5' into seconds."""
    value = value.strip()
    try:
        parts = value.split(":")
        if len(parts) == 3:
            result = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            result = float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            result = float(value)
        else:
            raise ValueError
    except (ValueError, IndexError):
        raise ValueError(f"Invalid timestamp format: '{value}' (expected e.g. 1:30, 01:02:03, 90)")

    if result < 0:
        raise ValueError(f"Timestamp must not be negative: '{value}'")
    return result


def parse_interval(value: str) -> float:
    """Parse an interval string like '5s', '1.5s', '500ms', or plain number (seconds)."""
    v = value.strip().lower()
    try:
        if v.endswith("ms"):
            result = float(v[:-2]) / 1000.0
        elif v.endswith("s"):
            result = float(v[:-1])
        else:
            result = float(v)
    except ValueError:
        raise ValueError(f"Invalid interval format: '{value}' (expected e.g. 5s, 500ms, 1.5)")

    if result <= 0:
        raise ValueError(f"Interval must be positive: '{value}'")
    return result


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try to load a suitable font, falling back gracefully."""
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()
