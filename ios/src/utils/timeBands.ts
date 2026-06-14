/*
 * utils/timeBands.ts  –  Zeitphasen in Pixel-Rechtecke umrechnen
 * ==========================================================================
 * Wandelt die in den Einstellungen definierten Zeitphasen (Stunde von–bis) in
 * Rechtecke fuer die senkrechte Stunden-Zeitachse von Tages-/Wochenansicht um.
 * Phasen ueber Mitternacht (endHour <= startHour, z.B. 22–6 Uhr) werden in zwei
 * Segmente zerlegt (22–24 und 0–6).
 */

import type { TimeBand } from "../types";

export interface BandRect {
  top: number;     // Pixel von oben (0 Uhr)
  height: number;  // Pixel
  color: string;
}

/** Formatiert eine (halbe) Stunde als "HH:MM", z.B. 14.5 -> "14:30", 24 -> "24:00". */
export function formatBandHour(h: number): string {
  const hh = Math.floor(h);
  const mm = h - hh >= 0.5 ? "30" : "00";
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

/**
 * Berechnet die sichtbaren Rechtecke aller AKTIVEN Phasen.
 * @param bands     Liste der Zeitphasen
 * @param hourHeight Hoehe einer Stunde in Pixeln
 */
export function bandRects(bands: TimeBand[] | undefined, hourHeight: number): BandRect[] {
  const out: BandRect[] = [];
  for (const b of bands || []) {
    if (!b.enabled) continue;
    const s = Math.max(0, Math.min(24, b.startHour));
    const e = Math.max(0, Math.min(24, b.endHour));
    // Segmente bestimmen: normal (s<e) oder ueber Mitternacht (e<s).
    const segments: [number, number][] =
      e > s ? [[s, e]]
      : e < s ? [[s, 24], [0, e]]
      : []; // gleich -> leere Phase
    for (const [from, to] of segments) {
      out.push({ top: from * hourHeight, height: (to - from) * hourHeight, color: b.color });
    }
  }
  return out;
}
