#!/usr/bin/env python3
"""Erzeugt das App-Icon (1024x1024) fuer "Calzi".

Motiv: blauer Verlaufshintergrund, weisse Kalenderkarte mit korallenrotem
Kopfband und zwei Bindungsringen. Als Blickfang sitzt im Kartenkoerper eine
korallenrote, abgerundete "Tages-Kachel" mit einem weissen "C" (fuer Calzi),
gezeichnet als dicker Kreisbogen. Alles geometrisch aufgebaut (keine Schrift),
damit es ohne Font-Abhaengigkeit gestochen scharf bleibt. iOS rundet die Ecken
selbst -> Vollflaeche, kein Alpha.

Aufruf:  python make_icon.py ../assets/icon.png
"""
import sys
from PIL import Image, ImageDraw

S = 1024
SS = 4            # Supersampling fuer glatte Kanten
W = S * SS

# --- Farben ---
BG_TOP = (76, 155, 224)      # #4C9BE0
BG_BOTTOM = (33, 96, 168)    # #2160A8
CORAL = (244, 90, 74)        # #F45A4A
CARD = (255, 255, 255)
RING = (232, 232, 232)
SHADOW = (18, 52, 96)

img = Image.new("RGB", (W, W), (0, 0, 0))
draw = ImageDraw.Draw(img)


def px(v):
    """1024er-Koordinate -> Supersampling-Pixel."""
    return int(round(v * SS))


def rr(box, radius, fill):
    draw.rounded_rectangle([px(box[0]), px(box[1]), px(box[2]), px(box[3])],
                           radius=px(radius), fill=fill)


# --- Hintergrund: vertikaler Blauverlauf (oben heller) ---
for y in range(W):
    t = y / W
    r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# --- Kalenderkarte (mit weichem Schlagschatten) ---
margin = 150
card = [margin, 195, S - margin, S - 150]
rr([card[0] + 14, card[1] + 16, card[2] + 14, card[3] + 16], 64, SHADOW)
rr(card, 64, CARD)

# --- korallenrotes Kopfband (oben rund, unten gerade) ---
header_h = 132
header = [card[0], card[1], card[2], card[1] + header_h]
rr(header, 64, CORAL)
draw.rectangle([px(header[0]), px(header[1] + 64), px(header[2]), px(header[3])], fill=CORAL)

# --- zwei Bindungsringe ueber dem Kopfband ---
ring_w, ring_h = 36, 74
ring_y = card[1] - 30
cx = (card[0] + card[2]) / 2
for off in (-150, 150):
    x = cx + off
    rr([x - ring_w / 2, ring_y, x + ring_w / 2, ring_y + ring_h], 18, RING)

# --- "Tages-Kachel" mit weissem "C" im Kartenkoerper ---
body_top = header[3]
body_bottom = card[3]
tile = 360
tcx = cx
tcy = (body_top + body_bottom) / 2 + 8
tile_box = [tcx - tile / 2, tcy - tile / 2, tcx + tile / 2, tcy + tile / 2]
rr(tile_box, 78, CORAL)

# weisses "C": dicker Kreisbogen, Oeffnung nach rechts (Luecke bei 3 Uhr).
inset = 96
arc_box = [px(tile_box[0] + inset), px(tile_box[1] + inset),
           px(tile_box[2] - inset), px(tile_box[3] - inset)]
draw.arc(arc_box, start=40, end=320, fill=CARD, width=px(54))

# --- herunterskalieren (Antialiasing) und speichern ---
out_path = sys.argv[1] if len(sys.argv) > 1 else "../assets/icon.png"
out = img.resize((S, S), Image.LANCZOS)
out.save(out_path)
print("Icon gespeichert:", out_path)
