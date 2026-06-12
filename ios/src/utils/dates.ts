/*
 * utils/dates.ts  –  Datums-Hilfsfunktionen (Portierung aus der PWA)
 * ==========================================================================
 * Konventionen:
 *   - Die Woche beginnt am MONTAG (in Deutschland ueblich).
 *   - Ein "Tagesschluessel" ist ein String "YYYY-MM-DD" (lokale Zeit).
 */

export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAYS_LONG = [
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
];
export const MONTHS_LONG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Wandelt ein Date in den Tagesschluessel "YYYY-MM-DD" um (lokale Zeit). */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Erzeugt ein Date aus einem Tagesschluessel "YYYY-MM-DD" (Mitternacht lokal). */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** Wochentag als Index mit Montag = 0 ... Sonntag = 6. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function isWeekend(date: Date): boolean {
  const wd = date.getDay();
  return wd === 0 || wd === 6;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function addDays(date: Date, n: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

/** Montag der Woche, in der `date` liegt. */
export function startOfWeekMonday(date: Date): Date {
  return addDays(date, -mondayIndex(date));
}

/**
 * Baut das vollstaendige Raster fuer die Monatsansicht: beginnt am Montag vor
 * (oder am) Monatsersten, endet am Sonntag nach dem Monatsletzten (4–6 Wochen).
 */
export function buildMonthGrid(monthDate: Date): { days: Date[]; weeks: number } {
  const first = startOfMonth(monthDate);
  const gridStart = startOfWeekMonday(first);
  const last = endOfMonth(monthDate);
  const gridEndExclusive = addDays(startOfWeekMonday(last), 7);

  const days: Date[] = [];
  let cursor = gridStart;
  while (cursor < gridEndExclusive) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return { days, weeks: days.length / 7 };
}

/** ISO-8601-Kalenderwoche (KW 1 = Woche mit dem ersten Donnerstag). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/** "HH:MM" (24 Stunden). */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** "Mo, 12. Juni 2026" */
export function formatLongDate(date: Date): string {
  const wd = WEEKDAYS_SHORT[mondayIndex(date)];
  return `${wd}, ${date.getDate()}. ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Juni 2026" – Titel fuer die Monatsansicht. */
export function formatMonthTitle(date: Date): string {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}
