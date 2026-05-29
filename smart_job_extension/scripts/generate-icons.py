#!/usr/bin/env python3
"""Generate Chrome extension PNG icons from the brand lightning mark."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"

TOP = (6, 182, 212, 255)
BOTTOM = (8, 145, 178, 255)
LIGHTNING = [
    (13, 2),
    (4, 14),
    (11, 14),
    (10, 22),
    (19, 10),
    (12, 10),
]


def lerp(a, b, t):
    return int(a + (b - a) * t)


def make_gradient(size, radius):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    denom = max(size - 1, 1) * 2
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = (
                lerp(TOP[0], BOTTOM[0], t),
                lerp(TOP[1], BOTTOM[1], t),
                lerp(TOP[2], BOTTOM[2], t),
                255,
            )
    img.paste(grad, mask=mask)
    return img


def scale_lightning(size, pad_ratio=0.22):
    inner = size * (1 - 2 * pad_ratio)
    scale = inner / 24
    ox = size * pad_ratio
    oy = size * pad_ratio
    return [(ox + x * scale, oy + y * scale) for x, y in LIGHTNING]


def render(size):
    radius = max(4, int(size * 0.28))
    img = make_gradient(size, radius)
    draw = ImageDraw.Draw(img)
    draw.polygon(scale_lightning(size), fill=(255, 255, 255, 255))
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon-{size}.png"
        render(size).save(path, format="PNG", optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
