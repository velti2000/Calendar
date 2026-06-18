/*
 * data/appleReminders.ts  –  iPhone-„Erinnerungen" NUR LESEND laden
 * ==========================================================================
 * Liest faellige Erinnerungen aus der iOS-Erinnerungen-App (EventKit) ueber
 * das Modul `expo-calendar` und wandelt sie in CalEvent-Objekte um, damit sie
 * als Overlay im Kalender erscheinen.
 *
 * WICHTIG: Diese Schicht SCHREIBT NIE in die Erinnerungen-App. Die Verwaltung
 * passiert dort. Die erzeugten CalEvents tragen `source: "reminders"` und sind
 * dadurch ueberall vom Schreib-/Loeschpfad und vom Editor ausgeschlossen.
 *
 * Hinweis: expo-calendar ist ein NATIVES Modul – nach dem Hinzufuegen ist ein
 * nativer Rebuild noetig (`npx expo run:ios`), ein JS-Reload reicht NICHT.
 */

import * as Calendar from "expo-calendar";
import { Platform } from "react-native";
import type { CalEvent } from "../types";
import { expandRecurring } from "./ical";

/**
 * Fragt die Berechtigung fuer den Zugriff auf Erinnerungen an.
 * @returns true, wenn erlaubt.
 */
export async function requestRemindersPermission(): Promise<boolean> {
  if (Platform.OS !== "ios") return false; // Erinnerungen gibt es nur auf iOS
  const existing = await Calendar.getRemindersPermissionsAsync();
  if (existing.granted) return true;
  const result = await Calendar.requestRemindersPermissionsAsync();
  return result.granted;
}

/**
 * Laedt alle (offenen) Erinnerungen mit Faelligkeitsdatum und gibt sie als
 * CalEvents zurueck. Liefert leere Liste, wenn keine Berechtigung vorliegt.
 * @param color Farbe, in der die Erinnerungen dargestellt werden
 */
export async function fetchReminders(color: string): Promise<CalEvent[]> {
  if (Platform.OS !== "ios") return [];

  const perm = await Calendar.getRemindersPermissionsAsync();
  if (!perm.granted) return [];

  // Alle Erinnerungs-Listen des Geraets bestimmen.
  const lists = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
  if (!lists.length) return [];
  const listIds = lists.map((c) => c.id);

  // Nur OFFENE (nicht erledigte) Erinnerungen laden. WICHTIG: status = null
  // wuerde ALLE liefern (auch erledigte!) – deshalb explizit INCOMPLETE.
  // Geloeschte Erinnerungen gibt EventKit ohnehin nicht mehr zurueck.
  const reminders = await Calendar.getRemindersAsync(
    listIds, Calendar.ReminderStatus.INCOMPLETE, null, null
  );

  // Zeitfenster fuer das Aufloesen von Serien (1 Jahr zurueck bis 2 Jahre voraus).
  const now = new Date();
  const windowStart = new Date(now.getFullYear() - 1, 0, 1);
  const windowEnd = new Date(now.getFullYear() + 2, 11, 31);

  const events: CalEvent[] = [];
  for (const r of reminders) {
    try {
      const ev = mapReminder(r, color);
      if (!ev) continue;
      // Serien-Erinnerungen in Einzelvorkommen aufloesen (sonst nur 1 Termin).
      if (ev.rrule) events.push(...expandRecurring([ev], windowStart, windowEnd));
      else events.push(ev);
    } catch {
      // Einzelne unverstaendliche Erinnerung ueberspringen, nie den Sync abbrechen.
    }
  }
  return events;
}

/** Wandelt eine expo-calendar-Wiederholungsregel in eine iCalendar-RRULE um. */
function recurrenceToRrule(rule: Calendar.RecurrenceRule): string | null {
  const freqMap: Record<string, string> = {
    daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY",
  };
  const freq = freqMap[rule.frequency];
  if (!freq) return null;

  const parts = [`FREQ=${freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);

  // Wochentage (1=So ... 7=Sa) -> BYDAY, optional mit Ordinalzahl (z.B. 2. Donnerstag).
  if (rule.daysOfTheWeek?.length) {
    const codes = ["", "SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const byday = rule.daysOfTheWeek
      .map((d) => {
        const code = codes[d.dayOfTheWeek];
        if (!code) return null;
        return (d.weekNumber ? String(d.weekNumber) : "") + code;
      })
      .filter((x): x is string => !!x);
    if (byday.length) parts.push(`BYDAY=${byday.join(",")}`);
  }

  // Ende: nach Anzahl (COUNT) oder bis Datum (UNTIL).
  if (rule.occurrence && rule.occurrence > 0) {
    parts.push(`COUNT=${rule.occurrence}`);
  } else if (rule.endDate) {
    const d = new Date(rule.endDate);
    if (!isNaN(d.getTime())) parts.push(`UNTIL=${icalUtc(d)}`);
  }
  return parts.join(";");
}

/** Date als iCal-UTC-Zeitstempel "YYYYMMDDTHHMMSSZ". */
function icalUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Wandelt eine Erinnerung in ein NUR-LESENDES CalEvent um (oder null ohne Faelligkeit). */
function mapReminder(r: Calendar.Reminder, color: string): CalEvent | null {
  // Sicherheitsnetz: erledigte Erinnerungen nie anzeigen (falls doch eine
  // durchrutscht, obwohl wir nur INCOMPLETE abfragen).
  if (r.completed) return null;

  // dueDate ist das Faelligkeitsdatum (mit oder ohne Uhrzeit).
  const due = r.dueDate ? new Date(r.dueDate) : null;
  if (!due || isNaN(due.getTime())) return null;

  // "Ganztaegig", wenn keine Uhrzeit gesetzt ist (00:00 lokal).
  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;

  // Serien-Erinnerung? Dann Wiederholungsregel als RRULE merken (wird in
  // fetchReminders aufgeloest).
  const rrule = r.recurrenceRule ? recurrenceToRrule(r.recurrenceRule) : null;

  const base = {
    uid: `reminder-${r.id}`,
    calendarId: "reminders",
    title: r.title || "(ohne Titel)",
    location: "",
    notes: r.notes || "",
    reminders: [],
    rrule,
    source: "reminders" as const,
    color,
  };

  if (hasTime) {
    const end = new Date(due.getTime() + 30 * 60 * 1000);
    return { ...base, allDay: false, start: due.toISOString(), end: end.toISOString() };
  }
  const start = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const end = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
  return { ...base, allDay: true, start: start.toISOString(), end: end.toISOString() };
}
