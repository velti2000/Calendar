/*
 * data/caldav.ts  –  CalDAV-Client fuer mailbox.org (DIREKT, ohne Proxy!)
 * ==========================================================================
 * Grosser Vorteil der nativen App gegenueber der PWA: Es gibt keine
 * CORS-Beschraenkung. Die App spricht DIREKT mit https://dav.mailbox.org/
 * per HTTP Basic Auth – der PHP-Proxy entfaellt komplett.
 *
 * Dieses Modul kapselt:
 *   - request()          : eine WebDAV-Anfrage senden (PROPFIND/REPORT/PUT/DELETE)
 *   - discoverCalendars(): die Kalender (Kategorien) des Kontos finden
 *   - fetchEvents()      : Termine eines Kalenders laden (Zeitfenster!)
 *   - pushEvent()        : Termin anlegen/aendern (nur wenn NICHT Nur-Lesen)
 *   - removeEvent()      : Termin loeschen (nur wenn NICHT Nur-Lesen)
 *
 * XML-Antworten werden mit fast-xml-parser gelesen (React Native hat keinen
 * eingebauten DOMParser).
 */

import { XMLParser } from "fast-xml-parser";
import type { Calendar, CalEvent } from "../types";
import { parseICalendar, buildICalendar } from "./ical";

/** CalDAV-Basis von mailbox.org. Discovery startet hier. */
export const MAILBOX_CALDAV_BASE = "https://dav.mailbox.org/";

/** Zugangsdaten – werden vom Store uebergeben (Passwort aus SecureStore). */
export interface Credentials {
  username: string;
  password: string;
}

const XML_CT = 'application/xml; charset="utf-8"';

// fast-xml-parser so konfigurieren, dass Namespace-Praefixe (d:, D:, cal:, ...)
// entfernt werden – Server unterscheiden sich hier, der Inhalt ist derselbe.
const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === "response", // <response> immer als Liste behandeln
});

interface DavResponse {
  status: number;
  text: string;
  etag: string | null;
}

/**
 * Schickt eine WebDAV-Anfrage direkt an den Server.
 * @param method   PROPFIND | REPORT | GET | PUT | DELETE
 * @param targetUrl absolute Ziel-URL auf dem CalDAV-Server
 */
export async function request(
  method: string,
  targetUrl: string,
  creds: Credentials,
  opts: { body?: string; depth?: string | number; contentType?: string; ifMatch?: string } = {}
): Promise<DavResponse> {
  const headers: Record<string, string> = {
    // Basic Auth: "benutzer:passwort" Base64-kodiert.
    Authorization: "Basic " + base64(`${creds.username}:${creds.password}`),
  };
  if (opts.depth != null) headers["Depth"] = String(opts.depth);
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers,
      body: opts.body || undefined,
    });
  } catch (err: any) {
    throw new Error(
      `Verbindung fehlgeschlagen (${err?.message ?? err}). ` +
      "Prüfe die Internetverbindung und ob dav.mailbox.org erreichbar ist."
    );
  }

  const text = await response.text();
  return {
    status: response.status,
    text,
    etag: response.headers.get("ETag"),
  };
}

/* -------------------------------------------------------------------------- */
/*  Discovery: Kalender des Kontos finden                                      */
/* -------------------------------------------------------------------------- */

/**
 * Findet die Kalender (Kategorien) des Kontos in drei Schritten:
 *   1. Wer ist angemeldet?            -> current-user-principal
 *   2. Wo liegen die Kalender?        -> calendar-home-set
 *   3. Welche Kalender gibt es dort?  -> PROPFIND Tiefe 1
 */
export async function discoverCalendars(creds: Credentials): Promise<Calendar[]> {
  const base = MAILBOX_CALDAV_BASE;
  const principalUrl = await findCurrentUserPrincipal(base, creds);
  const homeUrl = await findCalendarHome(principalUrl || base, creds);
  return await listCalendars(homeUrl || base, creds);
}

async function findCurrentUserPrincipal(base: string, creds: Credentials): Promise<string | null> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
  const res = await request("PROPFIND", base, creds, { depth: 0, contentType: XML_CT, body });
  if (res.status === 401) throw new Error("Anmeldung fehlgeschlagen – Benutzername/Passwort prüfen.");
  if (res.status >= 400) throw new Error(`Discovery fehlgeschlagen (HTTP ${res.status}).`);

  const doc = xml.parse(res.text);
  const href = firstResponse(doc)?.propstat?.prop?.["current-user-principal"]?.href;
  return href ? new URL(String(href).trim(), base).href : null;
}

async function findCalendarHome(principalUrl: string, creds: Credentials): Promise<string | null> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
  const res = await request("PROPFIND", principalUrl, creds, { depth: 0, contentType: XML_CT, body });
  if (res.status >= 400) throw new Error(`Kalender-Ordner nicht gefunden (HTTP ${res.status}).`);

  const doc = xml.parse(res.text);
  const href = firstResponse(doc)?.propstat?.prop?.["calendar-home-set"]?.href;
  return href ? new URL(String(href).trim(), principalUrl).href : null;
}

async function listCalendars(homeUrl: string, creds: Credentials): Promise<Calendar[]> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <cs:getctag/>
    <ic:calendar-color/>
  </d:prop>
</d:propfind>`;
  const res = await request("PROPFIND", homeUrl, creds, { depth: 1, contentType: XML_CT, body });
  if (res.status >= 400) throw new Error(`Kalenderliste fehlgeschlagen (HTTP ${res.status}).`);

  const doc = xml.parse(res.text);
  const responses = allResponses(doc);
  const calendars: Calendar[] = [];

  for (const resp of responses) {
    const propstats = Array.isArray(resp.propstat) ? resp.propstat : [resp.propstat];
    // Den propstat mit Status 200 nehmen (Server liefern oft auch 404-Bloecke).
    const prop = propstats.find((p: any) => String(p?.status || "").includes("200"))?.prop
      ?? propstats[0]?.prop;
    if (!prop) continue;

    // Ist diese Ressource ein Kalender? (resourcetype enthaelt <calendar/>)
    const isCalendar = prop.resourcetype && "calendar" in prop.resourcetype;
    if (!isCalendar) continue;

    const href = String(resp.href || "").trim();
    if (!href) continue;

    const url = new URL(href, homeUrl).href;
    const rawColor = prop["calendar-color"];
    const colorText = typeof rawColor === "object" ? rawColor?.["#text"] : rawColor;
    calendars.push({
      id: url, // URL dient als eindeutige id
      url,
      name: prop.displayname ? String(prop.displayname) : "Kalender",
      color: normalizeColor(colorText ? String(colorText).trim() : "") || stableColor(url),
      visible: true,
    });
  }
  return calendars;
}

/* -------------------------------------------------------------------------- */
/*  Termine laden / schreiben / loeschen                                       */
/* -------------------------------------------------------------------------- */

/**
 * Laedt alle Termine eines Kalenders per REPORT (calendar-query).
 * WICHTIG: Zeitbereich eingrenzen (1 Jahr zurueck bis 2 Jahre voraus), sonst
 * versucht der Server die KOMPLETTE Historie zu liefern -> Timeout/502.
 */
export async function fetchEvents(calendarUrl: string, calendarId: string, creds: Credentials): Promise<CalEvent[]> {
  const now = new Date();
  const rangeStart = icalUtc(new Date(now.getFullYear() - 1, 0, 1));
  const rangeEnd = icalUtc(new Date(now.getFullYear() + 2, 11, 31, 23, 59, 59));

  const reportBody = `<?xml version="1.0" encoding="utf-8" ?>
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

  const res = await request("REPORT", calendarUrl, creds, {
    depth: 1,
    contentType: XML_CT,
    body: reportBody,
  });
  if (res.status >= 400) {
    const detail = (res.text || "").trim().slice(0, 200);
    throw new Error(`REPORT fehlgeschlagen (HTTP ${res.status})${detail ? ": " + detail : ""}`);
  }

  const doc = xml.parse(res.text);
  const responses = allResponses(doc);
  const events: CalEvent[] = [];

  for (const resp of responses) {
    const propstats = Array.isArray(resp.propstat) ? resp.propstat : [resp.propstat];
    const prop = propstats.find((p: any) => String(p?.status || "").includes("200"))?.prop
      ?? propstats[0]?.prop;
    const calData = prop?.["calendar-data"];
    const icsText = typeof calData === "object" ? calData?.["#text"] : calData;
    if (!icsText) continue;

    const href = resp.href ? new URL(String(resp.href).trim(), calendarUrl).href : undefined;
    const etag = prop?.getetag ? String(prop.getetag) : undefined;

    for (const ev of parseICalendar(String(icsText), calendarId)) {
      ev.href = href;   // fuer spaeteres Aendern/Loeschen merken
      ev.etag = etag;
      events.push(ev);
    }
  }
  return events;
}

/**
 * Legt einen Termin an oder aendert ihn (PUT).
 * Der Nur-Lesen-Schutz wird VOR dem Aufruf im Store geprueft.
 */
export async function pushEvent(calendarUrl: string, event: CalEvent, creds: Credentials): Promise<{ href: string; etag: string | null }> {
  const ics = buildICalendar(event);
  const base = calendarUrl.endsWith("/") ? calendarUrl : calendarUrl + "/";
  const targetUrl = event.href || new URL(`${encodeURIComponent(event.uid)}.ics`, base).href;

  const res = await request("PUT", targetUrl, creds, {
    contentType: "text/calendar; charset=utf-8",
    ifMatch: event.etag,
    body: ics,
  });
  if (res.status >= 400) throw new Error(`Speichern fehlgeschlagen (HTTP ${res.status}).`);
  return { href: targetUrl, etag: res.etag };
}

/** Loescht einen Termin (DELETE). event.href muss gesetzt sein. */
export async function removeEvent(event: CalEvent, creds: Credentials): Promise<boolean> {
  if (!event.href) throw new Error("Termin hat keine Server-Adresse (href).");
  const res = await request("DELETE", event.href, creds, { ifMatch: event.etag });
  if (res.status >= 400 && res.status !== 404) {
    throw new Error(`Löschen fehlgeschlagen (HTTP ${res.status}).`);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Hilfen                                                                     */
/* -------------------------------------------------------------------------- */

/** Holt aus einer geparsten Multistatus-Antwort alle <response>-Eintraege. */
function allResponses(doc: any): any[] {
  const ms = doc?.multistatus;
  if (!ms) return [];
  const r = ms.response;
  return Array.isArray(r) ? r : r ? [r] : [];
}

function firstResponse(doc: any): any | null {
  return allResponses(doc)[0] ?? null;
}

/** Base64-Kodierung fuer Basic Auth (UTF-8-sicher, ohne Browser-btoa). */
function base64(input: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  // String zuerst als UTF-8-Bytes kodieren.
  const utf8 = unescape(encodeURIComponent(input));
  let out = "";
  for (let i = 0; i < utf8.length; i += 3) {
    const c1 = utf8.charCodeAt(i);
    const c2 = i + 1 < utf8.length ? utf8.charCodeAt(i + 1) : NaN;
    const c3 = i + 2 < utf8.length ? utf8.charCodeAt(i + 2) : NaN;
    out += chars.charAt(c1 >> 2);
    out += chars.charAt(((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4));
    out += isNaN(c2) ? "=" : chars.charAt(((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6));
    out += isNaN(c3) ? "=" : chars.charAt(c3 & 63);
  }
  return out;
}

/** Formatiert ein Date als iCal-UTC-Zeitstempel "YYYYMMDDTHHMMSSZ". */
function icalUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Normalisiert Farben wie "#RRGGBBAA" auf "#RRGGBB". */
function normalizeColor(c: string): string {
  if (!c) return "";
  const m = c.match(/^#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : c;
}

/** Stabile Farbe aus einem String (Fallback, falls Server keine liefert). */
function stableColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const palette = ["#2b6cb0", "#38a169", "#dd6b20", "#9b2c2c", "#6b46c1", "#0d9488", "#b7791f"];
  return palette[Math.abs(hash) % palette.length];
}
