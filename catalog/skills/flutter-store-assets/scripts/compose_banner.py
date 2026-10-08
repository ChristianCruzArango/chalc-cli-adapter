#!/usr/bin/env python3
"""Composes landscape store banners (App Store header, Google Play feature
graphic) from portrait app screenshots. Part of the flutter-store-assets skill.

Example:
  python compose_banner.py --shots build/store_assets/screenshots \
    --center 01_home.png --left 02_wallet.png --right 03_chat.png \
    --logo assets/icon/logo.png --font assets/fonts/Inter.ttf --brand myapp \
    --title "Clear money.\\nCalm life." --subtitle "Short promise." \
    --size 5244x2950 --size 3840x1646 --out build/store_assets/banners
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def hex_rgb(value):
    value = value.strip().lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def load_font(path, size, weight):
    if not path:
        return ImageFont.load_default(size)
    font = ImageFont.truetype(path, size)
    try:
        font.set_variation_by_axes([weight])  # variable fonts
    except Exception:
        pass
    return font


def gradient(w, h, stops):
    small_w, small_h = max(2, w // 8), max(2, h // 8)
    img = Image.new('RGB', (small_w, small_h))
    px = img.load()
    for x in range(small_w):
        for y in range(small_h):
            t = x / small_w * 0.7 + y / small_h * 0.3
            seg = min(int(t * (len(stops) - 1)), len(stops) - 2)
            k = t * (len(stops) - 1) - seg
            a, b = stops[seg], stops[seg + 1]
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    return img.resize((w, h), Image.BICUBIC).convert('RGBA')


def phone(path, height, angle, frame):
    shot = Image.open(path).convert('RGBA')
    width = int(height * shot.width / shot.height)
    shot = shot.resize((width, height), Image.LANCZOS)
    pad = max(6, height // 90)
    body = Image.new('RGBA', (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle(
        [0, 0, body.width - 1, body.height - 1], int(width * 0.16), fill=frame + (255,))
    mask = Image.new('L', (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, width - 1, height - 1], int(width * 0.13), fill=255)
    body.paste(shot, (pad, pad), mask)
    body = body.rotate(angle, resample=Image.BICUBIC, expand=True)
    blur = max(8, height // 30)
    canvas = Image.new('RGBA', (body.width + blur * 5, body.height + blur * 5), (0, 0, 0, 0))
    alpha = body.split()[3].point(lambda a: int(a * 0.28))
    canvas.paste(frame + (255,), (blur * 2, blur * 3), alpha)
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(body, (blur * 2, blur * 2))
    return canvas


def wrap(draw, text, font, max_width):
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if line and draw.textlength(trial, font=font) > max_width:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def compose(args, w, h):
    ratio = w / h
    img = gradient(w, h, [hex_rgb(c) for c in args.colors.split(',')])
    draw = ImageDraw.Draw(img)
    ink, muted, frame = hex_rgb(args.ink), hex_rgb(args.muted), hex_rgb(args.frame)

    # Text column: wider canvases leave more room for phones.
    text_w = int(w * (0.36 if ratio > 2 else 0.3))
    left = int(w * 0.06)
    title = load_font(args.font, int(h * (0.1 if ratio > 2 else 0.078)), 800)
    brand = load_font(args.font, int(h * 0.065), 800)
    body = load_font(args.font, int(h * 0.032), 500)
    title_lines = args.title.replace('\\n', '\n').split('\n')
    # Shrink the title until every line fits the column.
    while max(draw.textlength(t, font=title) for t in title_lines) > text_w and title.size > 12:
        title = load_font(args.font, int(title.size * 0.92), 800)

    y = int(h * (0.24 if ratio > 2 else 0.27))
    logo_h = int(h * 0.1)
    x = left
    if args.logo:
        logo = Image.open(args.logo).convert('RGBA')
        logo = logo.resize((int(logo.width * logo_h / logo.height), logo_h), Image.LANCZOS)
        img.alpha_composite(logo, (left, y))
        x = left + logo.width + int(h * 0.02)
    if args.brand:
        draw.text((x, y + logo_h // 2), args.brand, font=brand, fill=ink, anchor='lm')
    y += logo_h + int(h * 0.06)
    for line in title_lines:
        draw.text((left, y), line, font=title, fill=ink)
        y += int(title.size * 1.08)
    y += int(h * 0.03)
    for line in wrap(draw, args.subtitle or '', body, text_w):
        draw.text((left, y), line, font=body, fill=muted)
        y += int(body.size * 1.35)

    # Phones: center large, sides smaller and tilted; two only on short canvases.
    names = [args.left, args.center, args.right] if h >= 800 else [args.left, args.center]
    names = [n for n in names if n]
    ph = int(h * (0.84 if ratio > 2 else 0.8))
    side = int(ph * 0.86)
    phones = []
    for name in names:
        is_center = name == args.center
        angle = 0 if is_center else (4 if name == args.left else -4)
        phones.append((name, phone(os.path.join(args.shots, name), ph if is_center else side, angle, frame)))
    center = next(p for n, p in phones if n == args.center)
    cx, cy = int(w * (0.72 if ratio > 2 else 0.73)), h // 2
    offset = int(center.width * 0.62)
    for name, p in phones:
        if name == args.center:
            continue
        dx = -offset if name == args.left else offset
        img.alpha_composite(p, (cx + dx - p.width // 2, cy - p.height // 2 + int(ph * 0.04)))
    img.alpha_composite(center, (cx - center.width // 2, cy - center.height // 2))
    return img.convert('RGB')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--shots', required=True, help='folder with the portrait screenshots')
    p.add_argument('--center', required=True)
    p.add_argument('--left')
    p.add_argument('--right')
    p.add_argument('--logo')
    p.add_argument('--font', help='TTF from the app (pubspec fonts)')
    p.add_argument('--brand', default='')
    p.add_argument('--title', required=True, help='use \\n for a line break')
    p.add_argument('--subtitle', default='')
    p.add_argument('--colors', default='#F5F3F8,#E3DFF0,#DDEBE0', help='2+ hex gradient stops')
    p.add_argument('--ink', default='#302C47')
    p.add_argument('--muted', default='#6F6A86')
    p.add_argument('--frame', default='#302C47', help='phone frame color')
    p.add_argument('--size', action='append', default=[], help='WxH, repeatable')
    p.add_argument('--out', default='build/store_assets/banners')
    args = p.parse_args()
    sizes = args.size or ['5244x2950', '3840x1646']
    os.makedirs(args.out, exist_ok=True)
    for s in sizes:
        w, h = (int(v) for v in s.lower().split('x'))
        path = os.path.join(args.out, f'banner_{w}x{h}.png')
        compose(args, w, h).save(path, optimize=True)
        print(f'{path}  {w}x{h}')


if __name__ == '__main__':
    main()
