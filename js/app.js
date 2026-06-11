/*
 * app.js  –  Einstiegspunkt und Steuerung der App
 * ==========================================================================
 * Aufgaben:
 *   1. Service Worker registrieren (Offline + Benachrichtigungen)
 *   2. Gespeicherten Zustand laden
 *   3. Farbschema (Theme) anwenden
 *   4. Die aktive Ansicht (Monat/Tag) rendern und auf Aenderungen reagieren
 *
 * "Routing" ist hier bewusst einfach: Es gibt eine kleine UI-Zustandsvariable
 * `view` ("month" | "day") und ein Bezugsdatum `refDate`. Der ctx (Kontext)
 * buendelt alle Aktionen, die die Views aufrufen koennen.
 */

import { loadState, subscribe, getSettings } from "./store.js";
import { renderMonthView } from "./views/monthView.js";
import { renderDayView } from "./views/dayView.js";
import { openEventEditor } from "./views/eventEditor.js";
import { openSearch as openSearchView } from "./views/searchView.js";
import { openSettings as openSettingsView } from "./views/settingsView.js";
import { scheduleReminders } from "./reminders.js";
import { render, el } from "./utils/dom.js";

/* ----------------------------- UI-Zustand --------------------------------- */
const uiState = {
  view: "month",      // aktuelle Ansicht
  refDate: new Date(), // Bezugsdatum (Monat bzw. Tag)
};

/* ----------------------------- Kontext (ctx) ------------------------------ */
/*
 * Dieses Objekt wird an alle Views uebergeben. Es enthaelt die Navigations-
 * und Aktions-Funktionen, damit die Views nichts ueber den Rest der App
 * wissen muessen.
 */
const ctx = {
  get view() { return uiState.view; },
  get refDate() { return uiState.refDate; },

  /** Zur Monatsansicht eines (beliebigen) Datums wechseln. */
  goToMonth(date) {
    uiState.view = "month";
    uiState.refDate = date || new Date();
    rerender();
  },

  /** Zur Tagesansicht eines Datums wechseln. */
  goToDay(date) {
    uiState.view = "day";
    uiState.refDate = date || new Date();
    rerender();
  },

  /** Zur heutigen Monatsansicht springen. */
  goToToday() {
    uiState.view = "month";
    uiState.refDate = new Date();
    rerender();
  },

  /** Termin-Editor oeffnen (event=null fuer neu). */
  openEditor(event, defaultDate) {
    openEventEditor(event, defaultDate, () => rerender());
  },

  /** Suche oeffnen. */
  openSearch() { openSearchView(ctx); },

  /** Einstellungen oeffnen. */
  openSettings() { openSettingsView(ctx); },

  /** Theme erneut anwenden (nach Einstellungsaenderung). */
  applyTheme,

  /** Komplettes Neu-Rendern anstossen. */
  rerender,
};

/* ----------------------------- Rendern ------------------------------------ */

/** Zeichnet die aktuelle Ansicht (Header + Hauptbereich) neu. */
function rerender() {
  const headerEl = document.getElementById("app-header");
  const footerEl = document.getElementById("app-footer");
  const mainEl = document.getElementById("app-main");

  // Passende View auswaehlen.
  const view = uiState.view === "day" ? renderDayView(ctx) : renderMonthView(ctx);

  const settings = getSettings();

  // Optionalen "Nur-Lesen"-Hinweisstreifen ganz oben einblenden.
  const banner = settings.readOnly
    ? el("div", { class: "readonly-banner", text: "🔒 Nur-Lesen aktiv – keine Änderungen am Server" })
    : null;

  // Schriftgroesse der Termine (in der Monatsansicht) anwenden.
  document.documentElement.style.setProperty("--seg-font-size", (settings.eventFontSize || 10) + "px");

  // Die obere Leiste (Zahnrad/Titel/Suche) ist immer oben.
  // Die Navigationsleiste (Sprung + ‹•›) liegt je nach Einstellung unten oder
  // direkt unter der oberen Leiste.
  const navAtBottom = settings.navPosition === "bottom";
  document.getElementById("app").setAttribute("data-nav", navAtBottom ? "bottom" : "top");

  if (navAtBottom) {
    render(headerEl, [banner, view.topBar].filter(Boolean));
    render(footerEl, [view.navBar]);
  } else {
    render(headerEl, [banner, view.topBar, view.navBar].filter(Boolean));
    render(footerEl, []);
  }

  render(mainEl, [view.main]);

  // Erinnerungen nach jeder Aenderung neu einplanen.
  scheduleReminders(settings.notificationsEnabled);
}

/** Wendet das gewaehlte Farbschema auf das <html>-Element an. */
function applyTheme() {
  const theme = getSettings().theme;
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme"); // "auto" -> Systemeinstellung
}

/* ----------------------------- Start --------------------------------------- */

function start() {
  loadState();
  applyTheme();

  // Bei jeder Datenaenderung neu rendern.
  subscribe(() => rerender());

  rerender();

  // Service Worker registrieren (nur wenn vom Browser unterstuetzt).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) =>
        console.warn("Service Worker Registrierung fehlgeschlagen:", err)
      );
    });
  }
}

start();
