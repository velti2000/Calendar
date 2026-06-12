/*
 * views/datePicker.js  –  "Zu Datum springen" mit Auswahlraedern
 * ==========================================================================
 * Oeffnet einen Dialog mit drei scrollbaren Raedern (Tag / Monat / Jahr),
 * wie man es von iOS kennt. Beim Bestaetigen springt die App in den gewaehlten
 * Monat.
 *
 * Technik: Jedes "Rad" ist ein vertikal scrollbarer Bereich mit
 * Scroll-Snapping (CSS). Der mittig liegende Eintrag (im hervorgehobenen Band)
 * ist der ausgewaehlte Wert. Funktioniert per Touch auf dem iPhone.
 */

import { el, render } from "../utils/dom.js";
import { openModal, closeModal } from "../ui.js";
import { MONTHS_LONG } from "../utils/dates.js";

const ITEM_HEIGHT = 40; // muss zur CSS-Hoehe von .wheel-item passen

/**
 * Oeffnet den Datums-Sprung-Dialog.
 * @param {Date} currentDate  Startwert der Raeder
 * @param {Function} onPick    Callback mit dem gewaehlten Date
 */
export function openDatePicker(currentDate, onPick) {
  const today = new Date();
  const startYear = today.getFullYear() - 10;
  const years = Array.from({ length: 21 }, (_, i) => startYear + i); // +-10 Jahre

  // Werte fuer die drei Raeder.
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const months = MONTHS_LONG;

  // Aktuelle Auswahl (wird beim Scrollen aktualisiert).
  const selection = {
    day: currentDate.getDate(),
    month: currentDate.getMonth(),  // 0..11
    year: currentDate.getFullYear(),
  };

  // Die drei Raeder bauen.
  const dayWheel = buildWheel(days.map(String), selection.day - 1, (idx) => { selection.day = idx + 1; });
  const monthWheel = buildWheel(months, selection.month, (idx) => { selection.month = idx; });
  const yearWheel = buildWheel(years.map(String), years.indexOf(selection.year), (idx) => { selection.year = years[idx]; });

  const picker = el("div", { class: "wheel-picker" }, [
    el("div", { class: "wheel-highlight" }), // hervorgehobenes Band in der Mitte
    dayWheel.element,
    monthWheel.element,
    yearWheel.element,
  ]);

  const handleConfirm = () => {
    // Tag auf einen gueltigen Wert des Monats begrenzen (z.B. 31. Februar -> 28./29.).
    const lastDay = new Date(selection.year, selection.month + 1, 0).getDate();
    const day = Math.min(selection.day, lastDay);
    closeModal();
    onPick(new Date(selection.year, selection.month, day));
  };

  const content = el("div", {}, [
    el("div", { class: "modal-header" }, [
      el("button", { class: "modal-link", text: "Abbrechen", on: { click: () => closeModal() } }),
      el("div", { class: "modal-title", text: "Zu Datum springen" }),
      el("button", { class: "modal-link", text: "Springen", on: { click: handleConfirm } }),
    ]),
    el("div", { class: "modal-body" }, [picker]),
  ]);

  openModal(content);

  // Nach dem Einblenden die Raeder auf die Startwerte setzen (Layout muss stehen).
  requestAnimationFrame(() => {
    dayWheel.scrollToSelected();
    monthWheel.scrollToSelected();
    yearWheel.scrollToSelected();
  });
}

/**
 * Baut ein einzelnes Auswahlrad.
 * @param {string[]} labels       Anzeigetexte
 * @param {number} initialIndex   anfangs ausgewaehlter Index
 * @param {Function} onChange     Callback(index) bei Auswahlaenderung
 * @returns {{element:HTMLElement, scrollToSelected:Function}}
 */
function buildWheel(labels, initialIndex, onChange) {
  let currentIndex = Math.max(0, initialIndex);

  const itemNodes = labels.map((label, i) =>
    el("div", { class: "wheel-item", dataset: { index: String(i) } }, [label])
  );

  // Leerraum oben/unten, damit der erste/letzte Eintrag in die Mitte scrollen kann.
  const spacerTop = el("div", { class: "wheel-spacer" });
  const spacerBottom = el("div", { class: "wheel-spacer" });

  const wheel = el("div", { class: "wheel" }, [spacerTop, ...itemNodes, spacerBottom]);

  // Markiert den aktuell zentrierten Eintrag (optische Hervorhebung).
  const markSelected = () => {
    itemNodes.forEach((n, i) => n.classList.toggle("is-selected", i === currentIndex));
  };

  // Beim Scrollen den zentrierten Index bestimmen.
  let scrollTimer = null;
  wheel.addEventListener("scroll", () => {
    const idx = Math.round(wheel.scrollTop / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(labels.length - 1, idx));
    if (clamped !== currentIndex) {
      currentIndex = clamped;
      markSelected();
      onChange(currentIndex);
    }
    // Nach dem Scrollen sauber einrasten (falls Snapping nicht perfekt war).
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      wheel.scrollTo({ top: currentIndex * ITEM_HEIGHT, behavior: "smooth" });
    }, 120);
  });

  // Tippen auf einen Eintrag scrollt ihn in die Mitte.
  itemNodes.forEach((n, i) => n.addEventListener("click", () => {
    currentIndex = i;
    markSelected();
    onChange(i);
    wheel.scrollTo({ top: i * ITEM_HEIGHT, behavior: "smooth" });
  }));

  const scrollToSelected = () => {
    wheel.scrollTop = currentIndex * ITEM_HEIGHT;
    markSelected();
  };

  return { element: wheel, scrollToSelected };
}
