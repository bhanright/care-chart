"""Builds the app icons from the logo (public/images/logo.png, a transparent PNG):

    public/icons/care-chart-192.png and -512.png  the installed app's icons, the logo on
                                                  white with room for Android's round and
                                                  squircle masks ("maskable")
    public/icons/apple-touch-icon.png             the iPhone and iPad home-screen icon
    public/icons/badge-96.png                     the notification badge; Android draws only
                                                  its shape, as a white silhouette

When the icons change, give them new file names (and update manifest.webmanifest,
index.html, app.js and sw.js), so installed copies notice the change.
Needs Pillow:  python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent.parent / "public"
ICONS = PUBLIC / "icons"


def logo_on_white(logo: Image.Image, size: int, logo_share: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    mark = logo.resize((round(size * logo_share),) * 2, Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas.convert("RGB")


def main() -> None:
    logo = Image.open(PUBLIC / "images" / "logo.png").convert("RGBA")
    ICONS.mkdir(exist_ok=True)
    # 62% keeps the whole cross inside the maskable safe zone (a circle of 80%).
    logo_on_white(logo, 192, 0.62).save(ICONS / "care-chart-192.png", optimize=True)
    logo_on_white(logo, 512, 0.62).save(ICONS / "care-chart-512.png", optimize=True)
    # iOS rounds the corners itself and crops nothing, so the logo can be larger.
    logo_on_white(logo, 180, 0.70).save(ICONS / "apple-touch-icon.png", optimize=True)

    badge = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    silhouette = Image.new("RGBA", (88, 88), (255, 255, 255, 255))
    silhouette.putalpha(logo.resize((88, 88), Image.LANCZOS).getchannel("A"))
    badge.alpha_composite(silhouette, (4, 4))
    badge.save(ICONS / "badge-96.png", optimize=True)
    print("Wrote", ", ".join(path.name for path in sorted(ICONS.glob("*.png"))))


if __name__ == "__main__":
    main()
