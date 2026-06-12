/*
 * views/monthView.js  –  Monatsansicht (Standardansicht, CalenGoo-Stil)
 * ==========================================================================
 * Zeigt einen Monat als Wochenzeilen mit je 7 Spalten (Mo–So).
 *
 * Darstellung der Termine (wie CalenGoo):
 *   - GANZTAGES- und MEHRTAGES-Termine: farbig hinterlegter Balken. Geht ein
 *     Termin ueber mehrere Tage, wird er als EIN durchgehender Balken ueber die
 *     betroffenen Spalten gelegt ("verbunden").
 *   - ZEIT-Termine (Einzeltag): weisser Hintergrund, nur Text in der
 *     Kategoriefarbe (plus farbiger Punkt).
 *
 * Technik: Jede Woche hat einen Hintergrund aus 7 Tageszellen und darueber eine
 * "Termin-Ebene" (CSS-Grid). Termine werden Spuren (lanes) zugeordnet, damit
 * sie sich nicht ueberlappen, und per grid-column ueber mehrere Spalten gelegt.
 */

import { el, bar3, clear } from "../utils/dom.js";
import {
  WEEKDAYS_SHORT, buildMonthGrid, isToday, isWeekend,
  formatMonthTitle, formatTime, addMonths, isoWeekNumber,
} from "../utils/dates.js";
import { getVisibleEvents, getCalendar } from "../store.js";
import { openDatePicker } from "./datePicker.js";

// Hoehe einer Termin-Zeile (muss zu .events-layer grid-auto-rows + row-gap in
// styles.css passen: 17px Zeile + 1px Abstand).
const LANE_HEIGHT = 18;
const LANE_GAP = 1;
// Vorlaeufige Zeilenzahl fuer den ersten Aufbau (wird per Messung korrigiert).
const DEFAULT_LANES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Anzahl ganzer Tage zwischen zwei Mitternachts-Daten. */
function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Liefert den von einem Termin abgedeckten Tagesbereich (Mitternacht bis
 * einschliesslich letztem Tag).
 */
function eventDayRange(event) {
  const s = new Date(event.start);
  let e = new Date(event.end);
  // Ganztagestermine enden per Konvention am Folgetag 00:00 -> 1 ms zurueck.
  if (event.allDay) e = new Date(e.getTime() - 1);
  return {
    startDay: new Date(s.getFullYear(), s.getMonth(), s.getDate()),
    endDay: new Date(e.getFullYear(), e.getMonth(), e.getDate()),
  };
}

/**
 * Berechnet fuer eine Woche alle Termin-Segmente inkl. Spalten und Spur (lane).
 * @param {Date[]} weekDays  genau 7 Tage (Mo–So), jeweils Mitternacht
 * @param {CalEvent[]} events  sichtbare Termine
 * @returns {Array} Segmente mit { event, startCol, endCol, lane, ... }
 */
function buildWeekSegments(weekDays, events) {
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const segs = [];

  for (const ev of events) {
    const { startDay, endDay } = eventDayRange(ev);
    // Termin liegt komplett ausserhalb dieser Woche?
    if (endDay < weekStart || startDay > weekEnd) continue;

    const startCol = Math.max(0, dayDiff(weekStart, startDay));
    const endCol = Math.min(6, dayDiff(weekStart, endDay));
    const multiDay = endDay.getTime() !== startDay.getTime();

    segs.push({
      event: ev,
      startCol, endCol, multiDay,
      allDay: ev.allDay,
      continuesLeft: startDay < weekStart,
      continuesRight: endDay > weekEnd,
      start: new Date(ev.start),
    });
  }

  // Sortierung: Balken (mehrtags/ganztags) zuerst und laengere zuerst, damit sie
  // oben liegen; danach Zeit-Termine chronologisch.
  segs.sort((a, b) => {
    const aBar = a.multiDay || a.allDay ? 0 : 1;
    const bBar = b.multiDay || b.allDay ? 0 : 1;
    if (aBar !== bBar) return aBar - bBar;
    if (aBar === 0) {
      const aLen = a.endCol - a.startCol, bLen = b.endCol - b.startCol;
      if (aLen !== bLen) return bLen - aLen;
    }
    return a.start - b.start;
  });

  // Spuren greedy vergeben: erste Spur, in der keine Spaltenueberschneidung ist.
  const lanes = []; // lanes[i] = Liste belegter [startCol, endCol]
  for (const seg of segs) {
    let lane = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const occupied = lanes[lane] || (lanes[lane] = []);
      const clash = occupied.some(([s, e]) => !(seg.endCol < s || seg.startCol > e));
      if (!clash) { seg.lane = lane; occupied.push([seg.startCol, seg.endCol]); break; }
      lane++;
    }
  }
  return segs;
}

/** Baut ein einzelnes Termin-Segment als DOM-Element. */
function renderSegment(seg, ctx, day) {
  const ev = seg.event;
  const cal = getCalendar(ev.calendarId);
  const color = cal ? cal.color : "var(--color-accent)";

  const style = {
    "--cat-color": color,
    "grid-column": `${seg.startCol + 1} / ${seg.endCol + 2}`,
    "grid-row": `${seg.lane + 1}`,
  };
  // Tippen auf einen Termin oeffnet zuerst die Tagesansicht (nicht direkt den Editor).
  const onClick = (e) => { e.stopPropagation(); ctx.goToDay(new Date(day)); };

  // Balken fuer Ganztags-/Mehrtages-Termine
  if (seg.multiDay || seg.allDay) {
    let cls = "seg " + (seg.multiDay ? "bar" : "allday");
    if (seg.continuesLeft) cls += " no-left";
    if (seg.continuesRight) cls += " no-right";
    // Bei Fortsetzung von links ein kleines Zeichen voranstellen.
    const label = (seg.continuesLeft ? "‹ " : "") + ev.title;
    return el("div", { class: cls, style, title: ev.title, on: { click: onClick } }, [label]);
  }

  // Zeit-Termin (Einzeltag): Punkt + Uhrzeit + Titel
  const time = formatTime(new Date(ev.start));
  return el("div", { class: "seg timed", style, title: `${time} ${ev.title}`, on: { click: onClick } }, [
    el("span", { class: "seg-time", text: time }),
    el("span", { text: ev.title }),
  ]);
}

/**
 * Fuellt eine Termin-Ebene mit Segmenten – bis zu `fitLanes` Zeilen sichtbar.
 * Passt nicht alles hinein, wird die letzte sichtbare Zeile fuer "+N" reserviert.
 * @param {HTMLElement} layer
 * @param {Array} segs   Segmente aus buildWeekSegments
 * @param {Date[]} weekDays
 * @param {number} fitLanes  wie viele Zeilen passen
 * @param {object} ctx
 */
function placeSegments(layer, segs, weekDays, fitLanes, ctx) {
  clear(layer);
  const cap = Math.max(1, fitLanes);
  const maxLane = segs.reduce((m, s) => Math.max(m, s.lane), -1);
  const overflow = maxLane + 1 > cap;
  // Bei Ueberlauf eine Zeile fuer "+N" frei halten.
  const laneCap = overflow ? cap - 1 : cap;

  const hiddenByCol = new Array(7).fill(0);
  for (const seg of segs) {
    if (seg.lane >= laneCap) {
      for (let c = seg.startCol; c <= seg.endCol; c++) hiddenByCol[c]++;
      continue;
    }
    layer.appendChild(renderSegment(seg, ctx, weekDays[seg.startCol]));
  }

  if (overflow) {
    for (let c = 0; c < 7; c++) {
      if (hiddenByCol[c] > 0) {
        const day = weekDays[c];
        layer.appendChild(el("div", {
          class: "seg more",
          style: { "grid-column": `${c + 1} / ${c + 2}`, "grid-row": `${laneCap + 1}` },
          text: `+${hiddenByCol[c]}`,
          on: { click: (e) => { e.stopPropagation(); ctx.goToDay(new Date(day)); } },
        }));
      }
    }
  }
}

/**
 * Erzeugt Kopfzeile (Header) und Hauptbereich (Raster) der Monatsansicht.
 * @param {object} ctx  App-Kontext (siehe app.js)
 * @returns {{ header: Node, main: Node }}
 */
export function renderMonthView(ctx) {
  const refDate = ctx.refDate;
  const events = getVisibleEvents();

  /* ----- Obere Leiste: Zahnrad (links) · Monat+Jahr (mittig) · Sync (rechts) ----- */
  const topBar = bar3(
    el("button", { class: "icon-btn big-gear", title: "Einstellungen", text: "⚙︎",
      on: { click: () => ctx.openSettings() } }),
    el("div", { class: "bar-title", text: formatMonthTitle(refDate) }),
    el("button", { class: "icon-btn sync-btn", title: "Synchronisieren", text: "⟳",
      on: { click: () => ctx.doSync() } }),
  );

  /* ----- Untere Leiste: Suche (links) · ‹ • › (mittig) · Datum-Sprung (rechts) ----- */
  const navBar = bar3(
    el("button", { class: "icon-btn", title: "Suchen", text: "🔍",
      on: { click: () => ctx.openSearch() } }),
    el("div", { class: "nav-group" }, [
      el("button", { class: "icon-btn nav-arrow", title: "Voriger Monat", text: "‹",
        on: { click: () => ctx.goToMonth(addMonths(refDate, -1)) } }),
      el("button", { class: "icon-btn nav-today", title: "Heute", text: "•",
        on: { click: () => ctx.goToToday() } }),
      el("button", { class: "icon-btn nav-arrow", title: "Nächster Monat", text: "›",
        on: { click: () => ctx.goToMonth(addMonths(refDate, 1)) } }),
    ]),
    el("button", { class: "icon-btn jump-btn", title: "Zu Datum springen", text: "››",
      on: { click: () => openDatePicker(refDate, (d) => ctx.goToMonth(d)) } }),
  );

  /* ----- Wochentags-Zeile (Mo Di Mi ...) mit fuehrender KW-Spalte ----- */
  const weekdayRow = el("div", { class: "weekday-row" }, [
    el("div", { class: "weekday-cell kw-head", text: "KW" }),
    ...WEEKDAYS_SHORT.map((wd, i) =>
      el("div", { class: "weekday-cell" + (i >= 5 ? " is-weekend" : ""), text: wd })
    ),
  ]);

  /* ----- Das Wochenraster ----- */
  const { days } = buildMonthGrid(refDate);
  const currentMonth = refDate.getMonth();

  const grid = el("div", { class: "month-grid" });

  // Wir merken uns je Woche die Termin-Ebene + Segmente, um die sichtbare
  // Zeilenzahl NACH dem Rendern an die tatsaechliche Zellenhoehe anzupassen.
  const weeksData = [];

  // Tage in Wochen (je 7) aufteilen.
  for (let w = 0; w < days.length; w += 7) {
    const weekDays = days.slice(w, w + 7);
    const segs = buildWeekSegments(weekDays, events);

    // Hintergrund-Tageszellen
    const bgCells = weekDays.map((day) => {
      const isOther = day.getMonth() !== currentMonth;
      return el("div", {
        class: "day-bg"
          + (isOther ? " is-othermonth" : "")
          + (isToday(day) ? " is-today" : "")
          + (isWeekend(day) ? " is-weekend" : ""),
        on: { click: () => ctx.goToDay(new Date(day)) },
      }, [
        el("div", { class: "day-number", text: String(day.getDate()) }),
      ]);
    });

    // Leere Termin-Ebene; gefuellt wird gleich (erst mit Standardwert, dann
    // nach Messung der echten Hoehe).
    const layer = el("div", { class: "events-layer" });
    placeSegments(layer, segs, weekDays, DEFAULT_LANES, ctx);

    // Kalenderwoche (KW) ganz links, vertikal mittig, ueber die ganze Zeile.
    const kwCell = el("div", { class: "kw-cell", text: String(isoWeekNumber(weekDays[0])) });

    grid.appendChild(el("div", { class: "week-row" }, [kwCell, ...bgCells, layer]));
    weeksData.push({ layer, segs, weekDays });
  }

  /* ----- Hauptbereich zusammensetzen ----- */
  const main = el("div", { class: "app-main-inner",
    style: { display: "flex", "flex-direction": "column", flex: "1 1 auto", "min-height": "0" } },
    [weekdayRow, grid]
  );

  // Nach dem Einfuegen ins DOM: echte Hoehe messen und so viele Zeilen zeigen,
  // wie tatsaechlich passen (verhindert ein "+N", obwohl noch Platz waere).
  requestAnimationFrame(() => {
    if (!weeksData.length || !weeksData[0].layer.isConnected) return;
    const avail = weeksData[0].layer.clientHeight;
    const fitLanes = Math.max(1, Math.floor((avail + LANE_GAP) / LANE_HEIGHT));
    for (const wk of weeksData) {
      placeSegments(wk.layer, wk.segs, wk.weekDays, fitLanes, ctx);
    }
  });

  // Wischgesten links/rechts -> Monat wechseln.
  attachSwipe(main, {
    onLeft: () => ctx.goToMonth(addMonths(refDate, 1)),   // nach links wischen -> naechster Monat
    onRight: () => ctx.goToMonth(addMonths(refDate, -1)), // nach rechts wischen -> voriger Monat
  });

  return { topBar, navBar, main };
}

/**
 * Haengt einfache horizontale Wischgesten an ein Element.
 * Loest nur aus, wenn die Bewegung ueberwiegend horizontal ist (damit das
 * vertikale Scrollen nicht stoert).
 */
function attachSwipe(node, { onLeft, onRight }) {
  let startX = 0, startY = 0, tracking = false;
  node.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY; tracking = true;
  }, { passive: true });
  node.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onLeft(); else onRight();
    }
  }, { passive: true });
}
