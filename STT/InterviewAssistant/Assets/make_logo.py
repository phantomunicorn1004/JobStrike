"""Draws the Interview Assistant logo: a caption bubble (the interviewer's words) with a spark
(the AI's answer) on a deep-blue tile, in the app's own theme colours."""
import math, sys
from PIL import Image, ImageDraw, ImageChops

OUT = sys.argv[1]
W = 1024  # master canvas; every size is drawn here, then downsampled

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
def hexc(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

TOP, BOTTOM = hexc("#4A6FD0"), hexc("#1B2550")      # tile gradient (accent → deep navy)
BUBBLE = hexc("#F4F7FF")
LINE = hexc("#3A60C6")                               # light-theme accent
LINE_FAINT = hexc("#9DB3EA")
SPARK = hexc("#A9C3FF")                              # dark-theme highlight

def star(cx, cy, r, inner=0.30, steps=40):
    """Four-point spark: tips joined by curves pulled toward the centre."""
    tips = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    pts = []
    for i in range(4):
        (x0, y0), (x2, y2) = tips[i], tips[(i + 1) % 4]
        # control point on the diagonal, inner*r from the centre
        mx, my = (x0 + x2) / 2 - cx, (y0 + y2) / 2 - cy
        n = math.hypot(mx, my)
        x1, y1 = cx + mx / n * r * inner, cy + my / n * r * inner
        for k in range(steps):
            t = k / steps
            pts.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2,
                        (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2))
    return pts

def draw(simple):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # Tile: rounded square with a vertical gradient.
    grad = Image.new("RGBA", (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(TOP, BOTTOM, y / (W - 1)) + (255,))
    mask = Image.new("L", (W, W), 0)
    pad = 24 if not simple else 0
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, W - pad, W - pad], radius=230 if not simple else 200, fill=255)
    img.paste(grad, (0, 0), mask)
    # Caption bubble with a tail at the lower left.
    layer = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(layer)
    if simple:
        box = [150, 210, 874, 720]
        d.rounded_rectangle(box, radius=150, fill=255)
        d.polygon([(250, 640), (430, 700), (210, 860)], fill=255)
    else:
        box = [176, 250, 820, 700]
        d.rounded_rectangle(box, radius=130, fill=255)
        d.polygon([(268, 630), (430, 690), (232, 830)], fill=255)

    spark_c, spark_r = ((786, 262), 176) if not simple else (None, 0)
    if spark_c:
        # cut a gap around the spark so it reads separately from the bubble
        gap = Image.new("L", (W, W), 0)
        ImageDraw.Draw(gap).polygon(star(*spark_c, spark_r + 58, inner=0.42), fill=255)
        layer = ImageChops.subtract(layer, gap)
    img.paste(Image.new("RGBA", (W, W), BUBBLE + (255,)), (0, 0), layer)

    # Caption lines inside the bubble (the last one shorter, still being spoken).
    d = ImageDraw.Draw(img)
    if simple:
        rows = [(250, 360, 774, LINE), (250, 545, 610, LINE)]
        h = 100
    else:
        rows = [(268, 372, 640, LINE), (268, 475, 728, LINE), (268, 578, 520, LINE_FAINT)]
        h = 58
    for x0, y, x1, col in rows:
        d.rounded_rectangle([x0, y - h // 2, x1, y + h // 2], radius=h // 2, fill=col + (255,))

    if spark_c:
        d.polygon(star(*spark_c, spark_r), fill=SPARK + (255,))
        d.polygon(star(spark_c[0] + 132, spark_c[1] + 158, 56), fill=SPARK + (255,))
    return img

full, simple = draw(False), draw(True)
sizes = [256, 128, 64, 48, 40, 32, 24, 20, 16]
frames = [(simple if s <= 24 else full).resize((s, s), Image.LANCZOS) for s in sizes]
frames[0].save(OUT + "/AppIcon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[1:])
full.resize((512, 512), Image.LANCZOS).save(OUT + "/AppIcon.png")

# Preview sheet: every size on dark and light backgrounds, enlarged 3x with nearest-neighbour for small ones.
sheet = Image.new("RGB", (1200, 560), hexc("#14161B"))
ImageDraw.Draw(sheet).rectangle([0, 280, 1200, 560], fill=hexc("#F3F4F7"))
for row, y in ((0, 10), (1, 290)):
    x = 10
    for f in frames:
        big = f if f.width >= 128 else f.resize((f.width * 3, f.height * 3), Image.NEAREST)
        sheet.paste(big, (x, y), big)
        x += big.width + 14
sheet.save(OUT + "/preview.png")
check = Image.open(OUT + "/AppIcon.ico")
print("ico sizes:", sorted(check.info["sizes"]))
