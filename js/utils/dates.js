/*
 * utils/dates.js  –  Datums-Hilfsfunktionen
 * ==========================================================================
 * Sammlung kleiner, gut testbarer Funktionen rund um Datum/Uhrzeit.
 * Alle Funktionen arbeiten mit nativen JavaScript-Date-Objekten.
 *
 * Konventionen in dieser App:
 *   - Die Woche beginnt am MONTAG (in Deutschland ueblich).
 *   - Ein "Tagesschluessel" ist ein String "YYYY-MM-DD" und dient als
 *     eindeutiger Schluessel, um Termine einem Kalendertag zuzuordnen.
 */

// Deutsche Namen fuer Wochentage und Monate.
export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAYS_LONG = [
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
];
export const MONTHS_LONG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/**
 * Wandelt ein Date in den Tagesschluessel "YYYY-MM-DD" um (lokale Zeit).
 * @param {Date} date
 * @returns {string}
 */
export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Erzeugt ein Date aus einem Tagesschluessel "YYYY-MM-DD" (Mitternacht lokal).
 * @param {string} key
 * @returns {Date}
 */
export function dateFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Gibt true zurueck, wenn beide Daten am selben Kalendertag liegen. */
export function isSameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

/** Ist das Datum heute? */
export function isToday(date) {
  return isSameDay(date, new Date());
}

/** Wochentag als Index mit Montag = 0 ... Sonntag = 6. */
export function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Ist der Tag ein Wochenende (Sa/So)? */
export function isWeekend(date) {
  const wd = date.getDay();
  return wd === 0 || wd === 6;
}

/** Neues Date am ersten Tag des Monats der uebergebenen Date. */
export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Neues Date am letzten Tag des Monats. */
export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Verschiebt ein Date um n Tage (n darf negativ sein). Liefert neues Date. */
export function addDays(date, n) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Verschiebt ein Date um n Monate. */
export function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

/**
 * Liefert das Datum des Montags der Woche, in der `date` liegt.
 * Wird gebraucht, damit das Monatsraster immer am Montag beginnt.
 */
export function startOfWeekMonday(date) {
  return addDays(date, -mondayIndex(date));
}

/**
 * Baut das vollstaendige Raster fuer die Monatsansicht.
 * Beginnt am Montag vor (oder am) Monatsersten und enthaelt so viele Wochen,
 * dass der ganze Monat abgedeckt ist (4–6 Wochen).
 *
 * @param {Date} monthDate – ein beliebiges Datum im Zielmonat
 * @returns {{ days: Date[], weeks: number }}
 */
export function buildMonthGrid(monthDate) {
  const first = startOfMonth(monthDate);
  const gridStart = startOfWeekMonday(first);
  const last = endOfMonth(monthDate);
  const gridEndExclusive = addDays(startOfWeekMonday(last), 7); // Montag nach der letzten Woche

  const days = [];
  let cursor = gridStart;
  while (cursor < gridEndExclusive) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return { days, weeks: days.length / 7 };
}

/**
 * Formatiert die Uhrzeit als "HH:MM" (24-Stunden, deutsch).
 * @param {Date} date
 */
export function formatTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Formatiert einen langen, lesbaren Datumsstring, z.B. "Mo, 12. Juni 2026". */
export function formatLongDate(date) {
  const wd = WEEKDAYS_SHORT[mondayIndex(date)];
  return `${wd}, ${date.getDate()}. ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/** "Juni 2026" – Titel fuer die Monatsansicht. */
export function formatMonthTitle(date) {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Wandelt ein Date in den Wert fuer ein <input type="date"> ("YYYY-MM-DD").
 * Identisch zu dayKey, aber als eigene Funktion fuer Lesbarkeit benannt.
 */
export const toDateInputValue = dayKey;

/** Wandelt ein Date in den Wert fuer ein <input type="time"> ("HH:MM"). */
export const toTimeInputValue = formatTime;

/**
 * Baut aus den Werten zweier Inputfelder (Datum + Uhrzeit) wieder ein Date.
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} timeStr "HH:MM" (optional)
 */
export function dateFromInputs(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (timeStr) {
    const [hh, mm] = timeStr.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm);
  }
  return new Date(y, m - 1, d);
}
