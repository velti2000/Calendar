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
      if (parsed) {
        // EXDATE (ausgenommene Termine einer Serie) kann mehrfach vorkommen.
        if (parsed.name === "EXDATE") {
          (current.__exdates = current.__exdates || []).push(parsed);
        } else {
          current[parsed.name] = parsed;
        }
      }
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

  // Ausgenommene Termine (EXDATE) als Menge von Tagesschluesseln merken.
  const exdates = (props.__exdates || [])
    .map((p) => parseDate(p))
    .filter(Boolean)
    .map((d) => localDayKey(d));

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
    // Serientermin-Regel (RRULE) als Rohtext – wird spaeter aufgeloest.
    rrule: props.RRULE ? props.RRULE.value : null,
    exdates,
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

  // Wiederholungsregel (Serientermin) – z.B. "FREQ=WEEKLY".
  if (event.rrule) lines.push(`RRULE:${event.rrule}`);

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

/* -------------------------------------------------------------------------- */
/*  SERIENTERMINE (RRULE) aufloesen                                            */
/* -------------------------------------------------------------------------- */
/*
 * mailbox.org liefert wiederkehrende Termine (z.B. Geburtstage = jaehrlich,
 * woechentliche Meetings ...) als EINEN Eintrag mit einer Wiederholungsregel
 * (RRULE). Diese Funktion erzeugt daraus die einzelnen Vorkommen innerhalb
 * eines Zeitfensters, damit sie im Kalender erscheinen.
 *
 * Unterstuetzt die haeufigen Faelle: FREQ DAILY/WEEKLY/MONTHLY/YEARLY,
 * INTERVAL, COUNT, UNTIL, BYDAY (woechentlich). Komplexere Regeln (z.B.
 * "letzter Freitag im Monat") werden vereinfacht behandelt.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * Loest alle Serientermine in der Liste innerhalb [windowStart, windowEnd] auf.
 * Nicht-wiederkehrende Termine bleiben unveraendert.
 * @param {CalEvent[]} events
 * @param {Date} windowStart
 * @param {Date} windowEnd
 * @returns {CalEvent[]}
 */
export function expandRecurring(events, windowStart, windowEnd) {
  const out = [];
  for (const ev of events) {
    if (!ev.rrule) { out.push(ev); continue; }
    const occurrences = expandOne(ev, windowStart, windowEnd);
    // Falls die Aufloesung nichts ergibt (z.B. unbekannte Regel), Original behalten.
    if (occurrences.length) out.push(...occurrences);
    else out.push(ev);
  }
  return out;
}

/** Zerlegt eine RRULE-Zeichenkette in ein Objekt. */
function parseRrule(str) {
  const rule = { freq: null, interval: 1, count: null, until: null, byday: [] };
  for (const part of str.split(";")) {
    const [kRaw, v] = part.split("=");
    if (!v) continue;
    const k = kRaw.toUpperCase();
    if (k === "FREQ") rule.freq = v.toUpperCase();
    else if (k === "INTERVAL") rule.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === "COUNT") rule.count = parseInt(v, 10) || null;
    else if (k === "UNTIL") rule.until = parseDate({ value: v, params: {} });
    else if (k === "BYDAY") rule.byday = v.split(",").map((d) => d.trim().slice(-2).toUpperCase());
  }
  return rule;
}

/** Erzeugt die einzelnen Vorkommen eines Serientermins im Zeitfenster. */
function expandOne(ev, windowStart, windowEnd) {
  const rule = parseRrule(ev.rrule);
  if (!rule.freq) return [];

  const baseStart = new Date(ev.start);
  const baseEnd = new Date(ev.end);
  const duration = Math.max(0, baseEnd - baseStart);
  const exset = new Set(ev.exdates || []);
  const hardEnd = rule.until && rule.until < windowEnd ? rule.until : windowEnd;

  const results = [];
  let cursor = new Date(baseStart);
  let produced = 0; // Anzahl erzeugter Vorkommen (fuer COUNT)
  let iterations = 0;
  const MAX_ITER = 1500;

  // Schnellvorlauf bei taeglichen/woechentlichen Serien ohne COUNT,
  // damit wir nicht jahrelang in Einzelschritten iterieren muessen.
  if (!rule.count && (rule.freq === "DAILY" || rule.freq === "WEEKLY") && cursor < windowStart) {
    const stepDays = (rule.freq === "DAILY" ? 1 : 7) * rule.interval;
    const jumps = Math.max(0, Math.floor((windowStart - cursor) / DAY / stepDays) - 1);
    cursor = new Date(cursor.getTime() + jumps * stepDays * DAY);
  }

  while (iterations++ < MAX_ITER) {
    if (cursor > hardEnd) break;
    if (rule.count && produced >= rule.count) break;

    // Bei woechentlichen Serien mit BYDAY mehrere Wochentage pro Woche.
    const candidates = (rule.freq === "WEEKLY" && rule.byday.length)
      ? bydayCandidates(cursor, rule.byday)
      : [new Date(cursor)];

    for (const c of candidates) {
      if (c < baseStart) continue;
      if (rule.until && c > rule.until) continue;
      if (rule.count && produced >= rule.count) break;
      produced++;
      if (c >= windowStart && c <= windowEnd && !exset.has(localDayKey(c))) {
        const s = new Date(c);
        results.push({
          ...ev,
          uid: `${ev.uid}__${localDayKey(c)}`, // eindeutige id je Vorkommen
          start: s.toISOString(),
          end: new Date(s.getTime() + duration).toISOString(),
          rrule: null,
          recurringMaster: ev.uid,
          // Vorkommen werden NICHT einzeln auf den Server geschrieben:
          href: undefined,
          etag: undefined,
        });
      }
    }

    cursor = stepNext(cursor, rule.freq, rule.interval);
    if (results.length > 1000) break; // Sicherheitskappe
  }
  return results;
}

/** Liefert die konkreten Wochentags-Daten einer Woche fuer BYDAY. */
function bydayCandidates(anyDayInWeek, bydays) {
  // Montag dieser Woche bestimmen.
  const monday = new Date(anyDayInWeek);
  const mondayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - mondayOffset);
  const map = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
  return bydays
    .filter((d) => d in map)
    .map((d) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + map[d]);
      // Uhrzeit des Originals beibehalten.
      date.setHours(anyDayInWeek.getHours(), anyDayInWeek.getMinutes(), 0, 0);
      return date;
    });
}

/** Naechster Serien-Schritt je nach Frequenz. */
function stepNext(date, freq, interval) {
  const d = new Date(date);
  if (freq === "DAILY") d.setDate(d.getDate() + interval);
  else if (freq === "WEEKLY") d.setDate(d.getDate() + 7 * interval);
  else if (freq === "MONTHLY") d.setMonth(d.getMonth() + interval);
  else if (freq === "YEARLY") d.setFullYear(d.getFullYear() + interval);
  else d.setDate(d.getDate() + 1);
  return d;
}

/** Tagesschluessel "YYYY-MM-DD" in lokaler Zeit (fuer EXDATE-Abgleich). */
function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
