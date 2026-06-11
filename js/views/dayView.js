/*
 * views/dayView.js  –  Tagesansicht
 * ==========================================================================
 * Zeigt alle Termine eines einzelnen Tages als Liste:
 *   - oben die Ganztagestermine (farbig)
 *   - darunter die Zeit-Termine, chronologisch
 * Ueber den "+"-Knopf (FAB, unten rechts) wird ein neuer Termin fuer diesen
 * Tag angelegt. Tippen auf einen Termin oeffnet ihn zum Bearbeiten.
 */

import { el } from "../utils/dom.js";
import {
  formatLongDate, formatTime, dayKey, addDays, isToday,
  WEEKDAYS_LONG, mondayIndex,
} from "../utils/dates.js";
import { getEventsByDay, getCalendar } from "../store.js";

/**
 * Eine Termin-Karte fuer die Tagesansicht.
 * @param {CalEvent} event
 * @param {Function} onTap
 */
function eventCard(event, onTap) {
  const cal = getCalendar(event.calendarId);
  const color = cal ? cal.color : "var(--color-accent)";

  // Zeitangabe rechts: bei Ganztag "ganztägig", sonst "HH:MM–HH:MM".
  let timeLabel;
  if (event.allDay) {
    timeLabel = "ganztägig";
  } else {
    timeLabel = `${formatTime(new Date(event.start))}\n${formatTime(new Date(event.end))}`;
  }

  const metaParts = [];
  if (cal) metaParts.push(cal.name);
  if (event.location) metaParts.push(event.location);

  return el("div", {
    class: "event-card",
    style: { "--cat-color": color },
    on: { click: () => onTap(event) },
  }, [
    el("div", { class: "color-bar" }),
    el("div", { class: "event-body" }, [
      el("div", { class: "event-title", text: event.title }),
      metaParts.length ? el("div", { class: "event-meta", text: metaParts.join(" · ") }) : null,
      event.notes ? el("div", { class: "event-meta text-muted", text: event.notes }) : null,
    ]),
    el("div", { class: "event-time", style: { "white-space": "pre-line" }, text: timeLabel }),
  ]);
}

/**
 * Erzeugt Kopfzeile und Hauptbereich der Tagesansicht.
 * @param {object} ctx
 * @returns {{ header: Node, main: Node }}
 */
export function renderDayView(ctx) {
  const date = ctx.refDate;
  const events = getEventsByDay().get(dayKey(date)) || [];

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  /* ----- Kopfzeile: Zurueck zum Monat + Tages-Navigation ----- */
  const header = el("div", { class: "header-bar" }, [
    el("button", { class: "icon-btn", title: "Zurück zum Monat", text: "‹",
      on: { click: () => ctx.goToMonth(date) } }),
    el("div", { class: "header-title" }, [
      WEEKDAYS_LONG[mondayIndex(date)],
      el("span", { class: "subtitle", text: `${date.getDate()}.${date.getMonth() + 1}.` }),
    ]),
    el("div", { class: "header-actions" }, [
      el("button", { class: "icon-btn nav-arrow", title: "Voriger Tag", text: "‹",
        on: { click: () => ctx.goToDay(addDays(date, -1)) } }),
      el("button", { class: "icon-btn nav-today", title: "Heute", text: "•",
        on: { click: () => ctx.goToDay(new Date()) } }),
      el("button", { class: "icon-btn nav-arrow", title: "Nächster Tag", text: "›",
        on: { click: () => ctx.goToDay(addDays(date, 1)) } }),
      el("button", { class: "icon-btn", title: "Suchen", text: "🔍",
        on: { click: () => ctx.openSearch() } }),
    ]),
  ]);

  /* ----- Inhalt ----- */
  const content = el("div", { class: "day-view" });

  // Grosser Datumskopf
  content.appendChild(el("div", { class: "day-view-header" }, [
    el("div", { class: "weekday", text: isToday(date) ? "Heute" : WEEKDAYS_LONG[mondayIndex(date)] }),
    el("div", { class: "bigdate", text: formatLongDate(date) }),
  ]));

  if (events.length === 0) {
    content.appendChild(el("div", { class: "empty-hint", text: "Keine Termine an diesem Tag.\nTippe auf „+“, um einen Termin hinzuzufügen." }));
  }

  // Ganztags-Abschnitt
  if (allDayEvents.length) {
    content.appendChild(el("div", { class: "section-title", text: "Ganztägig",
      style: { padding: "0 16px" } }));
    allDayEvents.forEach((ev) => content.appendChild(eventCard(ev, (e) => ctx.openEditor(e))));
  }

  // Zeit-Termine
  if (timedEvents.length) {
    content.appendChild(el("div", { class: "section-title", text: "Termine",
      style: { padding: "0 16px" } }));
    timedEvents.forEach((ev) => content.appendChild(eventCard(ev, (e) => ctx.openEditor(e))));
  }

  // Schwebender "+"-Knopf -> neuen Termin an diesem Tag anlegen.
  const fab = el("button", { class: "fab", title: "Termin hinzufügen", text: "+",
    on: { click: () => ctx.openEditor(null, date) } });

  const main = el("div", {
    style: { position: "relative", flex: "1 1 auto", display: "flex", "flex-direction": "column", "min-height": "0" },
  }, [content, fab]);

  return { header, main };
}
