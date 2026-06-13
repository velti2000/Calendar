/*
 * data/todoist.ts  –  Todoist-Aufgaben NUR LESEND laden
 * ==========================================================================
 * Holt die aktiven Aufgaben mit Faelligkeitsdatum ueber die Todoist-REST-API
 * (v2) und wandelt sie in CalEvent-Objekte um, damit sie als Overlay im
 * Kalender erscheinen koennen.
 *
 * WICHTIG: Diese Schicht SCHREIBT NIE nach Todoist. Die Verwaltung der
 * Aufgaben passiert in der Todoist-App selbst. Die erzeugten CalEvents tragen
 * `source: "todoist"` und werden dadurch ueberall vom CalDAV-Schreib-/Loeschpfad
 * und vom Termin-Editor ausgeschlossen.
 *
 * Authentifizierung: API-Token (Todoist → Einstellungen → Integrationen →
 * Entwickler). Es liegt sicher im iOS-Schluesselbund (siehe store/useStore.ts).
 */

import { Alert, Linking } from "react-native";
import type { CalEvent } from "../types";
import { formatTime } from "../utils/dates";

// Neue, vereinheitlichte Todoist-API v1. Die alte REST-v2
// (https://api.todoist.com/rest/v2/tasks) wurde abgeschaltet und liefert 410.
const API_URL = "https://api.todoist.com/api/v1/tasks";

/** Einheitliche Farbe fuer alle Todoist-Eintraege (Todoist-Rot). */
export const TODOIST_COLOR = "#E44332";

/** Die fuer uns relevanten Felder einer Todoist-Aufgabe. */
interface TodoistTask {
  id: string;
  content: string;
  url?: string;
  due?: {
    date: string;          // "YYYY-MM-DD"
    datetime?: string;     // ISO-Zeit, nur wenn eine Uhrzeit gesetzt ist
    is_recurring?: boolean;
  } | null;
}

/** Antwortform der v1-API: paginiert mit { results, next_cursor }. */
interface TasksResponse {
  results?: TodoistTask[];
  next_cursor?: string | null;
}

/**
 * Laedt alle aktiven Aufgaben mit Faelligkeit und gibt sie als CalEvents zurueck.
 * Die v1-API liefert Seiten zu je `limit` Aufgaben; wir folgen `next_cursor`.
 * @param token Todoist-API-Token
 */
export async function fetchTodoistTasks(token: string): Promise<CalEvent[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const events: CalEvent[] = [];

  let cursor: string | null = null;
  let page = 0;
  do {
    // Query manuell bauen (RN/Hermes-URLSearchParams ist eingeschraenkt).
    const query = `?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;

    let response: Response;
    try {
      response = await fetch(API_URL + query, { headers });
    } catch (err: any) {
      throw new Error(`Todoist nicht erreichbar (${err?.message ?? err}). Internetverbindung prüfen.`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("Todoist-Token ungültig – bitte in den Einstellungen prüfen.");
    }
    if (response.status >= 400) {
      throw new Error(`Todoist-Fehler (HTTP ${response.status}).`);
    }

    // Defensive: v1 liefert { results, next_cursor }, aeltere evtl. ein Array.
    const data = (await response.json()) as TasksResponse | TodoistTask[];
    const list = Array.isArray(data) ? data : (data.results ?? []);
    for (const task of list) {
      // Eine einzelne kaputte Aufgabe darf NIE den ganzen Sync abbrechen.
      try {
        const ev = mapTask(task);
        if (ev) events.push(ev);
      } catch {
        // Aufgabe mit unverstaendlichem Datum o.Ae. einfach ueberspringen.
      }
    }
    cursor = Array.isArray(data) ? null : (data.next_cursor ?? null);
  } while (cursor && ++page < 20); // Sicherheitskappe gegen Endlosschleifen

  return events;
}

/**
 * Parst einen Todoist-Datums-/Zeitwert robust (ohne sich auf new Date(string)
 * zu verlassen – Hermes parst manche ISO-Varianten nicht). Unterstuetzt:
 *   "2026-06-13"                          -> reines Datum (lokale Mitternacht)
 *   "2026-06-13T10:00:00"                 -> floating, lokale Zeit
 *   "2026-06-13T10:00:00Z"                -> UTC
 *   "2026-06-13T10:00:00.123456Z"         -> mit (Mikro-)Sekundenbruchteil
 *   "2026-06-13T10:00:00+02:00" / "+0200" -> mit Zeitzonen-Offset
 * @returns gueltiges Date oder null
 */
function parseTodoistDate(value: string): Date | null {
  // Reines Datum
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]); // lokale Mitternacht

  // Datum + Uhrzeit (Sekunden, Bruchteile und Zeitzone optional)
  m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;

  const [, y, mo, d, h, mi, s, tz] = m;
  const sec = s ? +s : 0;

  if (!tz) {
    // Floating: als lokale Geraetezeit interpretieren (wie in data/ical.ts).
    return new Date(+y, +mo - 1, +d, +h, +mi, sec);
  }
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, sec);
  if (tz === "Z") return new Date(utc);

  // Offset "+02:00" / "+0200" anwenden.
  const sign = tz[0] === "-" ? -1 : 1;
  const digits = tz.slice(1).replace(":", "");
  const offsetMin = sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2, 4), 10));
  return new Date(utc - offsetMin * 60000);
}

/** Wandelt eine Aufgabe in ein NUR-LESENDES CalEvent um (oder null ohne gueltige Faelligkeit). */
function mapTask(task: TodoistTask): CalEvent | null {
  const due = task.due;
  if (!due) return null;

  // Mit Uhrzeit, wenn datetime gesetzt ist (oder das Datum eine Zeit enthaelt).
  const raw = due.datetime || due.date;
  if (!raw) return null;
  const hasTime = raw.includes("T") || raw.includes(":");

  const start = parseTodoistDate(raw);
  if (!start || isNaN(start.getTime())) return null; // ungueltig -> ueberspringen

  const base = {
    uid: `todoist-${task.id}`,
    calendarId: "todoist",
    title: task.content,
    location: "",
    notes: "",
    reminders: [],          // keine eigenen Benachrichtigungen (Todoist erinnert selbst)
    rrule: null,
    source: "todoist" as const,
    color: TODOIST_COLOR,
    // v1 liefert evtl. kein url-Feld -> aus der ID einen Web-Link bauen.
    externalUrl: task.url || `https://app.todoist.com/app/task/${task.id}`,
  };

  if (hasTime) {
    // Mit Uhrzeit: als 30-Minuten-Block darstellen.
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return { ...base, allDay: false, start: start.toISOString(), end: end.toISOString() };
  }

  // Nur Datum: Ganztages-Eintrag (Ende = Folgetag 00:00, iCal-Konvention).
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { ...base, allDay: true, start: start.toISOString(), end: end.toISOString() };
}

/**
 * Zeigt eine Todoist-Aufgabe als Info-Dialog an (rein lesend). Statt den
 * Termin-Editor zu oeffnen, kann man die Aufgabe optional in der Todoist-App
 * oeffnen – verwaltet wird sie dort, nicht in dieser App.
 */
export function presentTodoistTask(ev: CalEvent): void {
  const when = ev.allDay
    ? "Fällig: ganztägig"
    : `Fällig: ${formatTime(new Date(ev.start))} Uhr`;

  const buttons: { text: string; onPress?: () => void; style?: "cancel" }[] = [];
  if (ev.externalUrl) {
    buttons.push({ text: "In Todoist öffnen", onPress: () => Linking.openURL(ev.externalUrl!) });
  }
  buttons.push({ text: "Schließen", style: "cancel" });

  Alert.alert(ev.title, `Todoist-Aufgabe\n${when}`, buttons);
}
