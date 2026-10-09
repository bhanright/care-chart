"""Draws the PNG app icons (public/icon-192.png, icon-512.png) to match public/icon.svg."""
from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"

def draw(size: int) -> Image.Image:
    unit = size / 64  # the SVG is drawn on a 64-unit grid
    image = Image.new("RGB", (size, size), "#2b6f73")
    pen = ImageDraw.Draw(image)
    scaled = lambda *points: [round(value * unit) for value in points]
    pen.rectangle(scaled(12, 8, 52, 58), fill="white", outline="black", width=max(1, round(2 * unit)))
    pen.rectangle(scaled(22, 4, 42, 14), fill="#c0c0c0", outline="black", width=max(1, round(2 * unit)))
    trace = [(17, 36), (25, 36), (29, 24), (36, 46), (40, 36), (47, 36)]
    pen.line([(x * unit, y * unit) for x, y in trace], fill="#c00000", width=max(2, round(4 * unit)), joint="curve")
    return image

for size in (192, 512):
    draw(size).save(PUBLIC / f"icon-{size}.png")
