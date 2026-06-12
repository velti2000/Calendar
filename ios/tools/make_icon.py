#!/usr/bin/env python3
"""Erzeugt das App-Icon (1024x1024) im Stil der Kalender-App.

Motiv: blauer Verlaufshintergrund, weisse Kalenderkarte mit rotem Kopfband,
zwei Bindungsringen und einem Monatsraster, in dem ein Tag (blau) hervorgehoben
ist. Geometrisch aufgebaut (keine Schrift), damit es ohne Font-Abhaengigkeit
gestochen scharf bleibt. iOS rundet die Ecken selbst -> Vollflaeche, kein Alpha.
"""
from PIL import Image, ImageDraw

S = 1024
SS = 4  # Supersampling fuer glatte Kanten
W = S * SS

img = Image.new("RGB", (W, W), (0, 0, 0))
draw = ImageDraw.Draw(img)

# --- Hintergrund: vertikaler Blauverlauf (oben heller) ---
top = (62, 146, 204)     # #3e92cc
bottom = (33, 86, 145)   # #215691
for y in range(W):
    t = y / W
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

def rr(box, radius, fill):
    draw.rounded_rectangle(box, radius=radius * SS, fill=fill)

# --- weiche Schatten-Karte hinter der Kalenderkarte ---
margin = 150 * SS
card = [margin, 185 * SS, W - margin, W - 150 * SS]
shadow_off = 14 * SS
rr([card[0] + shadow_off, card[1] + shadow_off, card[2] + shadow_off, card[3] + shadow_off],
   60, (20, 55, 95))

# --- weisse Kalenderkarte ---
rr(card, 60, (255, 255, 255))

# --- rotes Kopfband ---
header_h = 150 * SS
header = [card[0], card[1], card[2], card[1] + header_h]
# eigenes Rounded-Top, unten gerade: erst rounded rect, dann unteren Teil fuellen
rr(header, 60, (228, 76, 70))  # #e44c46
draw.rectangle([header[0], header[1] + 60 * SS, header[2], header[3]], fill=(228, 76, 70))

# --- zwei Bindungsringe oben ---
ring_w, ring_h = 34 * SS, 70 * SS
ring_y = card[1] - 28 * SS
cx = (card[0] + card[2]) // 2
for off in (-150 * SS, 150 * SS):
    x = cx + off
    rr([x - ring_w // 2, ring_y, x + ring_w // 2, ring_y + ring_h], 16, (236, 236, 236))

# --- Monatsraster (5 Spalten x 3 Reihen Punkte), ein Tag hervorgehoben ---
grid_top = header[3] + 70 * SS
grid_bottom = card[3] - 70 * SS
grid_left = card[0] + 80 * SS
grid_right = card[2] - 80 * SS
cols, rows = 5, 3
cell_w = (grid_right - grid_left) / cols
cell_h = (grid_bottom - grid_top) / rows
dot_r = 24 * SS
highlight = (1, 2)  # Spalte 1, Reihe 2 (0-basiert) wird hervorgehoben

for row in range(rows):
    for col in range(cols):
        ccx = int(grid_left + cell_w * (col + 0.5))
        ccy = int(grid_top + cell_h * (row + 0.5))
        if (col, row) == highlight:
            # ausgefuellter blauer Kreis = "heute"
            draw.ellipse([ccx - dot_r, ccy - dot_r, ccx + dot_r, ccy + dot_r],
                         fill=(43, 108, 176))  # #2b6cb0
        else:
            draw.ellipse([ccx - dot_r, ccy - dot_r, ccx + dot_r, ccy + dot_r],
                         fill=(206, 214, 224))  # helles Grau

# --- herunterskalieren (Antialiasing) und speichern ---
out = img.resize((S, S), Image.LANCZOS)
import sys
out.save(sys.argv[1])
print("Icon gespeichert:", sys.argv[1])

# Splash-Icon: nur die Karte auf transparentem Grund waere ideal, aber fuer den
# Start reicht dasselbe Motiv. (Optional spaeter verfeinern.)
