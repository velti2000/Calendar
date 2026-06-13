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

const API_URL = "https://api.todoist.com/rest/v2/tasks";

/** Einheitliche Farbe fuer alle Todoist-Eintraege (Todoist-Rot). */
export const TODOIST_COLOR = "#E44332";

/** Die fuer uns relevanten Felder einer Todoist-Aufgabe. */
interface TodoistTask {
  id: string;
  content: string;
  url?: string;
  due?: {
    date: string;          // "YYYY-MM-DD"
    datetime?: string;     // RFC3339, nur wenn eine Uhrzeit gesetzt ist
    is_recurring?: boolean;
  } | null;
}

/**
 * Laedt alle aktiven Aufgaben mit Faelligkeit und gibt sie als CalEvents zurueck.
 * @param token Todoist-API-Token
 */
export async function fetchTodoistTasks(token: string): Promise<CalEvent[]> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err: any) {
    throw new Error(`Todoist nicht erreichbar (${err?.message ?? err}). Internetverbindung prüfen.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Todoist-Token ungültig – bitte in den Einstellungen prüfen.");
  }
  if (response.status >= 400) {
    throw new Error(`Todoist-Fehler (HTTP ${response.status}).`);
  }

  const tasks = (await response.json()) as TodoistTask[];
  const events: CalEvent[] = [];
  for (const task of tasks) {
    const ev = mapTask(task);
    if (ev) events.push(ev);
  }
  return events;
}

/** Wandelt eine Aufgabe in ein NUR-LESENDES CalEvent um (oder null ohne Faelligkeit). */
function mapTask(task: TodoistTask): CalEvent | null {
  if (!task.due) return null;

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
    externalUrl: task.url,
  };

  if (task.due.datetime) {
    // Mit Uhrzeit: als 30-Minuten-Block darstellen.
    const start = new Date(task.due.datetime);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return { ...base, allDay: false, start: start.toISOString(), end: end.toISOString() };
  }

  // Nur Datum: als Ganztages-Eintrag (Ende = Folgetag 00:00, iCal-Konvention).
  const [y, m, d] = task.due.date.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
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
