/*
 * data/demoData.ts  –  Beispiel-Kalender und -Termine (Portierung aus der PWA)
 * ==========================================================================
 * Solange keine echte Verbindung zu mailbox.org besteht, laeuft die App mit
 * diesen Demo-Daten. Die Struktur ist identisch zu dem, was aus CalDAV kommt.
 */

import type { Calendar, CalEvent } from "../types";
import { addDays } from "../utils/dates";

export function getDemoCalendars(): Calendar[] {
  return [
    { id: "cal-thomas", name: "Termine Thomas", color: "#2b6cb0", visible: true },
    { id: "cal-kinder", name: "Kinder", color: "#38a169", visible: true },
    { id: "cal-geburtstage", name: "Geburtstage", color: "#dd6b20", visible: true },
    { id: "cal-arbeit", name: "Arbeit", color: "#9b2c2c", visible: true },
  ];
}

/** Erzeugt die Demo-Termine relativ zum heutigen Tag. */
export function getDemoEvents(): CalEvent[] {
  const today = new Date();

  const timed = (
    uid: string, calendarId: string, title: string, dayOffset: number,
    startH: number, startM: number, endH: number, endM: number,
    extra: Partial<CalEvent> = {}
  ): CalEvent => {
    const d = addDays(today, dayOffset);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startH, startM);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), endH, endM);
    return {
      uid, calendarId, title, allDay: false,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  const allDay = (uid: string, calendarId: string, title: string, dayOffset: number, extra: Partial<CalEvent> = {}): CalEvent => {
    const d = addDays(today, dayOffset);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = addDays(start, 1); // Ende = naechster Tag 00:00 (iCal-Konvention)
    return {
      uid, calendarId, title, allDay: true,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  /** Mehrtages-Ganztagestermin (z.B. Urlaub), inkl. endOffset. */
  const allDayRange = (uid: string, calendarId: string, title: string, startOffset: number, endOffset: number, extra: Partial<CalEvent> = {}): CalEvent => {
    const s = addDays(today, startOffset);
    const e = addDays(today, endOffset);
    const start = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const end = addDays(new Date(e.getFullYear(), e.getMonth(), e.getDate()), 1);
    return {
      uid, calendarId, title, allDay: true,
      start: start.toISOString(), end: end.toISOString(), ...extra,
    };
  };

  return [
    // --- Diese Woche --------------------------------------------------------
    timed("demo-1", "cal-thomas", "Zahnarzt", 0, 9, 0, 9, 45, {
      location: "Praxis Dr. Müller", reminders: [30],
    }),
    timed("demo-2", "cal-arbeit", "Team-Meeting", 0, 11, 0, 12, 0, { reminders: [10] }),
    timed("demo-3", "cal-kinder", "Fußballtraining", 1, 16, 30, 18, 0),
    allDay("demo-4", "cal-geburtstage", "🎂 Oma", 2),
    timed("demo-5", "cal-thomas", "Einkaufen", 2, 18, 0, 19, 0),
    timed("demo-6", "cal-arbeit", "Projekt-Abgabe", 3, 14, 0, 15, 0, { reminders: [60, 1440] }),
    allDay("demo-7", "cal-kinder", "Ferienbeginn", 4),

    // --- Naechste Woche -----------------------------------------------------
    timed("demo-8", "cal-thomas", "Frisör", 7, 10, 0, 10, 30),
    timed("demo-9", "cal-kinder", "Elternabend", 8, 19, 0, 20, 30, { location: "Grundschule" }),
    allDay("demo-10", "cal-geburtstage", "🎂 Lisa", 9),
    timed("demo-11", "cal-arbeit", "Workshop", 10, 9, 0, 17, 0),

    // --- Letzte Woche -------------------------------------------------------
    timed("demo-12", "cal-thomas", "Auto TÜV", -3, 8, 0, 9, 0),
    allDay("demo-13", "cal-geburtstage", "🎂 Papa", -5),

    // --- Etwas weiter im Monat ----------------------------------------------
    timed("demo-14", "cal-arbeit", "Quartalsbericht", 14, 13, 0, 14, 30),
    timed("demo-15", "cal-kinder", "Arzttermin Kind", 15, 15, 0, 15, 45),

    // Mehrtages-Termine -> in der Monatsansicht als verbundener Balken:
    allDayRange("demo-16", "cal-thomas", "Urlaub", 20, 23),
    allDayRange("demo-19", "cal-arbeit", "Seminar Berlin", 14, 15),

    // Serientermin (woechentlich) – zeigt die RRULE-Aufloesung:
    timed("demo-20", "cal-kinder", "Musikschule", 1, 15, 0, 15, 45, {
      rrule: "FREQ=WEEKLY",
    }),
  ];
}
