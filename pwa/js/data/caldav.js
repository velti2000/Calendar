/*
 * data/caldav.js  –  CalDAV-Client (Kommunikation mit mailbox.org ueber Proxy)
 * ==========================================================================
 * Ein Browser darf aus Sicherheitsgruenden (CORS) nicht direkt mit dem
 * CalDAV-Server von mailbox.org sprechen. Deshalb laeuft jede Anfrage ueber
 * den PHP-Proxy (proxy/caldav-proxy.php), der auf deinem Webserver liegt.
 *
 * Ablauf einer Anfrage:
 *   App  --(POST an Proxy mit Ziel-URL + Zugangsdaten)-->  Proxy  -->  mailbox.org
 *
 * Dieses Modul kapselt:
 *   - request()          : eine WebDAV-Anfrage ueber den Proxy schicken
 *   - discoverCalendars(): die Kalender (Kategorien) des Kontos finden
 *   - fetchEvents()       : Termine eines Kalenders laden
 *   - pushEvent()         : Termin anlegen/aendern  (nur wenn NICHT Nur-Lesen)
 *   - removeEvent()       : Termin loeschen          (nur wenn NICHT Nur-Lesen)
 *
 * Die CalDAV-Basis von mailbox.org ist:  https://dav.mailbox.org/
 */

import { getSettings } from "../store.js";
import { parseICalendar, buildICalendar } from "./ical.js";

// Standard-CalDAV-Basis von mailbox.org. Kann in den Einstellungen ueberschrieben
// werden, falls noetig. Discovery startet hier.
export const MAILBOX_CALDAV_BASE = "https://dav.mailbox.org/";

/**
 * Schickt eine WebDAV-Anfrage ueber den Proxy.
 * @param {string} method   WebDAV-Methode: PROPFIND | REPORT | GET | PUT | DELETE | MKCALENDAR
 * @param {string} targetUrl absolute Ziel-URL auf dem CalDAV-Server
 * @param {object} [opts]
 * @param {string} [opts.body]   Anfrage-Koerper (XML oder iCalendar)
 * @param {string} [opts.depth]  WebDAV-"Depth"-Header ("0" oder "1")
 * @param {string} [opts.contentType]
 * @param {string} [opts.ifMatch] ETag fuer optimistische Sperre (Aendern/Loeschen)
 * @returns {Promise<{status:number, text:string, etag:string|null, headers:Headers}>}
 */
export async function request(method, targetUrl, opts = {}) {
  const { account } = getSettings();
  if (!account.serverUrl) {
    throw new Error("Keine Proxy-/Server-URL in den Einstellungen hinterlegt.");
  }

  const headers = {
    // Wir senden immer als POST an den Proxy; die echte Methode steht im Header.
    "X-Dav-Method": method,
    "X-Dav-Target": targetUrl,
    "X-Dav-User": account.username,
    "X-Dav-Pass": account.password,
  };
  if (opts.depth != null) headers["X-Dav-Depth"] = String(opts.depth);
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  if (opts.ifMatch) headers["X-Dav-If-Match"] = opts.ifMatch;

  let response;
  try {
    response = await fetch(account.serverUrl, {
      method: "POST",
      headers,
      body: opts.body || undefined,
    });
  } catch (err) {
    // Ein hier geworfener Fehler bedeutet: Die Anfrage kam GAR NICHT durch
    // (kein HTTP-Status). Typische Ursachen verständlich erklären.
    const pageHttps = location.protocol === "https:";
    const proxyHttp = /^http:\/\//i.test(account.serverUrl);
    let hint = "Der Proxy/Server ist nicht erreichbar.";
    if (pageHttps && proxyHttp) {
      hint = "Die App läuft über HTTPS, der Proxy aber über HTTP – der Browser blockiert das (Mixed Content). Lösung: Server auf HTTPS umstellen ODER die App ebenfalls über http:// öffnen.";
    } else {
      hint = "Proxy nicht erreichbar. Prüfe die Proxy-URL, ob die Datei wirklich dort liegt, und ob der Server online ist.";
    }
    throw new Error(`Verbindung fehlgeschlagen (${err.message}). ${hint}`);
  }

  const text = await response.text();
  return {
    status: response.status,
    text,
    etag: response.headers.get("X-Dav-Etag") || response.headers.get("ETag"),
    headers: response.headers,
  };
}

/**
 * Findet die Kalender (Kategorien) des Kontos.
 * Vorgehen (vereinfacht): PROPFIND mit Tiefe 1 auf die Kalender-Basis und
 * alle gefundenen Kalender-Sammlungen einsammeln.
 *
 * @returns {Promise<Array<{id:string,name:string,color:string,url:string}>>}
 */
export async function discoverCalendars() {
  const base = MAILBOX_CALDAV_BASE;

  // 1) Wer ist angemeldet? -> Principal-URL des Nutzers.
  const principalUrl = await findCurrentUserPrincipal(base);

  // 2) Wo liegen die Kalender des Nutzers? -> calendar-home-set.
  const homeUrl = await findCalendarHome(principalUrl || base);

  // 3) Welche Kalender gibt es dort? -> Liste der Kalender-Sammlungen.
  return await listCalendars(homeUrl || base);
}

const XML_CT = 'application/xml; charset="utf-8"';

/**
 * Schritt 1 der Discovery: die Principal-URL des angemeldeten Nutzers finden.
 * (PROPFIND auf die Basis, fragt <current-user-principal> ab.)
 */
async function findCurrentUserPrincipal(base) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  const res = await request("PROPFIND", base, { depth: 0, contentType: XML_CT, body });
  if (res.status === 401) throw new Error("Anmeldung fehlgeschlagen – Benutzername/Passwort prüfen.");
  if (res.status >= 400) throw new Error(`Discovery fehlgeschlagen (HTTP ${res.status}). Proxy-URL korrekt?`);

  const doc = new DOMParser().parseFromString(res.text, "application/xml");
  const node = doc.getElementsByTagNameNS("DAV:", "current-user-principal")[0];
  const href = node && node.getElementsByTagNameNS("DAV:", "href")[0];
  return href ? new URL(href.textContent.trim(), base).href : null;
}

/**
 * Schritt 2 der Discovery: den Kalender-Heimatordner (calendar-home-set) finden.
 */
async function findCalendarHome(principalUrl) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
  const res = await request("PROPFIND", principalUrl, { depth: 0, contentType: XML_CT, body });
  if (res.status >= 400) throw new Error(`Kalender-Ordner nicht gefunden (HTTP ${res.status}).`);

  const doc = new DOMParser().parseFromString(res.text, "application/xml");
  const node = doc.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar-home-set")[0];
  const href = node && node.getElementsByTagNameNS("DAV:", "href")[0];
  return href ? new URL(href.textContent.trim(), principalUrl).href : null;
}

/**
 * Schritt 3 der Discovery: alle Kalender im Heimatordner auflisten (Tiefe 1).
 */
async function listCalendars(homeUrl) {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <cs:getctag/>
    <ic:calendar-color/>
  </d:prop>
</d:propfind>`;
  const res = await request("PROPFIND", homeUrl, { depth: 1, contentType: XML_CT, body });
  if (res.status >= 400) throw new Error(`Kalenderliste fehlgeschlagen (HTTP ${res.status}).`);

  return parseCalendarList(res.text, homeUrl);
}

/** Parst die Multistatus-Antwort von PROPFIND in eine Kalenderliste. */
function parseCalendarList(xmlText, baseUrl) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const responses = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
  const calendars = [];

  for (const resp of responses) {
    // Ist diese Ressource ein Kalender? (resourcetype enthaelt <C:calendar/>)
    const isCalendar = resp.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar").length > 0;
    if (!isCalendar) continue;

    const hrefNode = resp.getElementsByTagNameNS("DAV:", "href")[0];
    const nameNode = resp.getElementsByTagNameNS("DAV:", "displayname")[0];
    const colorNode = resp.getElementsByTagNameNS("http://apple.com/ns/ical/", "calendar-color")[0];

    const href = hrefNode ? hrefNode.textContent.trim() : "";
    if (!href) continue;

    const url = new URL(href, baseUrl).href;
    calendars.push({
      id: url,                               // URL dient als eindeutige id
      url,
      name: nameNode ? nameNode.textContent.trim() : "Kalender",
      color: normalizeColor(colorNode ? colorNode.textContent.trim() : "") || randomColor(url),
      visible: true,
    });
  }
  return calendars;
}

/**
 * Laedt alle Termine eines Kalenders per REPORT (calendar-query).
 * @param {string} calendarUrl
 * @param {string} calendarId  lokale id, die den Events zugewiesen wird
 * @returns {Promise<CalEvent[]>}
 */
export async function fetchEvents(calendarUrl, calendarId) {
  // WICHTIG: Wir grenzen die Abfrage auf einen Zeitbereich ein (1 Jahr zurueck
  // bis 2 Jahre voraus). Ohne diese Grenze versucht der Server, die KOMPLETTE
  // Kalenderhistorie zu liefern – das fuehrt bei grossen Kalendern zu Timeouts
  // und damit zu HTTP 502. Der Bereich passt zum Anzeige-Fenster der App.
  const now = new Date();
  const rangeStart = icalUtc(new Date(now.getFullYear() - 1, 0, 1));
  const rangeEnd = icalUtc(new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59));

  const reportBody =
    `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${rangeStart}" end="${rangeEnd}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const res = await request("REPORT", calendarUrl, {
    depth: 1,
    contentType: 'application/xml; charset="utf-8"',
    body: reportBody,
  });
  if (res.status >= 400) {
    // Antworttext des Proxys/Servers mitgeben – hilft bei der Fehlersuche.
    const detail = (res.text || "").trim().slice(0, 200);
    const hint = res.status === 502
      ? " (Zeitüberschreitung/Server-Gateway – evtl. zu großer Kalender)"
      : "";
    throw new Error(`REPORT fehlgeschlagen (HTTP ${res.status})${hint}${detail ? ": " + detail : ""}`);
  }

  // Aus der Multistatus-Antwort die einzelnen calendar-data (ICS) herausziehen.
  const doc = new DOMParser().parseFromString(res.text, "application/xml");
  const responses = Array.from(doc.getElementsByTagNameNS("DAV:", "response"));
  const events = [];

  for (const resp of responses) {
    const hrefNode = resp.getElementsByTagNameNS("DAV:", "href")[0];
    const dataNode = resp.getElementsByTagNameNS("urn:ietf:params:xml:ns:caldav", "calendar-data")[0];
    const etagNode = resp.getElementsByTagNameNS("DAV:", "getetag")[0];
    if (!dataNode) continue;

    const parsed = parseICalendar(dataNode.textContent, calendarId);
    for (const ev of parsed) {
      // href und etag fuer spaeteres Aendern/Loeschen merken.
      ev.href = hrefNode ? new URL(hrefNode.textContent.trim(), calendarUrl).href : undefined;
      ev.etag = etagNode ? etagNode.textContent.trim() : ev.etag;
      events.push(ev);
    }
  }
  return events;
}

/**
 * Legt einen Termin an oder aendert ihn (PUT). NUR wenn Nur-Lesen aus ist.
 * @param {string} calendarUrl Basis-URL des Zielkalenders
 * @param {CalEvent} event
 */
export async function pushEvent(calendarUrl, event) {
  guardWritable();
  const ics = buildICalendar(event);
  // Dateiname der Ressource: <uid>.ics im Kalender.
  const targetUrl = event.href || new URL(`${encodeURIComponent(event.uid)}.ics`, calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/").href;

  const res = await request("PUT", targetUrl, {
    contentType: "text/calendar; charset=utf-8",
    ifMatch: event.etag,
    body: ics,
  });
  if (res.status >= 400) throw new Error(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
  return { href: targetUrl, etag: res.etag };
}

/**
 * Loescht einen Termin (DELETE). NUR wenn Nur-Lesen aus ist.
 * @param {CalEvent} event  muss event.href enthalten
 */
export async function removeEvent(event) {
  guardWritable();
  if (!event.href) throw new Error("Termin hat keine Server-Adresse (href).");
  const res = await request("DELETE", event.href, { ifMatch: event.etag });
  if (res.status >= 400 && res.status !== 404) {
    throw new Error(`Löschen fehlgeschlagen (HTTP ${res.status}).`);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Hilfen                                                                     */
/* -------------------------------------------------------------------------- */

/** Formatiert ein Date als CalDAV-/iCal-UTC-Zeitstempel "YYYYMMDDTHHMMSSZ". */
function icalUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Wirft einen Fehler, wenn Nur-Lesen aktiv ist (Schreibschutz). */
function guardWritable() {
  if (getSettings().readOnly) {
    throw new Error("Nur-Lesen ist aktiv – Schreiben auf den Server ist gesperrt.");
  }
}

/** Normalisiert Farben wie "#RRGGBBAA" auf "#RRGGBB". */
function normalizeColor(c) {
  if (!c) return "";
  const m = c.match(/^#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : c;
}

/** Erzeugt aus einem String eine stabile Farbe (Fallback, falls Server keine liefert). */
function randomColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const palette = ["#2b6cb0", "#38a169", "#dd6b20", "#9b2c2c", "#6b46c1", "#0d9488", "#b7791f"];
  return palette[Math.abs(hash) % palette.length];
}
