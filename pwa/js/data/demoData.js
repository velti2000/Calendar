/*
 * data/demoData.js  –  Beispiel-Kalender und -Termine
 * ==========================================================================
 * Solange noch keine echte Verbindung zu mailbox.org besteht, fuettern wir die
 * App mit diesen Demo-Daten. Sie zeigen alle Faelle, die das UI koennen muss:
 *   - mehrere Kategorien (Sub-Kalender) mit eigenen Farben
 *   - Ganztagestermine (z.B. Geburtstage) -> farbig hinterlegt
 *   - zeitlich begrenzte Termine -> nur farbiger Text
 *
 * Die Datenstruktur ist bewusst identisch zu dem, was spaeter aus CalDAV
 * kommt, damit der Umstieg nahtlos ist.
 */

import { dayKey, addDays } from "../utils/dates.js";

/**
 * Kalender = Kategorie = "Sub-Kalender" eines Accounts.
 * @typedef {Object} Calendar
 * @property {string} id        eindeutige Kennung
 * @property {string} name      Anzeigename
 * @property {string} color     Farbe (CSS), bestimmt das Aussehen der Termine
 * @property {boolean} visible  Ob die Termine dieses Kalenders angezeigt werden
 * @property {string} [url]     CalDAV-Adresse (spaeter fuer Sync gefuellt)
 * @property {boolean} [readOnly] Manche Kalender (z.B. Feiertage) sind nur lesbar
 */

/** @returns {Calendar[]} */
export function getDemoCalendars() {
  return [
    { id: "cal-thomas", name: "Termine Thomas", color: "#2b6cb0", visible: true },
    { id: "cal-kinder", name: "Kinder", color: "#38a169", visible: true },
    { id: "cal-geburtstage", name: "Geburtstage", color: "#dd6b20", visible: true },
    { id: "cal-arbeit", name: "Arbeit", color: "#9b2c2c", visible: true },
  ];
}

/**
 * Termin (Event).
 * @typedef {Object} CalEvent
 * @property {string} uid          eindeutige Kennung (in CalDAV der UID)
 * @property {string} calendarId   zu welchem Kalender/Kategorie der Termin gehoert
 * @property {string} title        Titel/Betreff
 * @property {boolean} allDay       Ganztagestermin?
 * @property {string} start         ISO-String des Beginns
 * @property {string} end           ISO-String des Endes
 * @property {string} [location]    Ort
 * @property {string} [notes]       Notizen/Beschreibung
 * @property {number[]} [reminders] Erinnerungen in Minuten vor Beginn
 */

/**
 * Erzeugt die Demo-Termine relativ zum heutigen Tag, damit immer etwas im
 * aktuellen Monat sichtbar ist.
 * @returns {CalEvent[]}
 */
export function getDemoEvents() {
  const today = new Date();

  /** Kleiner Helfer: Termin mit Uhrzeit am Tag (heute + offset). */
  const timed = (uid, calendarId, title, dayOffset, startH, startM, endH, endM, extra = {}) => {
    const d = addDays(today, dayOffset);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startH, startM);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), endH, endM);
    return {
      uid, calendarId, title, allDay: false,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  /** Kleiner Helfer: Ganztagestermin (heute + offset). */
  const allDay = (uid, calendarId, title, dayOffset, extra = {}) => {
    const d = addDays(today, dayOffset);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = addDays(start, 1); // Ende = naechster Tag 00:00 (iCal-Konvention)
    return {
      uid, calendarId, title, allDay: true,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  /**
   * Kleiner Helfer: MEHRTAGES-Ganztagestermin (z.B. Urlaub) von startOffset
   * bis einschliesslich endOffset. Wird in der Monatsansicht als verbundener
   * Balken ueber mehrere Tage dargestellt.
   */
  const allDayRange = (uid, calendarId, title, startOffset, endOffset, extra = {}) => {
    const s = addDays(today, startOffset);
    const e = addDays(today, endOffset);
    const start = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    // Ende = Tag NACH dem letzten Tag, 00:00 (iCal-Konvention fuer Ganztag).
    const end = addDays(new Date(e.getFullYear(), e.getMonth(), e.getDate()), 1);
    return {
      uid, calendarId, title, allDay: true,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  return [
    // --- Diese Woche ----------------------------------------------------------
    timed("demo-1", "cal-thomas", "Zahnarzt", 0, 9, 0, 9, 45, {
      location: "Praxis Dr. Müller", reminders: [30],
    }),
    timed("demo-2", "cal-arbeit", "Team-Meeting", 0, 11, 0, 12, 0, { reminders: [10] }),
    timed("demo-3", "cal-kinder", "Fußballtraining", 1, 16, 30, 18, 0),
    allDay("demo-4", "cal-geburtstage", "🎂 Oma", 2),
    timed("demo-5", "cal-thomas", "Einkaufen", 2, 18, 0, 19, 0),
    timed("demo-6", "cal-arbeit", "Projekt-Abgabe", 3, 14, 0, 15, 0, { reminders: [60, 1440] }),
    allDay("demo-7", "cal-kinder", "Ferienbeginn", 4),

    // --- Naechste Woche -------------------------------------------------------
    timed("demo-8", "cal-thomas", "Frisör", 7, 10, 0, 10, 30),
    timed("demo-9", "cal-kinder", "Elternabend", 8, 19, 0, 20, 30, { location: "Grundschule" }),
    allDay("demo-10", "cal-geburtstage", "🎂 Lisa", 9),
    timed("demo-11", "cal-arbeit", "Workshop", 10, 9, 0, 17, 0),

    // --- Letzte Woche (zeigt, dass auch Vergangenes da ist) -------------------
    timed("demo-12", "cal-thomas", "Auto TÜV", -3, 8, 0, 9, 0),
    allDay("demo-13", "cal-geburtstage", "🎂 Papa", -5),

    // --- Etwas weiter im Monat ------------------------------------------------
    timed("demo-14", "cal-arbeit", "Quartalsbericht", 14, 13, 0, 14, 30),
    timed("demo-15", "cal-kinder", "Arzttermin Kind", 15, 15, 0, 15, 45),

    // Mehrtages-Termine -> in der Monatsansicht als verbundener Balken:
    allDayRange("demo-16", "cal-thomas", "Urlaub", 20, 23),      // 4 Tage (auch ueber Wochengrenze)
    allDayRange("demo-19", "cal-arbeit", "Seminar Berlin", 14, 15), // 2 Tage innerhalb einer Woche
  ];

  // Hinweis: dayKey/dayOffset werden hier nur indirekt verwendet – die Helfer
  // oben berechnen die konkreten Daten relativ zu "today".
}

// dayKey wird exportiert importiert, um zukuenftige Erweiterungen zu erleichtern.
export { dayKey };
