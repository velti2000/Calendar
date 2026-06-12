/*
 * data/dataSource.js  –  Vermittler zwischen App und Datenquelle
 * ==========================================================================
 * Die App kennt nur diese Funktionen und muss nicht wissen, ob die Daten aus
 * den Demo-Daten oder von mailbox.org (CalDAV) kommen. Umschaltbar ueber
 * settings.dataSource ("demo" | "caldav").
 *
 * So bleibt der Umstieg von Demo- auf Echtbetrieb einfach: nur die Einstellung
 * aendern und Zugangsdaten eintragen.
 */

import { getSettings, replaceData, getCalendars, getState } from "../store.js";
import * as caldav from "./caldav.js";

/**
 * Prueft die Verbindung zum Server (bzw. meldet im Demo-Modus Erfolg).
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function testConnection() {
  const settings = getSettings();
  if (settings.dataSource !== "caldav") {
    return { ok: true, message: "Demo-Modus – keine Serververbindung nötig." };
  }
  try {
    const cals = await caldav.discoverCalendars();
    return { ok: true, message: `${cals.length} Kalender gefunden.` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Holt Kalender und Termine vom Server und ersetzt damit den lokalen Stand.
 * Das ist die Richtung Server -> App und auch im Nur-Lesen-Modus erlaubt.
 * @returns {Promise<{ok:boolean, message?:string, count?:number}>}
 */
export async function syncFromServer() {
  const settings = getSettings();

  if (settings.dataSource !== "caldav") {
    return { ok: false, message: "Datenquelle steht auf „Demo“. In den Einstellungen auf CalDAV umstellen." };
  }

  try {
    // 1) Kalender (Kategorien) entdecken.
    const calendars = await caldav.discoverCalendars();
    if (calendars.length === 0) {
      return { ok: false, message: "Keine Kalender gefunden." };
    }

    // 2) Sichtbarkeit aus dem bisherigen Stand uebernehmen (falls vorhanden).
    const previous = new Map(getCalendars().map((c) => [c.id, c]));
    for (const cal of calendars) {
      const prev = previous.get(cal.id);
      if (prev) cal.visible = prev.visible;
    }

    // 3) Termine aller Kalender laden. Serientermine bleiben als EIN Eintrag
    //    (mit RRULE) erhalten – das Aufloesen in Einzelvorkommen erledigt der
    //    Store zentral fuer die Anzeige (so bleiben Serien bearbeitbar).
    let allEvents = [];
    for (const cal of calendars) {
      const events = await caldav.fetchEvents(cal.url, cal.id);
      allEvents = allEvents.concat(events);
    }

    // 4) Lokalen Stand komplett ersetzen.
    replaceData(calendars, allEvents);
    return { ok: true, count: allEvents.length };
  } catch (err) {
    console.error("Sync-Fehler:", err);
    return { ok: false, message: err.message };
  }
}

/**
 * Schreibt eine lokale Aenderung auf den Server – NUR wenn Nur-Lesen aus ist
 * und die Datenquelle CalDAV ist. Wird spaeter vom Editor aufgerufen, sobald
 * der Echtbetrieb steht. Im Demo-Modus passiert hier bewusst nichts.
 *
 * @param {"put"|"delete"} action
 * @param {CalEvent} event
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
export async function pushChange(action, event) {
  const settings = getSettings();

  // Sicherheitsnetz: im Demo-Modus oder bei Nur-Lesen nichts an den Server senden.
  if (settings.dataSource !== "caldav") return { ok: true, message: "Demo – nur lokal." };
  if (settings.readOnly) return { ok: true, message: "Nur-Lesen – nicht gesendet." };

  try {
    const calendar = getCalendars().find((c) => c.id === event.calendarId);
    if (!calendar) return { ok: false, message: "Kalender nicht gefunden." };

    if (action === "put") {
      const r = await caldav.pushEvent(calendar.url, event);
      // Adresse (href) + Version (etag) an den Aufrufer zurueckgeben.
      return { ok: true, href: r.href, etag: r.etag };
    } else if (action === "delete") {
      await caldav.removeEvent(event);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
