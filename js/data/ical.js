/*
 * data/ical.js  –  iCalendar (.ics) lesen und schreiben
 * ==========================================================================
 * mailbox.org liefert Termine ueber CalDAV im iCalendar-Format aus. Diese
 * Datei wandelt zwischen iCalendar-Text und unseren CalEvent-Objekten um.
 *
 * Umfang: ein praxistauglicher Ausschnitt des Standards (RFC 5545) – genug
 * fuer einzelne VEVENTs mit Anfang/Ende, Titel, Ort, Notiz.
 *
 * BEKANNTE GRENZEN (bewusst, fuer den ersten Wurf):
 *   - Zeitzonen (TZID/VTIMEZONE) werden vereinfacht behandelt: Zeiten mit
 *     "Z" gelten als UTC, alle anderen als lokale Geraetezeit. Fuer die meisten
 *     mitteleuropaeischen Kalender ist das ausreichend; volle TZ-Unterstuetzung
 *     waere ein spaeterer Ausbau.
 *   - Wiederkehrende Termine (RRULE) werden noch NICHT aufgeloest.
 */

/* -------------------------------------------------------------------------- */
/*  LESEN: iCalendar-Text -> CalEvent[]                                        */
/* -------------------------------------------------------------------------- */

/**
 * Zerlegt einen kompletten .ics-Text in einzelne VEVENT-Bloecke und parst sie.
 * @param {string} icsText
 * @param {string} calendarId  zu welchem lokalen Kalender die Termine gehoeren
 * @returns {CalEvent[]}
 */
export function parseICalendar(icsText, calendarId) {
  // Gefaltete Zeilen entfalten: Fortsetzungszeilen beginnen mit Leer/Tab.
  const lines = unfoldLines(icsText);

  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT") {
      if (current) events.push(finishEvent(current, calendarId));
      current = null;
    } else if (current) {
      const parsed = parseLine(line);
      if (parsed) current[parsed.name] = parsed;
    }
  }
  return events;
}

/** Entfaltet (RFC 5545): Zeilen, die mit Leerzeichen/Tab beginnen, anhaengen. */
function unfoldLines(text) {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const result = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && result.length) {
      result[result.length - 1] += raw.slice(1);
    } else {
      result.push(raw);
    }
  }
  return result;
}

/**
 * Parst eine einzelne Eigenschaftszeile, z.B.:
 *   "DTSTART;TZID=Europe/Berlin:20260611T090000"
 * in { name, params, value }.
 */
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const left = line.slice(0, colon); // "DTSTART;TZID=Europe/Berlin"
  const value = line.slice(colon + 1);

  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const [k, v] = parts[i].split("=");
    if (k) params[k.toUpperCase()] = v;
  }
  return { name, params, value };
}

/** Baut aus den gesammelten Properties ein fertiges CalEvent. */
function finishEvent(props, calendarId) {
  const start = parseDate(props.DTSTART);
  const end = props.DTEND ? parseDate(props.DTEND) : null;
  const allDay = !!(props.DTSTART && props.DTSTART.params.VALUE === "DATE");

  return {
    uid: props.UID ? props.UID.value : `imp-${Math.random().toString(36).slice(2)}`,
    calendarId,
    title: props.SUMMARY ? unescapeText(props.SUMMARY.value) : "(ohne Titel)",
    allDay,
    start: start ? start.toISOString() : new Date().toISOString(),
    end: end ? end.toISOString() : (start ? start.toISOString() : new Date().toISOString()),
    location: props.LOCATION ? unescapeText(props.LOCATION.value) : "",
    notes: props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value) : "",
    reminders: [],
    // Felder fuer den Sync (damit wir spaeter aktualisieren/loeschen koennen):
    etag: props["X-ETAG"] ? props["X-ETAG"].value : undefined,
  };
}

/** Wandelt einen iCalendar-Datumswert in ein Date. */
function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value;

  // Reines Datum: "20260611"
  if (/^\d{8}$/.test(v)) {
    const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
    return new Date(y, m - 1, d);
  }

  // Datum + Uhrzeit: "20260611T090000" optional mit "Z" (UTC).
  const match = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (match) {
    const [, y, mo, d, h, mi, s, z] = match;
    if (z === "Z") {
      return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    }
    // Ohne "Z": als lokale Zeit interpretieren (vereinfachte TZ-Behandlung).
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }
  return null;
}

/** Macht iCalendar-Escapes rueckgaengig (\\n, \\, \, , \;). */
function unescapeText(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/* -------------------------------------------------------------------------- */
/*  SCHREIBEN: CalEvent -> iCalendar-Text                                       */
/* -------------------------------------------------------------------------- */

/**
 * Serialisiert ein CalEvent als vollstaendiges VCALENDAR mit einem VEVENT.
 * Das ist das Format, das beim Anlegen/Aendern an den Server (PUT) geht.
 * @param {CalEvent} event
 * @returns {string}
 */
export function buildICalendar(event) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Calendar PWA//DE",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    formatDateProp("DTSTART", event.start, event.allDay),
    formatDateProp("DTEND", event.end, event.allDay),
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);

  // Erinnerung als VALARM (Anzeige) hinzufuegen.
  for (const minutes of event.reminders || []) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.title)}`,
      `TRIGGER:-PT${minutes}M`, "END:VALARM");
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** Baut eine DTSTART/DTEND-Zeile, je nachdem ob Ganztag oder mit Uhrzeit. */
function formatDateProp(name, iso, allDay) {
  const d = new Date(iso);
  if (allDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${name};VALUE=DATE:${y}${m}${day}`;
  }
  return `${name}:${formatUtc(d)}`;
}

/** Formatiert ein Date als UTC-Zeitstempel "YYYYMMDDTHHMMSSZ". */
function formatUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Escaped Sonderzeichen fuer iCalendar-Textwerte. */
function escapeText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
