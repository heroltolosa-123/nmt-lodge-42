"""Build the home-screen icons from the Lodge emblem.

    python3 scripts/make-icons.py

Run it again if noli-logo.jpg is ever replaced. Everything it writes is
committed, so this is here to record HOW the icons were made rather than
to be run often — and specifically to record the one measurement that is
easy to get wrong.

THE SAFE ZONE

Android does not show a maskable icon as you drew it. It crops it to
whatever shape the launcher uses — a circle on one phone, a squircle on
the next — and the only region guaranteed to survive is the centre 80%,
which on a circular mask means a circle of radius 40%. An emblem drawn
to the edges loses its rim, and this emblem keeps "MANILA" on a ribbon
at the very bottom edge, so a full-bleed maskable icon crops the city
off the seal.

So the maskable icon is the emblem at 70% of the canvas, centred, and
main() measures the result rather than trusting that number. 72% was the
first guess and it put the ribbon's far corner at 205px against a
204.8px limit — right on the line, which is how a thing that looks fine
on the phone you tested ships broken to everyone else. It is also why
the maskable file is not simply a resize of the plain one.

iOS is different again: it ignores the manifest entirely, takes
apple-touch-icon.png, rounds the corners itself, and composites any
transparency onto black. It crops far less, so that one is drawn larger.
"""
import math
from PIL import Image, ImageChops
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / 'noli-logo.jpg'
OUT = HERE / 'icons'

# The site's deepest ink. The emblem's own ground is (2,1,7), near enough
# that the two meet without a seam.
GROUND = (7, 9, 7)

# Android guarantees only the centre 80% of a maskable icon: on a circular
# mask, a circle of radius 40%.
MASKABLE_SAFE = 0.40


def emblem():
    """The seal, trimmed of the black margin the JPEG carries around it."""
    im = Image.open(SOURCE).convert('RGB')
    flat = Image.new('RGB', im.size, im.getpixel((0, 0)))
    mask = ImageChops.difference(im, flat).convert('L').point(lambda p: 255 if p > 18 else 0)
    box = mask.getbbox()
    # Square it off around the centre, so scaling never stretches the seal.
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    half = max(box[2] - box[0], box[3] - box[1]) / 2
    return im.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half)))


def icon(size, fill):
    """The seal at `fill` of the canvas, centred on the ground colour.

    Quantised to a palette before saving. The source is a JPEG, so its
    flat areas are not flat — they carry compression noise that a lossless
    PNG then stores faithfully, at four times the size, to reproduce
    something nobody can see. The seal is drawn in perhaps a dozen colours;
    128 is generous.
    """
    art = emblem().resize((round(size * fill),) * 2, Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), GROUND)
    canvas.paste(art, ((size - art.width) // 2,) * 2)
    return canvas.quantize(colors=128, method=Image.MEDIANCUT,
                           dither=Image.FLOYDSTEINBERG)


def farthest_content(img):
    """How far the drawing reaches from the centre, in pixels.

    Not half the width: the seal is a circle with a ribbon across it, so
    its corners are empty and its widest point is a ribbon tip, which no
    bounding box can tell you about.
    """
    flat = Image.new('RGB', img.size, GROUND)
    mask = ImageChops.difference(img.convert('RGB'), flat).convert('L')
    mask = mask.point(lambda p: 255 if p > 18 else 0)
    px, (w, h) = mask.load(), mask.size
    c = w / 2
    return max((math.hypot(x - c + 0.5, y - c + 0.5)
                for y in range(h) for x in range(w) if px[x, y]), default=0)


def main():
    OUT.mkdir(exist_ok=True)
    for name, size, fill in [
        ('icon-192.png', 192, 0.94),              # browser tab, task switcher
        ('icon-512.png', 512, 0.94),              # install prompt, splash screen
        ('icon-maskable-512.png', 512, 0.70),     # inside Android's safe circle
        ('apple-touch-icon.png', 180, 0.90),      # iOS rounds the corners itself
    ]:
        path = OUT / name
        art = icon(size, fill)
        art.save(path, 'PNG', optimize=True)
        note = ''
        if 'maskable' in name:
            reach, limit = farthest_content(art), MASKABLE_SAFE * size
            assert reach <= limit, (
                f'{name}: the seal reaches {reach:.0f}px from the centre and Android '
                f'only guarantees {limit:.0f}px. Lower the fill.')
            note = f'  reaches {reach:.0f}px of {limit:.0f} allowed'
        print(f'{path.relative_to(HERE)}  {size}x{size}  '
              f'{path.stat().st_size:,} bytes{note}')


if __name__ == '__main__':
    main()
