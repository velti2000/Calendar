# Werkzeuge

## make_icon.py – App-Icon erzeugen

Erzeugt `assets/icon.png` (1024×1024) – Kalendermotiv im App-Blau.
Kein Font nötig (rein geometrisch), iOS rundet die Ecken selbst.

```bash
# einmalig: isoliertes Python-Environment mit Pillow
python3 -m venv .venv-icon
.venv-icon/bin/pip install Pillow

# Icon (neu) erzeugen
.venv-icon/bin/python tools/make_icon.py assets/icon.png
cp assets/icon.png assets/splash-icon.png   # Startbildschirm angleichen
```

Farben/Layout im Skript oben anpassbar (Verlauf, Kopfband, Raster, „heute"-Punkt).
