#!/usr/bin/env python3
"""Checks every PNG/JPG under a folder against the App Store and Google Play
slots: size, aspect ratio and transparency. Part of the flutter-store-assets
skill. Exit code 1 if any file fits no slot or still has transparency.

  python verify_sizes.py build/store_assets          # report only
  python verify_sizes.py build/store_assets --fix    # also flatten alpha

Sizes from Apple "Screenshot specifications" and Google Play "Preview assets"
(checked Oct 2026). Re-check the consoles before a release; they change.
"""
import os
import sys

from PIL import Image

APPLE = {
    (1206, 2622): 'App Store iPhone (Dynamic Island, medium) — REQUIRED slot',
    (1179, 2556): 'App Store iPhone (Dynamic Island, medium) — REQUIRED slot',
    (1260, 2736): 'App Store iPhone (Dynamic Island, large)',
    (1284, 2778): 'App Store iPhone (Face ID, large)',
    (1242, 2688): 'App Store iPhone (Face ID, large)',
    (1170, 2532): 'App Store iPhone (Face ID, medium)',
    (2064, 2752): 'App Store iPad 13" — required if the app supports iPad',
    (2048, 2732): 'App Store iPad 13"/12.9"',
    (5244, 2950): 'App Store product page header component',
    (3840, 1646): 'App Store product page header component',
}
GOOGLE_FIXED = {
    (1024, 500): 'Google Play feature graphic',
    (512, 512): 'Google Play app icon (alpha allowed)',
    (1280, 720): 'Google Play Android TV banner',
}
ALPHA_ALLOWED = {(512, 512)}


def google_slots(w, h):
    slots = []
    short, long = min(w, h), max(w, h)
    if short >= 320 and long <= 3840 and long <= 2 * short:
        promo = short >= 1080 and abs(long / short - 16 / 9) < 0.02
        slots.append('Google Play phone screenshot' + (' (promotion-ready 9:16)' if promo else ''))
    if 1080 <= short and long <= 7680 and abs(long / short - 16 / 9) < 0.02:
        slots.append('Google Play tablet/Chromebook screenshot')
    return slots


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fix = '--fix' in sys.argv
    root = args[0] if args else 'build/store_assets'
    problems = 0
    for folder, _, files in sorted(os.walk(root)):
        for name in sorted(files):
            if not name.lower().endswith(('.png', '.jpg', '.jpeg')):
                continue
            path = os.path.join(folder, name)
            img = Image.open(path)
            w, h = img.size
            slots = [s for s in (APPLE.get((w, h)), GOOGLE_FIXED.get((w, h))) if s]
            if (w, h) not in GOOGLE_FIXED:
                slots += google_slots(w, h)
            alpha = img.mode in ('RGBA', 'LA', 'P') and (w, h) not in ALPHA_ALLOWED
            note = ''
            if alpha and fix:
                Image.alpha_composite(
                    Image.new('RGBA', img.size, (255, 255, 255, 255)), img.convert('RGBA'),
                ).convert('RGB').save(path, optimize=True)
                note, alpha = '  (alpha removed)', False
            elif alpha:
                note = '  ⚠ has alpha channel — run with --fix'
            ok = bool(slots) and not alpha
            problems += 0 if ok else 1
            print(f"{'OK ' if ok else 'BAD'} {w}x{h}  {path}{note}\n     -> {'; '.join(slots) or 'no store slot'}")
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
