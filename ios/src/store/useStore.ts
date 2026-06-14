/*
 * store/useStore.ts  –  zentraler Datenspeicher (Zustand) der App
 * ==========================================================================
 * Portierung von pwa/js/store.js, aber mit "zustand" (kleine, gut lesbare
 * State-Bibliothek fuer React Native) statt eigenem Subscribe-Muster.
 *
 * Persistenz:
 *   - Kalender, Termine, Einstellungen  ->  AsyncStorage (wie localStorage)
 *   - PASSWORT fuer mailbox.org         ->  expo-secure-store
 *     (iOS-Schluesselbund, verschluesselt – NICHT im normalen Speicher!)
 *
 * WICHTIG – Sicherheitsfunktion "Nur-Lesen":
 *   settings.readOnly === true bedeutet: KEINE Aenderungen an den Server.
 *   Sync laeuft dann nur Server -> App. Standard ist absichtlich true.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import type { Calendar, CalEvent, Settings } from "../types";
import { getDemoCalendars, getDemoEvents } from "../data/demoData";
import { expandRecurring } from "../data/ical";
import * as caldav from "../data/caldav";
import { fetchTodoistTasks } from "../data/todoist";
import { fetchReminders } from "../data/appleReminders";
import { dayKey } from "../utils/dates";

// Zugangsdaten liegen im iOS-Schluesselbund (expo-secure-store),
// nicht im normalen App-Speicher.
const PASSWORD_KEY = "mailbox.password";
const USERNAME_KEY = "mailbox.username";
const TODOIST_TOKEN_KEY = "todoist.token";

/** Standard-Einstellungen beim allerersten Start. */
function defaultSettings(): Settings {
  return {
    theme: "auto",
    navPosition: "bottom",
    eventFontSize: 9,
    dayStartHour: 6,       // Tag/Woche scrollen beim Oeffnen auf 6:00 Uhr
    // Drei Zeitphasen, anfangs alle AUS – Beispielwerte als Startpunkt.
    timeBands: [
      { enabled: false, startHour: 13, endHour: 15, color: "#F1C40F" }, // z.B. Müdigkeit
      { enabled: false, startHour: 22, endHour: 24, color: "#7C3AED" }, // z.B. Abend
      { enabled: false, startHour: 0, endHour: 6, color: "#2B6CB0" },   // z.B. Nacht/Schlaf
    ],
    readOnly: true,        // Sicherheit: zunaechst keine Server-Schreibzugriffe
    defaultReminder: 30,
    notificationsEnabled: false,
    dataSource: "demo",
    username: "",
    todoistEnabled: false,
    todoistColor: "#E44332",   // Todoist-Rot
    remindersEnabled: false,
    remindersColor: "#7C3AED", // Violett (klar verschieden von Todoist-Rot)
  };
}

interface StoreState {
  calendars: Calendar[];
  events: CalEvent[];
  settings: Settings;
  syncing: boolean;
  // NUR-LESEND geladene Overlays (nie zum Server/zur Quelle geschrieben).
  todoistTasks: CalEvent[];
  reminderItems: CalEvent[];

  // Schreiben (lokal; Server-Sync macht der Aufrufer ueber syncToServer-Helfer)
  addEvent: (data: Partial<CalEvent>) => CalEvent;
  updateEvent: (uid: string, changes: Partial<CalEvent>) => CalEvent | null;
  deleteEvent: (uid: string) => void;
  toggleCalendarVisible: (id: string) => void;
  updateSettings: (changes: Partial<Settings>) => void;
  resetToDemo: () => void;
  clearData: () => void;

  // CalDAV
  syncFromServer: () => Promise<void>;
  // Externe Quellen (rein lesend)
  syncTodoist: () => Promise<void>;
  syncReminders: () => Promise<void>;
}

/** Erzeugt eine einfache, eindeutige UID fuer neue Termine. */
function generateUid(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      calendars: getDemoCalendars(),
      events: getDemoEvents(),
      settings: defaultSettings(),
      syncing: false,
      todoistTasks: [],
      reminderItems: [],

      addEvent: (data) => {
        const event: CalEvent = {
          uid: data.uid || generateUid(),
          calendarId: data.calendarId!,
          title: data.title || "(ohne Titel)",
          allDay: !!data.allDay,
          start: data.start!,
          end: data.end!,
          location: data.location || "",
          notes: data.notes || "",
          reminders: data.reminders || [],
          rrule: data.rrule || null,
        };
        set((s) => ({ events: [...s.events, event] }));
        return event;
      },

      updateEvent: (uid, changes) => {
        let updated: CalEvent | null = null;
        set((s) => ({
          events: s.events.map((e) => {
            if (e.uid !== uid) return e;
            updated = { ...e, ...changes };
            return updated;
          }),
        }));
        return updated;
      },

      deleteEvent: (uid) => {
        set((s) => ({ events: s.events.filter((e) => e.uid !== uid) }));
      },

      toggleCalendarVisible: (id) => {
        set((s) => ({
          calendars: s.calendars.map((c) =>
            c.id === id ? { ...c, visible: !c.visible } : c
          ),
        }));
      },

      updateSettings: (changes) => {
        set((s) => ({ settings: { ...s.settings, ...changes } }));
      },

      resetToDemo: () => {
        set({
          calendars: getDemoCalendars(),
          events: getDemoEvents(),
        });
      },

      /**
       * Loescht alle lokal gespeicherten Kalender und Termine aus der App.
       * Der SERVER bleibt unberuehrt. Wird beim Kontowechsel verwendet, damit
       * keine Daten des alten Kontos in der App zurueckbleiben.
       */
      clearData: () => {
        set({ calendars: [], events: [] });
      },

      /**
       * Sync Server -> App: Kalender entdecken, Termine laden, Daten ersetzen.
       * Die Sichtbarkeits-Auswahl bereits bekannter Kalender bleibt erhalten.
       */
      syncFromServer: async () => {
        const { settings, calendars } = get();
        const creds = await getCredentials();
        if (!creds) throw new Error("Keine Zugangsdaten hinterlegt (Einstellungen).");

        set({ syncing: true });
        try {
          const discovered = await caldav.discoverCalendars(creds);
          const visibleById = new Map(calendars.map((c) => [c.id, c.visible]));
          const merged = discovered.map((c) => ({
            ...c,
            visible: visibleById.get(c.id) ?? true,
          }));

          const allEvents: CalEvent[] = [];
          for (const cal of merged) {
            const events = await caldav.fetchEvents(cal.url!, cal.id, creds);
            allEvents.push(...events);
          }

          set({
            calendars: merged,
            events: allEvents,
            settings: { ...settings, dataSource: "caldav" },
          });
        } finally {
          set({ syncing: false });
        }
      },

      /**
       * Laedt Todoist-Aufgaben (rein lesend) und legt sie als Overlay ab.
       * Ist Todoist aus oder kein Token hinterlegt, wird das Overlay geleert.
       */
      syncTodoist: async () => {
        const { settings } = get();
        if (!settings.todoistEnabled) { set({ todoistTasks: [] }); return; }
        const token = await getTodoistToken();
        if (!token) { set({ todoistTasks: [] }); return; }
        const tasks = await fetchTodoistTasks(token, settings.todoistColor);
        set({ todoistTasks: tasks });
      },

      /**
       * Laedt iPhone-Erinnerungen (rein lesend) und legt sie als Overlay ab.
       * Ist die Funktion aus oder keine Berechtigung vorhanden, wird geleert.
       */
      syncReminders: async () => {
        const { settings } = get();
        if (!settings.remindersEnabled) { set({ reminderItems: [] }); return; }
        const items = await fetchReminders(settings.remindersColor);
        set({ reminderItems: items });
      },
    }),
    {
      name: "calendar.state.v1",
      storage: createJSONStorage(() => AsyncStorage),
      // syncing ist fluechtiger UI-Zustand und wird nicht gespeichert.
      partialize: (s) => ({
        calendars: s.calendars, events: s.events, settings: s.settings,
        // Overlays zwischenspeichern (Offline-Anzeige bis zum naechsten Sync).
        todoistTasks: s.todoistTasks, reminderItems: s.reminderItems,
      }),
      // Gespeicherten Zustand mit den aktuellen Standardwerten zusammenfuehren,
      // damit NEU hinzugekommene Einstellungen (z.B. dayStartHour) nicht
      // undefined sind, wenn der gespeicherte Stand sie noch nicht kennt.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<typeof current>;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        };
      },
    }
  )
);

/* -------------------------------------------------------------------------- */
/*  Passwort sicher ablegen (iOS-Schluesselbund)                                */
/* -------------------------------------------------------------------------- */

export async function savePassword(password: string): Promise<void> {
  if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password);
  else await SecureStore.deleteItemAsync(PASSWORD_KEY);
}

/** Speichert den Benutzernamen (E-Mail) im Schluesselbund. */
export async function saveUsername(username: string): Promise<void> {
  if (username) await SecureStore.setItemAsync(USERNAME_KEY, username);
  else await SecureStore.deleteItemAsync(USERNAME_KEY);
}

/**
 * Liest den gespeicherten Benutzernamen aus dem Schluesselbund. Faellt auf den
 * frueher im normalen Speicher abgelegten Wert zurueck (Migration aelterer
 * Versionen) – dieser wird beim naechsten Speichern entfernt.
 */
export async function getStoredUsername(): Promise<string> {
  const fromKeychain = await SecureStore.getItemAsync(USERNAME_KEY);
  if (fromKeychain) return fromKeychain;
  return useStore.getState().settings.username || "";
}

/** Loescht beide Zugangsdaten aus dem Schluesselbund (z.B. beim Abmelden). */
export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
  await SecureStore.deleteItemAsync(USERNAME_KEY);
}

/** Speichert das Todoist-API-Token im Schluesselbund. */
export async function saveTodoistToken(token: string): Promise<void> {
  if (token) await SecureStore.setItemAsync(TODOIST_TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TODOIST_TOKEN_KEY);
}

/** Liest das Todoist-API-Token aus dem Schluesselbund (oder null). */
export async function getTodoistToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TODOIST_TOKEN_KEY);
}

export async function getCredentials(): Promise<caldav.Credentials | null> {
  const username = await getStoredUsername();
  const password = await SecureStore.getItemAsync(PASSWORD_KEY);
  if (!username || !password) return null;
  return { username, password };
}

/* -------------------------------------------------------------------------- */
/*  Schreiben zum Server (CalDAV)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ergebnis eines Server-Schreibversuchs:
 *   "pushed"   – erfolgreich auf den Server geschrieben
 *   "demo"     – Demo-Modus, es gibt keinen Server
 *   "readonly" – Nur-Lesen ist aktiv, Aenderung bleibt nur lokal
 *   "local"    – kein Serverbezug noetig (z.B. Termin war nie auf dem Server)
 */
export type ServerWriteResult = "pushed" | "demo" | "readonly" | "local";

/**
 * Schreibt einen (bereits lokal gespeicherten) Termin auf den Server.
 * Wechselt der Termin den Kalender, wird er am alten Ort geloescht und am
 * neuen angelegt. href/etag werden anschliessend lokal aktualisiert.
 */
export async function pushEventToServer(uid: string): Promise<ServerWriteResult> {
  const { settings, calendars, events } = useStore.getState();
  if (settings.dataSource !== "caldav") return "demo";
  if (settings.readOnly) return "readonly";

  let event = events.find((e) => e.uid === uid);
  if (!event) throw new Error("Termin nicht gefunden.");

  const cal = calendars.find((c) => c.id === event!.calendarId);
  if (!cal?.url) return "local"; // lokaler Kalender ohne Server-Adresse

  const creds = await getCredentials();
  if (!creds) throw new Error("Keine Zugangsdaten hinterlegt (Einstellungen).");

  // Kalender gewechselt? Dann alte Ressource loeschen und neu anlegen.
  if (event.href && !event.href.startsWith(cal.url)) {
    await caldav.removeEvent(event, creds).catch(() => { /* alte Ressource evtl. schon weg */ });
    useStore.getState().updateEvent(uid, { href: undefined, etag: undefined });
    event = useStore.getState().events.find((e) => e.uid === uid)!;
  }

  const res = await caldav.pushEvent(cal.url, event, creds);
  useStore.getState().updateEvent(uid, { href: res.href, etag: res.etag ?? undefined });
  return "pushed";
}

/**
 * Loescht einen Termin lokal UND (falls moeglich) auf dem Server.
 * Lokal wird immer geloescht – auch wenn der Server nicht erreichbar ist,
 * wirft die Funktion dann einen Fehler, damit die UI es melden kann.
 */
export async function deleteEventEverywhere(uid: string): Promise<ServerWriteResult> {
  const { settings, events, deleteEvent } = useStore.getState();
  const event = events.find((e) => e.uid === uid);
  deleteEvent(uid);

  if (!event) return "local";
  if (settings.dataSource !== "caldav") return "demo";
  if (settings.readOnly) return "readonly";
  if (!event.href) return "local"; // war nie auf dem Server

  const creds = await getCredentials();
  if (!creds) throw new Error("Keine Zugangsdaten hinterlegt (Einstellungen).");
  await caldav.removeEvent(event, creds);
  return "pushed";
}

/* -------------------------------------------------------------------------- */
/*  Abgeleitete Daten (Selektoren)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Loest Serientermine (RRULE) in Einzelvorkommen auf – Zeitfenster wie in der
 * PWA: 1 Jahr zurueck bis 2 Jahre voraus.
 */
export function getExpandedEvents(events: CalEvent[]): CalEvent[] {
  const now = new Date();
  const windowStart = new Date(now.getFullYear() - 1, 0, 1);
  const windowEnd = new Date(now.getFullYear() + 2, 11, 31);
  return expandRecurring(events, windowStart, windowEnd);
}

/**
 * Nur die Termine sichtbarer Kalender – inkl. aufgeloester Serienvorkommen.
 * `extra` sind zusaetzliche, NUR-LESENDE Overlay-Eintraege (z.B. Todoist), die
 * NICHT an Kalender-Sichtbarkeit gebunden sind und unveraendert angehaengt werden.
 */
export function getVisibleEvents(events: CalEvent[], calendars: Calendar[], extra: CalEvent[] = []): CalEvent[] {
  const visibleIds = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const visible = getExpandedEvents(events).filter((e) => visibleIds.has(e.calendarId));
  return extra.length ? [...visible, ...extra] : visible;
}

/**
 * Gruppiert die sichtbaren Termine nach Tagesschluessel ("YYYY-MM-DD").
 * Mehrtaegige Termine erscheinen an jedem betroffenen Tag.
 * `extra` = zusaetzliche Overlay-Eintraege (z.B. Todoist).
 */
export function getEventsByDay(events: CalEvent[], calendars: Calendar[], extra: CalEvent[] = []): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const event of getVisibleEvents(events, calendars, extra)) {
    const start = new Date(event.start);
    let end = new Date(event.end);

    // Ganztagestermine enden per Konvention am Folgetag 00:00 -> korrigieren.
    if (event.allDay) end = new Date(end.getTime() - 1);

    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastKey = dayKey(end);
    let guard = 0;
    while (guard++ < 400) {
      const key = dayKey(cursor);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
      if (key === lastKey) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  // Pro Tag sortieren: Ganztags zuerst, dann nach Startzeit.
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
  }
  return map;
}

/** Volltextsuche ueber Titel, Ort und Notizen. */
export function searchEvents(events: CalEvent[], calendars: Calendar[], query: string): CalEvent[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getVisibleEvents(events, calendars)
    .filter((e) => {
      const haystack = `${e.title} ${e.location || ""} ${e.notes || ""}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
