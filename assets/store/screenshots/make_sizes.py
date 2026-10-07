#!/usr/bin/env python3
"""
Convert raw App Store screenshots to Apple's required sizes.

Usage:
    python3 make_sizes.py

Reads PNG/JPG files from ./raw/ and writes:
    ./6.7/  -> 1290 x 2796  (iPhone 6.7")
    ./6.5/  -> 1242 x 2688  (iPhone 6.5")

Capture raws at 430x932 CSS @3x (= 1290x2796) so the 6.7" set is pixel-perfect.
The 6.5" set is center-cropped to the target aspect ratio, then LANCZOS-resized.
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
SIZES = {
    "6.7": (1290, 2796),
    "6.5": (1242, 2688),
}

def fit_crop_resize(img: Image.Image, tw: int, th: int) -> Image.Image:
    img = img.convert("RGB")
    sw, sh = img.size
    target_aspect = tw / th
    src_aspect = sw / sh
    if abs(src_aspect - target_aspect) > 0.001:
        # Center-crop to target aspect ratio
        if src_aspect > target_aspect:
            # too wide -> crop width
            nw = int(sh * target_aspect)
            x0 = (sw - nw) // 2
            img = img.crop((x0, 0, x0 + nw, sh))
        else:
            # too tall -> crop height
            nh = int(sw / target_aspect)
            y0 = (sh - nh) // 2
            img = img.crop((0, y0, sw, y0 + nh))
    if img.size != (tw, th):
        img = img.resize((tw, th), Image.LANCZOS)
    return img

def main():
    raws = sorted(f for f in os.listdir(RAW)
                  if f.lower().endswith((".png", ".jpg", ".jpeg")))
    if not raws:
        print("No raw screenshots found in", RAW)
        return
    for label, (tw, th) in SIZES.items():
        outdir = os.path.join(HERE, label)
        os.makedirs(outdir, exist_ok=True)
        for f in raws:
            name = os.path.splitext(f)[0] + ".png"
            img = Image.open(os.path.join(RAW, f))
            out = fit_crop_resize(img, tw, th)
            out.save(os.path.join(outdir, name))
            print(f"{label}: {name} <- {img.size if False else f} -> {(tw, th)}")
    print(f"Done: {len(raws)} raws -> {len(SIZES)} sizes each.")

if __name__ == "__main__":
    main()
