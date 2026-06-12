/*
 * theme/index.ts  –  Farben fuer Hell- und Dunkelmodus
 * ==========================================================================
 * Entspricht den CSS-Variablen aus pwa/css/styles.css. Welche Variante aktiv
 * ist, entscheidet settings.theme ("auto" folgt dem System).
 */

export interface Theme {
  background: string;     // App-Hintergrund
  surface: string;        // Karten/Zellen
  surfaceMuted: string;   // z.B. Tage ausserhalb des Monats
  text: string;
  textMuted: string;
  border: string;
  accent: string;         // Hervorhebung (heute, Buttons)
  weekend: string;        // Hintergrund Wochenend-Spalten
  todayRing: string;      // Markierung des heutigen Tags
  danger: string;         // Loeschen
}

export const lightTheme: Theme = {
  background: "#ffffff",
  surface: "#ffffff",
  surfaceMuted: "#f5f5f4",
  text: "#1c1917",
  textMuted: "#78716c",
  border: "#e7e5e4",
  accent: "#2b6cb0",
  weekend: "#fafaf9",
  todayRing: "#2b6cb0",
  danger: "#b91c1c",
};

export const darkTheme: Theme = {
  background: "#111113",
  surface: "#1c1c1f",
  surfaceMuted: "#222226",
  text: "#f4f4f5",
  textMuted: "#a1a1aa",
  border: "#2e2e33",
  accent: "#60a5fa",
  weekend: "#19191c",
  todayRing: "#60a5fa",
  danger: "#f87171",
};
