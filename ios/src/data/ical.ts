/*
 * data/ical.ts  –  iCalendar (.ics) lesen und schreiben
 * ==========================================================================
 * Direkte Portierung von pwa/js/data/ical.js nach TypeScript.
 * mailbox.org liefert Termine ueber CalDAV im iCalendar-Format (RFC 5545).
 *
 * BEKANNTE GRENZEN (wie in der PWA):
 *   - Zeitzonen vereinfacht: Zeiten mit "Z" gelten als UTC, alle anderen als
 *     lokale Geraetezeit. Fuer mitteleuropaeische Kalender meist ausreichend.
 *   - RRULE: haeufige Faelle (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT,
 *     UNTIL, BYDAY woechentlich). Komplexere Regeln vereinfacht.
 */

import type { CalEvent } from "../types";

interface ParsedProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

type PropMap = Record<string, ParsedProp> & { __exdates?: ParsedProp[] };

/* -------------------------------------------------------------------------- */
/*  LESEN: iCalendar-Text -> CalEvent[]                                        */
/* -------------------------------------------------------------------------- */

/** Zerlegt einen kompletten .ics-Text in VEVENT-Bloecke und parst sie. */
export function parseICalendar(icsText: string, calendarId: string): CalEvent[] {
  const lines = unfoldLines(icsText);

  const events: CalEvent[] = [];
  let current: PropMap | null = null;
  let inAlarm = false; // VALARM-Bloecke ueberspringen (eigene DTSTART etc.)
  let alarmTriggers: ParsedProp[] = [];
  let alarmTrigger: ParsedProp | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      alarmTriggers = [];
    } else if (line === "END:VEVENT") {
      if (current) events.push(finishEvent(current, calendarId, alarmTriggers));
      current = null;
    } else if (line === "BEGIN:VALARM") {
      inAlarm = true;
      alarmTrigger = null;
    } else if (line === "END:VALARM") {
      inAlarm = false;
      // Rohen TRIGGER merken; die Umrechnung in "Minuten vorher" passiert in
      // finishEvent (dort ist der Beginn fuer absolute Trigger bekannt).
      if (alarmTrigger) alarmTriggers.push(alarmTrigger);
    } else if (current) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (inAlarm) {
        if (parsed.name === "TRIGGER") alarmTrigger = parsed;
        continue;
      }
      // EXDATE (ausgenommene Termine einer Serie) kann mehrfach vorkommen.
      if (parsed.name === "EXDATE") {
        (current.__exdates = current.__exdates || []).push(parsed);
      } else {
        current[parsed.name] = parsed;
      }
    }
  }
  return events;
}

/** Entfaltet (RFC 5545): Zeilen, die mit Leerzeichen/Tab beginnen, anhaengen. */
function unfoldLines(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && result.length) {
      result[result.length - 1] += raw.slice(1);
    } else {
      result.push(raw);
    }
  }
  return result;
}

/** Parst "DTSTART;TZID=Europe/Berlin:20260611T090000" in { name, params, value }. */
function parseLine(line: string): ParsedProp | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const [k, v] = parts[i].split("=");
    if (k) params[k.toUpperCase()] = v;
  }
  return { name, params, value };
}

/** Baut aus den gesammelten Properties ein fertiges CalEvent. */
function finishEvent(props: PropMap, calendarId: string, alarmTriggers: ParsedProp[]): CalEvent {
  const start = parseDate(props.DTSTART);
  const end = props.DTEND ? parseDate(props.DTEND) : null;
  const allDay = !!(props.DTSTART && props.DTSTART.params.VALUE === "DATE");

  // VALARM-Trigger in "Minuten vor Beginn" umrechnen (robust gegen alle
  // ueblichen Schreibweisen: -PT30M, -PT1H, -P1D, -P1W, absolute DATE-TIME …).
  const reminders = alarmTriggers
    .map((t) => triggerToMinutes(t, start))
    .filter((m): m is number => m !== null);

  const exdates = (props.__exdates || [])
    .map((p) => parseDate(p))
    .filter((d): d is Date => !!d)
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
    reminders,
    rrule: props.RRULE ? props.RRULE.value : null,
    exdates,
    // SEQUENCE (Revisionsnummer) merken – wird beim Zurueckschreiben gebraucht
    // (Open-Xchange-Konfliktpruefung, siehe types.ts).
    sequence: props.SEQUENCE ? (parseInt(props.SEQUENCE.value, 10) || 0) : 0,
  };
}

/** Wandelt einen iCalendar-Datumswert in ein Date. */
function parseDate(prop: ParsedProp | undefined | null): Date | null {
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

/**
 * Rechnet einen VALARM-TRIGGER in "Minuten vor Beginn" um.
 *   - Relative Dauer (RFC 5545): "-PT30M", "-PT1H", "-PT1H30M", "-P1D",
 *     "-P1W", "-P1DT12H", "PT0S" (= zum Termin). Negatives Vorzeichen = vorher.
 *   - Absolut: TRIGGER;VALUE=DATE-TIME:20260616T080000Z -> Differenz zum Beginn.
 * Liefert null, wenn der Trigger nicht gelesen werden kann.
 */
function triggerToMinutes(prop: ParsedProp, start: Date | null): number | null {
  const raw = (prop.value || "").trim();
  if (!raw) return null;

  // Absoluter Zeitpunkt (DATE-TIME) -> Differenz zum Beginn in Minuten.
  const isDateTime = prop.params.VALUE === "DATE-TIME" || /^\d{8}T\d{6}Z?$/.test(raw);
  if (isDateTime) {
    const at = parseDate(prop);
    if (!at || !start) return null;
    return Math.max(0, Math.round((start.getTime() - at.getTime()) / 60000));
  }

  // Relative ISO-8601-Dauer: [+-]P[nW][nD]T[nH][nM][nS]
  const m = raw.toUpperCase().match(
    /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!m) return null;
  const sign = m[1];
  const total =
    (parseInt(m[2] || "0", 10) * 7 * 24 * 60) + // Wochen
    (parseInt(m[3] || "0", 10) * 24 * 60) +     // Tage
    (parseInt(m[4] || "0", 10) * 60) +          // Stunden
    parseInt(m[5] || "0", 10) +                 // Minuten
    Math.round(parseInt(m[6] || "0", 10) / 60); // Sekunden
  // Erinnerungen liegen VOR dem Termin (negatives Vorzeichen). Ein Trigger
  // NACH dem Beginn (positiv) wird als "zum Termin" (0) behandelt.
  return sign === "-" ? total : 0;
}

/** Macht iCalendar-Escapes rueckgaengig. */
function unescapeText(s: string): string {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/* -------------------------------------------------------------------------- */
/*  SCHREIBEN: CalEvent -> iCalendar-Text                                       */
/* -------------------------------------------------------------------------- */

/** Serialisiert ein CalEvent als VCALENDAR mit einem VEVENT (fuer PUT). */
export function buildICalendar(event: CalEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Calendar iOS//DE",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    // SEQUENCE + LAST-MODIFIED: Open-Xchange (mailbox.org) erkennt Aenderungen
    // hieran. Ohne (bzw. mit zu niedriger) SEQUENCE lehnt OX das Update mit
    // HTTP 412 CAL-4121 ab. Der Wert wird vor dem Schreiben hochgezaehlt
    // (siehe pushEventToServer in store/useStore.ts).
    `SEQUENCE:${event.sequence ?? 0}`,
    `LAST-MODIFIED:${formatUtc(new Date())}`,
    formatDateProp("DTSTART", event.start, event.allDay),
    formatDateProp("DTEND", event.end, event.allDay),
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  if (event.rrule) lines.push(`RRULE:${event.rrule}`);

  // Ausgenommene Vorkommen einer Serie (EXDATE) mitschreiben, damit der
  // Server (und andere Apps) sie ebenfalls auslassen.
  // WICHTIG: NUR wenn es auch eine RRULE gibt – ein EXDATE ohne RRULE ist
  // ungueltiges iCalendar und wird vom Server mit HTTP 412
  // (valid-calendar-data) abgelehnt. Das passiert z.B., wenn eine Serie zu
  // einem Einzeltermin geaendert wird, aber alte EXDATEs am Termin haengen.
  if (event.rrule) for (const key of event.exdates || []) {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) continue;
    if (event.allDay) {
      lines.push(`EXDATE;VALUE=DATE:${String(y)}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`);
    } else {
      // Uhrzeit des Serienbeginns verwenden (gleicher Typ wie DTSTART = UTC).
      const base = new Date(event.start);
      lines.push(`EXDATE:${formatUtc(new Date(y, m - 1, d, base.getHours(), base.getMinutes(), 0))}`);
    }
  }

  for (const minutes of event.reminders || []) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.title)}`,
      `TRIGGER:-PT${minutes}M`, "END:VALARM");
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function formatDateProp(name: string, iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${name};VALUE=DATE:${y}${m}${day}`;
  }
  return `${name}:${formatUtc(d)}`;
}

function formatUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function escapeText(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/* -------------------------------------------------------------------------- */
/*  SERIENTERMINE (RRULE): parsen, bauen, aufloesen                            */
/* -------------------------------------------------------------------------- */
/*
 * Unterstuetzte Regeln (deckt die Einstellungen im Termin-Editor ab):
 *   - FREQ DAILY/WEEKLY/MONTHLY/YEARLY mit INTERVAL ("alle 2 Wochen")
 *   - BYDAY woechentlich: mehrere Wochentage ("jeden Mo, Mi, Fr")
 *   - BYDAY monatlich MIT Ordinal: "jeder 2. Donnerstag" (BYDAY=2TH),
 *     "letzter Freitag" (BYDAY=-1FR)
 *   - Ende: COUNT ("nach 10 Terminen") oder UNTIL ("bis 31.12.2026")
 */

const DAY = 24 * 60 * 60 * 1000;

/** Reihenfolge Montag..Sonntag – passt zu WEEKDAYS_SHORT in utils/dates. */
export const BYDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** Ein BYDAY-Eintrag: ord=0 heisst "jeder", ord=2 "der zweite", ord=-1 "der letzte". */
export interface BydayEntry {
  ord: number;
  day: string; // "MO".."SU"
}

/** Strukturierte Form einer RRULE – Grundlage fuer Editor und Aufloesung. */
export interface RruleOptions {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;        // >= 1
  count: number | null;    // Ende nach N Terminen (oder null)
  until: Date | null;      // Ende an Datum (oder null) – inklusive
  byday: BydayEntry[];     // Wochentage (woechentlich) bzw. N-ter Wochentag (monatlich)
}

/** Zerlegt eine RRULE-Zeichenkette. Liefert null bei fehlender/unbekannter FREQ. */
export function parseRruleOptions(str: string | null | undefined): RruleOptions | null {
  if (!str) return null;
  const rule: RruleOptions = { freq: "DAILY", interval: 1, count: null, until: null, byday: [] };
  let hasFreq = false;
  for (const part of str.split(";")) {
    const [kRaw, v] = part.split("=");
    if (!v) continue;
    const k = kRaw.toUpperCase();
    if (k === "FREQ") {
      const f = v.toUpperCase();
      if (f === "DAILY" || f === "WEEKLY" || f === "MONTHLY" || f === "YEARLY") {
        rule.freq = f;
        hasFreq = true;
      }
    } else if (k === "INTERVAL") {
      rule.interval = Math.max(1, parseInt(v, 10) || 1);
    } else if (k === "COUNT") {
      rule.count = parseInt(v, 10) || null;
    } else if (k === "UNTIL") {
      rule.until = parseDate({ name: "UNTIL", value: v, params: {} });
    } else if (k === "BYDAY") {
      rule.byday = v.split(",")
        .map(parseBydayEntry)
        .filter((b): b is BydayEntry => b !== null);
    }
  }
  return hasFreq ? rule : null;
}

/** "2TH" -> {ord:2, day:"TH"};  "MO" -> {ord:0, day:"MO"};  "-1FR" -> {ord:-1,...} */
function parseBydayEntry(s: string): BydayEntry | null {
  const m = s.trim().toUpperCase().match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/);
  if (!m) return null;
  return { ord: m[1] ? parseInt(m[1], 10) : 0, day: m[2] };
}

/** Baut aus den Optionen wieder eine RRULE-Zeichenkette (fuer iCalendar/CalDAV). */
export function buildRrule(opts: RruleOptions): string {
  const parts = [`FREQ=${opts.freq}`];
  if (opts.interval > 1) parts.push(`INTERVAL=${opts.interval}`);
  if (opts.byday.length) {
    parts.push(`BYDAY=${opts.byday.map((b) => (b.ord ? String(b.ord) : "") + b.day).join(",")}`);
  }
  if (opts.count) {
    parts.push(`COUNT=${opts.count}`);
  } else if (opts.until) {
    // UNTIL inklusive: Ende des gewaehlten Tages (lokal) als UTC-Zeitstempel.
    const u = opts.until;
    const endOfDay = new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59);
    parts.push(`UNTIL=${formatUtc(endOfDay)}`);
  }
  return parts.join(";");
}

/** Loest alle Serientermine innerhalb [windowStart, windowEnd] auf. */
export function expandRecurring(events: CalEvent[], windowStart: Date, windowEnd: Date): CalEvent[] {
  const out: CalEvent[] = [];
  for (const ev of events) {
    if (!ev.rrule) { out.push(ev); continue; }
    const occurrences = expandOne(ev, windowStart, windowEnd);
    // Falls die Aufloesung nichts ergibt (z.B. unbekannte Regel), Original behalten.
    if (occurrences.length) out.push(...occurrences);
    else out.push(ev);
  }
  return out;
}

/** Erzeugt die einzelnen Vorkommen eines Serientermins im Zeitfenster. */
function expandOne(ev: CalEvent, windowStart: Date, windowEnd: Date): CalEvent[] {
  const rule = parseRruleOptions(ev.rrule);
  if (!rule) return [];

  const baseStart = new Date(ev.start);
  const baseEnd = new Date(ev.end);
  const duration = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const exset = new Set(ev.exdates || []);
  const hardEnd = rule.until && rule.until < windowEnd ? rule.until : windowEnd;

  const results: CalEvent[] = [];
  let produced = 0; // Anzahl erzeugter Vorkommen (fuer COUNT)
  let iterations = 0;
  const MAX_ITER = 2000;

  // Der Cursor markiert die aktuelle "Periode" (Tag/Woche/Monat/Jahr).
  // Bei MONTHLY zeigt er auf den Monatsersten, damit beim Weiterschalten
  // nichts verrutscht (setMonth auf den 31. wuerde sonst ueberlaufen).
  let cursor: Date = rule.freq === "MONTHLY"
    ? new Date(baseStart.getFullYear(), baseStart.getMonth(), 1)
    : new Date(baseStart);

  // Schnellvorlauf bei taeglichen/woechentlichen Serien ohne COUNT,
  // damit wir nicht jahrelang in Einzelschritten iterieren muessen.
  if (!rule.count && (rule.freq === "DAILY" || rule.freq === "WEEKLY") && cursor < windowStart) {
    const stepDays = (rule.freq === "DAILY" ? 1 : 7) * rule.interval;
    const jumps = Math.max(0, Math.floor((windowStart.getTime() - cursor.getTime()) / DAY / stepDays) - 1);
    cursor = new Date(cursor.getTime() + jumps * stepDays * DAY);
  }

  while (iterations++ < MAX_ITER) {
    if (cursor > hardEnd) break;
    if (rule.count && produced >= rule.count) break;

    // Kandidaten dieser Periode bestimmen (aufsteigend sortiert).
    const candidates = candidatesForPeriod(cursor, rule, baseStart);

    for (const c of candidates) {
      if (c < baseStart) continue; // vor dem ersten Termin
      if (rule.until && c > rule.until) continue;
      if (rule.count && produced >= rule.count) break;
      produced++; // zaehlt auch Vorkommen vor dem Anzeigefenster (COUNT-Logik)
      if (c >= windowStart && c <= windowEnd && !exset.has(localDayKey(c))) {
        results.push({
          ...ev,
          uid: `${ev.uid}__${localDayKey(c)}`, // eindeutige id je Vorkommen
          start: c.toISOString(),
          end: new Date(c.getTime() + duration).toISOString(),
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

/** Liefert die konkreten Termin-Daten innerhalb der Periode des Cursors. */
function candidatesForPeriod(cursor: Date, rule: RruleOptions, baseStart: Date): Date[] {
  if (rule.freq === "WEEKLY" && rule.byday.length) {
    return weeklyByday(cursor, rule.byday, baseStart);
  }
  if (rule.freq === "MONTHLY" && rule.byday.length) {
    return monthlyByday(cursor, rule.byday, baseStart);
  }
  if (rule.freq === "MONTHLY") {
    return monthlySameDay(cursor, baseStart);
  }
  return [new Date(cursor)];
}

/** Woechentlich mit BYDAY: die gewaehlten Wochentage der Cursor-Woche. */
function weeklyByday(anyDayInWeek: Date, byday: BydayEntry[], baseStart: Date): Date[] {
  // Montag dieser Woche bestimmen.
  const monday = new Date(anyDayInWeek);
  const mondayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - mondayOffset);

  const idx: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
  return byday
    .filter((b) => b.day in idx)
    .map((b) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + idx[b.day]);
      date.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);
      return date;
    })
    .sort((a, b) => a.getTime() - b.getTime());
}

/** Monatlich mit BYDAY-Ordinal: "2. Donnerstag", "letzter Freitag" usw. */
function monthlyByday(firstOfMonth: Date, byday: BydayEntry[], baseStart: Date): Date[] {
  const year = firstOfMonth.getFullYear();
  const month = firstOfMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const idx: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 }; // getDay()-Werte

  const out: Date[] = [];
  for (const b of byday) {
    if (!(b.day in idx)) continue;
    const targetDow = idx[b.day];

    if (b.ord > 0) {
      // N-ter Wochentag von vorne: 1. passenden Tag finden, dann (N-1) Wochen weiter.
      const firstDow = new Date(year, month, 1).getDay();
      const dayNum = 1 + ((targetDow - firstDow + 7) % 7) + (b.ord - 1) * 7;
      if (dayNum <= daysInMonth) out.push(makeDay(year, month, dayNum, baseStart));
    } else if (b.ord < 0) {
      // N-ter Wochentag von hinten (-1 = letzter).
      const lastDow = new Date(year, month, daysInMonth).getDay();
      const dayNum = daysInMonth - ((lastDow - targetDow + 7) % 7) - (Math.abs(b.ord) - 1) * 7;
      if (dayNum >= 1) out.push(makeDay(year, month, dayNum, baseStart));
    } else {
      // Ohne Ordinal: jeder passende Wochentag im Monat (selten, aber gueltig).
      for (let d = 1; d <= daysInMonth; d++) {
        if (new Date(year, month, d).getDay() === targetDow) out.push(makeDay(year, month, d, baseStart));
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Monatlich ohne BYDAY: derselbe Monatstag wie der erste Termin. */
function monthlySameDay(firstOfMonth: Date, baseStart: Date): Date[] {
  const dayNum = baseStart.getDate();
  const d = makeDay(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), dayNum, baseStart);
  // Monat zu kurz (z.B. 31. im Februar)? Dann faellt das Vorkommen aus.
  return d.getDate() === dayNum ? [d] : [];
}

/** Baut ein Date am gegebenen Tag mit der Uhrzeit des Originaltermins. */
function makeDay(year: number, month: number, day: number, baseStart: Date): Date {
  return new Date(year, month, day, baseStart.getHours(), baseStart.getMinutes(), 0, 0);
}

/** Naechste Periode je nach Frequenz. */
function stepNext(date: Date, freq: string, interval: number): Date {
  const d = new Date(date);
  if (freq === "DAILY") d.setDate(d.getDate() + interval);
  else if (freq === "WEEKLY") d.setDate(d.getDate() + 7 * interval);
  else if (freq === "MONTHLY") d.setMonth(d.getMonth() + interval); // Cursor ist der 1. -> kein Ueberlauf
  else if (freq === "YEARLY") d.setFullYear(d.getFullYear() + interval);
  else d.setDate(d.getDate() + 1);
  return d;
}

/** Tagesschluessel "YYYY-MM-DD" in lokaler Zeit (fuer EXDATE-Abgleich). */
function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
