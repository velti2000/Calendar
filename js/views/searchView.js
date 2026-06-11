/*
 * views/searchView.js  –  Suchfunktion (ueber die Lupe)
 * ==========================================================================
 * Oeffnet einen Dialog mit Suchfeld. Waehrend der Eingabe werden Treffer
 * (Titel/Ort/Notizen) live angezeigt. Klick auf ein Ergebnis springt zum
 * jeweiligen Tag.
 */

import { el, render } from "../utils/dom.js";
import { openModal, closeModal } from "../ui.js";
import { searchEvents, getCalendar } from "../store.js";
import { formatLongDate, formatTime } from "../utils/dates.js";

/**
 * Oeffnet die Suche.
 * @param {object} ctx  App-Kontext (fuer Navigation zum Tag)
 */
export function openSearch(ctx) {
  const input = el("input", { type: "search", placeholder: "Termine durchsuchen …", autocomplete: "off" });
  const resultsList = el("ul", { class: "search-results" });

  /** Zeigt die Trefferliste fuer den aktuellen Suchtext an. */
  const update = () => {
    const results = searchEvents(input.value);

    if (!input.value.trim()) {
      render(resultsList, [el("li", { class: "empty-hint", text: "Suchbegriff eingeben." })]);
      return;
    }
    if (results.length === 0) {
      render(resultsList, [el("li", { class: "empty-hint", text: "Keine Treffer." })]);
      return;
    }

    render(resultsList, results.slice(0, 50).map((ev) => {
      const cal = getCalendar(ev.calendarId);
      const start = new Date(ev.start);
      const dateLabel = ev.allDay
        ? formatLongDate(start)
        : `${formatLongDate(start)} · ${formatTime(start)}`;

      return el("li", {
        class: "search-result",
        on: { click: () => {
          closeModal();
          ctx.goToDay(start); // zum Tag des Treffers springen
        } },
      }, [
        el("span", { class: "res-dot", style: { background: cal ? cal.color : "var(--color-accent)" } }),
        el("div", {}, [
          el("div", { text: ev.title }),
          el("div", { class: "res-date", text: dateLabel }),
        ]),
      ]);
    }));
  };

  input.addEventListener("input", update);

  const content = el("div", {}, [
    el("div", { class: "modal-header" }, [
      el("div", { class: "modal-title", text: "Suche" }),
      el("button", { class: "modal-link", text: "Fertig", on: { click: () => closeModal() } }),
    ]),
    el("div", { class: "search-input-row" }, [input]),
    resultsList,
  ]);

  update();
  openModal(content);

  // Tastatur direkt in das Suchfeld setzen.
  setTimeout(() => input.focus(), 50);
}
