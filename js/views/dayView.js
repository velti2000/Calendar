/*
 * views/dayView.js  –  Tagesansicht mit Stundenraster
 * ==========================================================================
 * Zeigt den kompletten Tag von oben (00:00) nach unten (24:00). Zeit-Termine
 * werden als Bloecke an ihrer Uhrzeit und in ihrer Dauer dargestellt.
 * Parallele (sich ueberschneidende) Termine erscheinen nebeneinander in Spalten.
 * Ganztagestermine stehen in einer eigenen Reihe oben drueber.
 *
 * Tippen auf einen Termin oeffnet ihn zum Bearbeiten. Tippen auf eine freie
 * Stelle im Raster legt einen neuen Termin zur dortigen Uhrzeit an. Der "+"-Knopf
 * legt einen Termin (Standard 8:00) an.
 */

import { el, bar3 } from "../utils/dom.js";
import {
  formatLongDate, formatTime, dayKey, addDays, isToday,
  WEEKDAYS_LONG, mondayIndex,
} from "../utils/dates.js";
import { getEventsByDay, getCalendar } from "../store.js";
import { openDatePicker } from "./datePicker.js";

// Hoehe einer Stunde im Raster (px). 24 Stunden ergeben die Gesamthoehe.
const HOUR_H = 46;
// Mindesthoehe eines Termin-Blocks, damit auch kurze Termine lesbar sind.
const MIN_BLOCK_H = 22;
// Linker Rand fuer die Uhrzeit-Beschriftung.
const GUTTER = 48;

/**
 * Berechnet fuer eine Menge von Zeit-Terminen die Spalten-Aufteilung, damit
 * sich ueberschneidende Termine nebeneinander dargestellt werden koennen.
 * Versieht jeden Termin mit ._col (Spaltenindex) und ._cols (Spaltenanzahl).
 */
function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let i = 0;
  while (i < sorted.length) {
    // Eine "Gruppe" sich (transitiv) ueberschneidender Termine bilden.
    let groupEnd = sorted[i].endMin;
    const group = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMin < groupEnd) {
      group.push(sorted[j]);
      groupEnd = Math.max(groupEnd, sorted[j].endMin);
      j++;
    }
    // Innerhalb der Gruppe jedem Termin die erste freie Spalte geben.
    const colEnds = []; // Endzeit je Spalte
    for (const ev of group) {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (ev.startMin >= colEnds[c]) { ev._col = c; colEnds[c] = ev.endMin; placed = true; break; }
      }
      if (!placed) { ev._col = colEnds.length; colEnds.push(ev.endMin); }
    }
    for (const ev of group) ev._cols = colEnds.length;
    i = j;
  }
  return sorted;
}

/**
 * Erzeugt Kopfzeile und Hauptbereich der Tagesansicht.
 * @param {object} ctx
 * @returns {{ topBar: Node, navBar: Node, main: Node }}
 */
export function renderDayView(ctx) {
  const date = ctx.refDate;
  const events = getEventsByDay().get(dayKey(date)) || [];
  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  /* ----- Obere Leiste: Zurueck zum Monat · Wochentag+Datum · Sync ----- */
  const topBar = bar3(
    el("button", { class: "icon-btn big-gear", title: "Zurück zum Monat", text: "‹",
      on: { click: () => ctx.goToMonth(date) } }),
    el("div", { class: "bar-title" }, [
      WEEKDAYS_LONG[mondayIndex(date)],
      el("span", { class: "subtitle", text: ` ${date.getDate()}.${date.getMonth() + 1}.` }),
    ]),
    el("button", { class: "icon-btn sync-btn", title: "Synchronisieren", text: "⟳",
      on: { click: () => ctx.doSync() } }),
  );

  /* ----- Untere Leiste: Suche · ‹ • › · Datum-Sprung ----- */
  const navBar = bar3(
    el("button", { class: "icon-btn", title: "Suchen", text: "🔍",
      on: { click: () => ctx.openSearch() } }),
    el("div", { class: "nav-group" }, [
      el("button", { class: "icon-btn nav-arrow", title: "Voriger Tag", text: "‹",
        on: { click: () => ctx.goToDay(addDays(date, -1)) } }),
      el("button", { class: "icon-btn nav-today", title: "Heute", text: "•",
        on: { click: () => ctx.goToDay(new Date()) } }),
      el("button", { class: "icon-btn nav-arrow", title: "Nächster Tag", text: "›",
        on: { click: () => ctx.goToDay(addDays(date, 1)) } }),
    ]),
    el("button", { class: "icon-btn jump-btn", title: "Zu Datum springen", text: "››",
      on: { click: () => openDatePicker(date, (d) => ctx.goToDay(d)) } }),
  );

  /* ----- Scroll-Container ----- */
  const content = el("div", { class: "day-view" });

  // Datumskopf
  content.appendChild(el("div", { class: "day-view-header" }, [
    el("div", { class: "weekday", text: isToday(date) ? "Heute" : WEEKDAYS_LONG[mondayIndex(date)] }),
    el("div", { class: "bigdate", text: formatLongDate(date) }),
  ]));

  // Ganztags-Reihe oben
  if (allDayEvents.length) {
    const strip = el("div", { class: "allday-strip" },
      allDayEvents.map((ev) => {
        const cal = getCalendar(ev.calendarId);
        return el("div", {
          class: "allday-chip",
          style: { "--cat-color": cal ? cal.color : "var(--color-accent)" },
          title: ev.title,
          on: { click: () => ctx.openEditor(ev) },
        }, [ev.title]);
      })
    );
    content.appendChild(strip);
  }

  /* ----- Stundenraster ----- */
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const minutesIntoDay = (d) => (d.getTime() - dayStart.getTime()) / 60000;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Termine fuer die Anzeige vorbereiten (auf den Tag zuschneiden).
  const blocks = timedEvents.map((ev) => {
    const startMin = clamp(minutesIntoDay(new Date(ev.start)), 0, 1440);
    let endMin = clamp(minutesIntoDay(new Date(ev.end)), 0, 1440);
    if (endMin <= startMin) endMin = startMin + 30;
    return { ev, startMin, endMin };
  });
  layoutColumns(blocks);

  const timeline = el("div", { class: "timeline", style: { height: `${24 * HOUR_H}px` } });

  // Stundenlinien + Beschriftungen
  for (let h = 0; h <= 24; h++) {
    timeline.appendChild(el("div", { class: "hour-line", style: { top: `${h * HOUR_H}px` } }));
    if (h < 24) {
      timeline.appendChild(el("div", { class: "hour-label", style: { top: `${h * HOUR_H}px` },
        text: `${String(h).padStart(2, "0")}:00` }));
    }
  }

  // Termin-Bloecke
  const eventsLayer = el("div", { class: "timeline-events" });
  for (const b of blocks) {
    const cal = getCalendar(b.ev.calendarId);
    const color = cal ? cal.color : "var(--color-accent)";
    const top = (b.startMin / 60) * HOUR_H;
    const height = Math.max(MIN_BLOCK_H, ((b.endMin - b.startMin) / 60) * HOUR_H - 2);
    const widthPct = 100 / b._cols;
    const leftPct = b._col * widthPct;

    eventsLayer.appendChild(el("div", {
      class: "tev",
      style: {
        "--cat-color": color,
        top: `${top}px`,
        height: `${height}px`,
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 3px)`,
      },
      on: { click: (e) => { e.stopPropagation(); ctx.openEditor(b.ev); } },
    }, [
      el("div", { class: "tev-title", text: b.ev.title }),
      el("div", { class: "tev-time", text: `${formatTime(new Date(b.ev.start))}–${formatTime(new Date(b.ev.end))}` }),
    ]));
  }
  timeline.appendChild(eventsLayer);

  // "Jetzt"-Linie, wenn heute angezeigt wird.
  if (isToday(date)) {
    const nowMin = minutesIntoDay(new Date());
    timeline.appendChild(el("div", { class: "now-line", style: { top: `${(nowMin / 60) * HOUR_H}px` } }));
  }

  // Tippen auf freie Rasterflaeche -> neuer Termin zur dortigen Uhrzeit.
  timeline.addEventListener("click", (e) => {
    const y = e.clientY - timeline.getBoundingClientRect().top;
    const hour = clamp(Math.floor(y / HOUR_H), 0, 23);
    const when = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0);
    ctx.openEditor(null, when);
  });

  content.appendChild(timeline);

  // Schwebender "+"-Knopf -> neuer Termin (Standard 8:00).
  const fab = el("button", { class: "fab", title: "Termin hinzufügen", text: "+",
    on: { click: () => ctx.openEditor(null, date) } });

  const main = el("div", {
    style: { position: "relative", flex: "1 1 auto", display: "flex", "flex-direction": "column", "min-height": "0" },
  }, [content, fab]);

  // Nach dem Einfuegen: zum ersten Termin bzw. ~7:00 scrollen (Morgen sichtbar).
  requestAnimationFrame(() => {
    if (!timeline.isConnected) return;
    let scrollMin = 7 * 60;
    if (blocks.length) scrollMin = Math.min(...blocks.map((b) => b.startMin));
    const tlTop = timeline.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
    content.scrollTop = tlTop + Math.max(0, (scrollMin / 60 - 0.5) * HOUR_H);
  });

  return { topBar, navBar, main };
}
