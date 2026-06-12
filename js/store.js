/*
 * store.js  –  zentraler Datenspeicher (State) der App
 * ==========================================================================
 * Der Store haelt den gesamten App-Zustand an EINER Stelle:
 *   - calendars : die Kategorien/Sub-Kalender
 *   - events    : alle Termine
 *   - settings  : Einstellungen (Theme, Nur-Lesen, Account, Erinnerungen ...)
 *
 * Andere Module "abonnieren" den Store (subscribe). Bei jeder Aenderung wird
 * neu gerendert. Das ist ein einfaches, gut nachvollziehbares Muster ohne
 * externes Framework.
 *
 * Persistenz: Der Zustand wird im localStorage des Browsers gespeichert, damit
 * Termine nach dem Schliessen erhalten bleiben. (Spaeter ersetzt/ergaenzt der
 * CalDAV-Sync diese Quelle.)
 *
 * WICHTIG – Sicherheitsfunktion "Nur-Lesen":
 *   settings.readOnly === true bedeutet: Es duerfen KEINE Aenderungen an den
 *   Server (mailbox.org) geschrieben werden. Lokales Ausprobieren bleibt
 *   moeglich, aber der Sync laeuft dann ausschliesslich Server -> App.
 *   Standardwert ist absichtlich true (Sicherheit am Anfang).
 */

import { getDemoCalendars, getDemoEvents } from "./data/demoData.js";
import { expandRecurring } from "./data/ical.js";
import { dayKey } from "./utils/dates.js";

const STORAGE_KEY = "calendar.state.v1";

/** Standard-Einstellungen beim allerersten Start. */
function defaultSettings() {
  return {
    theme: "auto",          // "auto" | "light" | "dark"
    navPosition: "bottom",  // "bottom" | "top" – Position der Navigationsleiste
    eventFontSize: 10,      // Schriftgroesse der Termine in der Monatsansicht (px)
    readOnly: true,          // Sicherheit: zunaechst keine Server-Schreibzugriffe
    defaultReminder: 30,     // Standard-Erinnerung in Minuten (-1 = keine)
    notificationsEnabled: false,
    // Zugangsdaten fuer mailbox.org (CalDAV). Werden im localStorage abgelegt.
    // HINWEIS: localStorage ist nicht verschluesselt – siehe README (Sicherheit).
    account: {
      serverUrl: "",        // z.B. Proxy-URL oder CalDAV-Basis
      username: "",         // mailbox.org E-Mail-Adresse
      password: "",         // App-spezifisches Passwort empfohlen
    },
    dataSource: "demo",     // "demo" | "caldav"
  };
}

/**
 * Der eigentliche Zustand. Wird nicht direkt von aussen veraendert,
 * sondern ueber die Methoden weiter unten.
 */
const state = {
  calendars: [],
  events: [],
  settings: defaultSettings(),
};

// Liste der Abonnenten (Funktionen), die bei Aenderungen aufgerufen werden.
const subscribers = new Set();

/* -------------------------------------------------------------------------- */
/*  Laden & Speichern                                                          */
/* -------------------------------------------------------------------------- */

/** Laedt den Zustand aus dem localStorage oder legt Demo-Daten an. */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.calendars = parsed.calendars || [];
      state.events = parsed.events || [];
      // Einstellungen mit Standardwerten zusammenfuehren (falls neue dazukamen).
      state.settings = { ...defaultSettings(), ...(parsed.settings || {}) };
      state.settings.account = { ...defaultSettings().account, ...(parsed.settings?.account || {}) };
      recomputeExpanded();
      return;
    }
  } catch (err) {
    console.warn("Konnte gespeicherten Zustand nicht lesen:", err);
  }
  // Erststart: Demo-Daten laden.
  state.calendars = getDemoCalendars();
  state.events = getDemoEvents();
  state.settings = defaultSettings();
  recomputeExpanded();
  persist();
}

/**
 * Loest Serientermine (RRULE) fuer die Anzeige in Einzelvorkommen auf und legt
 * das Ergebnis in `state._expanded` ab. Wird nach jeder Datenaenderung neu
 * berechnet. So erscheinen auch lokal angelegte Serientermine sofort.
 */
function recomputeExpanded() {
  const now = new Date();
  const windowStart = new Date(now.getFullYear() - 1, 0, 1);
  const windowEnd = new Date(now.getFullYear() + 2, 11, 31);
  state._expanded = expandRecurring(state.events, windowStart, windowEnd);
}

/** Schreibt den aktuellen Zustand in den localStorage. */
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      calendars: state.calendars,
      events: state.events,
      settings: state.settings,
    }));
  } catch (err) {
    console.warn("Konnte Zustand nicht speichern:", err);
  }
}

/* -------------------------------------------------------------------------- */
/*  Abonnieren / Benachrichtigen                                               */
/* -------------------------------------------------------------------------- */

/**
 * Registriert eine Funktion, die bei jeder Aenderung aufgerufen wird.
 * @param {Function} fn
 * @returns {Function} Aufruf zum Abmelden.
 */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Benachrichtigt alle Abonnenten (und speichert vorher). */
function emit() {
  recomputeExpanded(); // Serientermine fuer die Anzeige neu aufloesen
  persist();
  subscribers.forEach((fn) => fn(state));
}

/* -------------------------------------------------------------------------- */
/*  Lesen                                                                      */
/* -------------------------------------------------------------------------- */

/** Liefert eine (flache) Kopie des Zustands zum Anzeigen. */
export function getState() {
  return state;
}

export function getCalendars() {
  return state.calendars;
}

/** Findet einen Kalender per id. */
export function getCalendar(id) {
  return state.calendars.find((c) => c.id === id) || null;
}

/** Findet einen (Original-)Termin per uid (ohne aufgeloeste Serienvorkommen). */
export function getEvent(uid) {
  return state.events.find((e) => e.uid === uid) || null;
}

export function getSettings() {
  return state.settings;
}

/**
 * Nur die Termine sichtbarer Kalender – inkl. aufgeloester Serienvorkommen
 * (state._expanded), damit z.B. Geburtstage an jedem Jahrestag erscheinen.
 */
export function getVisibleEvents() {
  const visibleIds = new Set(state.calendars.filter((c) => c.visible).map((c) => c.id));
  return (state._expanded || state.events).filter((e) => visibleIds.has(e.calendarId));
}

/**
 * Gruppiert die sichtbaren Termine nach Tagesschluessel ("YYYY-MM-DD").
 * Mehrtaegige Termine erscheinen an jedem betroffenen Tag.
 * @returns {Map<string, CalEvent[]>}
 */
export function getEventsByDay() {
  const map = new Map();
  for (const event of getVisibleEvents()) {
    const start = new Date(event.start);
    let end = new Date(event.end);

    // Ganztagestermine enden per Konvention am Folgetag 00:00 -> letzten Tag
    // korrigieren, damit der Termin nicht faelschlich am Folgetag auftaucht.
    if (event.allDay) end = new Date(end.getTime() - 1);

    // Ueber alle betroffenen Kalendertage iterieren.
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastKey = dayKey(end);
    let guard = 0;
    while (guard++ < 400) {
      const key = dayKey(cursor);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
      if (key === lastKey) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  // Pro Tag sortieren: Ganztags zuerst, dann nach Startzeit.
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start) - new Date(b.start);
    });
  }
  return map;
}

/**
 * Volltextsuche ueber Titel, Ort und Notizen.
 * @param {string} query
 * @returns {CalEvent[]} nach Startdatum sortiert
 */
export function searchEvents(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const visibleIds = new Set(state.calendars.filter((c) => c.visible).map((c) => c.id));
  return (state._expanded || state.events)
    .filter((e) => visibleIds.has(e.calendarId))
    .filter((e) => {
      const haystack = `${e.title} ${e.location || ""} ${e.notes || ""}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/* -------------------------------------------------------------------------- */
/*  Schreiben (lokal). Server-Sync erfolgt spaeter in der CalDAV-Schicht.       */
/* -------------------------------------------------------------------------- */

/** Erzeugt eine einfache, eindeutige UID fuer neue Termine. */
function generateUid() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Fuegt einen neuen Termin hinzu (lokal).
 * @param {Partial<CalEvent>} data
 * @returns {CalEvent} der angelegte Termin
 */
export function addEvent(data) {
  const event = {
    uid: data.uid || generateUid(),
    calendarId: data.calendarId,
    title: data.title || "(ohne Titel)",
    allDay: !!data.allDay,
    start: data.start,
    end: data.end,
    location: data.location || "",
    notes: data.notes || "",
    reminders: data.reminders || [],
    rrule: data.rrule || null, // Wiederholungsregel (Serientermin)
  };
  state.events.push(event);
  emit();
  return event;
}

/**
 * Aktualisiert einen bestehenden Termin (lokal).
 * @param {string} uid
 * @param {Partial<CalEvent>} changes
 */
export function updateEvent(uid, changes) {
  const idx = state.events.findIndex((e) => e.uid === uid);
  if (idx === -1) return null;
  state.events[idx] = { ...state.events[idx], ...changes };
  emit();
  return state.events[idx];
}

/**
 * Loescht einen Termin (lokal).
 * @param {string} uid
 */
export function deleteEvent(uid) {
  const before = state.events.length;
  state.events = state.events.filter((e) => e.uid !== uid);
  if (state.events.length !== before) emit();
}

/** Schaltet die Sichtbarkeit eines Kalenders um. */
export function toggleCalendarVisible(id) {
  const cal = getCalendar(id);
  if (cal) {
    cal.visible = !cal.visible;
    emit();
  }
}

/**
 * Aktualisiert Einstellungen (teilweise) und benachrichtigt Abonnenten.
 * @param {Partial<typeof state.settings>} changes
 */
export function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  if (changes.account) {
    state.settings.account = { ...state.settings.account, ...changes.account };
  }
  emit();
}

/**
 * Setzt Kalender + Termine komplett neu (z.B. nach einem Server-Sync).
 * @param {Calendar[]} calendars
 * @param {CalEvent[]} events
 */
export function replaceData(calendars, events) {
  state.calendars = calendars;
  state.events = events;
  emit();
}
