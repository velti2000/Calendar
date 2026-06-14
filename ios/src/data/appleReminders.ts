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

  // Nur OFFENE (nicht erledigte) Erinnerungen laden (status = null).
  const reminders = await Calendar.getRemindersAsync(listIds, null, null, null);

  const events: CalEvent[] = [];
  for (const r of reminders) {
    try {
      const ev = mapReminder(r, color);
      if (ev) events.push(ev);
    } catch {
      // Einzelne unverstaendliche Erinnerung ueberspringen, nie den Sync abbrechen.
    }
  }
  return events;
}

/** Wandelt eine Erinnerung in ein NUR-LESENDES CalEvent um (oder null ohne Faelligkeit). */
function mapReminder(r: Calendar.Reminder, color: string): CalEvent | null {
  // dueDate ist das Faelligkeitsdatum (mit oder ohne Uhrzeit).
  const due = r.dueDate ? new Date(r.dueDate) : null;
  if (!due || isNaN(due.getTime())) return null;

  // "Ganztaegig", wenn keine Uhrzeit gesetzt ist (00:00 lokal).
  const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;

  const base = {
    uid: `reminder-${r.id}`,
    calendarId: "reminders",
    title: r.title || "(ohne Titel)",
    location: "",
    notes: r.notes || "",
    reminders: [],
    rrule: null,
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
