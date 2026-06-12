/*
 * ui.js  –  wiederverwendbare UI-Bausteine: Dialoge (Modal), Bestaetigungen, Toasts
 * ==========================================================================
 * Diese Helfer kapseln die Arbeit mit den Containern #modal-root und
 * #toast-root aus index.html, damit die Views sich nicht darum kuemmern muessen.
 */

import { el, render, clear } from "./utils/dom.js";

const modalRoot = () => document.getElementById("modal-root");
const toastRoot = () => document.getElementById("toast-root");

/**
 * Oeffnet einen Bottom-Sheet-Dialog mit beliebigem Inhalt.
 * @param {Node} contentNode  fertiges Inhalts-Element (z.B. ein Formular)
 * @param {object} [opts]
 * @param {boolean} [opts.center=false] kleinen, zentrierten Dialog anzeigen
 * @param {Function} [opts.onClose]      Callback beim Schliessen
 * @returns {Function} Funktion zum programmatischen Schliessen
 */
export function openModal(contentNode, opts = {}) {
  const root = modalRoot();
  root.className = "modal-root is-open" + (opts.center ? " center" : "");

  const close = () => closeModal(opts.onClose);

  const backdrop = el("div", { class: "modal-backdrop", on: { click: close } });
  const sheet = el("div", { class: "modal-sheet" }, [contentNode]);

  render(root, [backdrop, sheet]);

  // Schliessen per Escape-Taste (Desktop/Tastatur).
  root._escHandler = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", root._escHandler);

  return close;
}

/** Schliesst den aktuell offenen Dialog. */
export function closeModal(onClose) {
  const root = modalRoot();
  root.className = "modal-root";
  clear(root);
  if (root._escHandler) {
    document.removeEventListener("keydown", root._escHandler);
    root._escHandler = null;
  }
  if (typeof onClose === "function") onClose();
}

/**
 * Zeigt einen Bestaetigungsdialog (z.B. vor dem Loeschen) an.
 * Erfuellt die Anforderung: "Termine loeschen nochmal mit Popup bestaetigen".
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel="Löschen"]
 * @param {string} [opts.cancelLabel="Abbrechen"]
 * @param {boolean} [opts.danger=true]  faerbt den Bestaetigen-Knopf rot
 * @param {Function} opts.onConfirm     wird bei Bestaetigung aufgerufen
 */
export function confirmDialog(opts) {
  const {
    title = "Bestätigen",
    message = "",
    confirmLabel = "Löschen",
    cancelLabel = "Abbrechen",
    danger = true,
    onConfirm,
  } = opts;

  const content = el("div", {}, [
    el("div", { class: "modal-header" }, [
      el("div", { class: "modal-title", text: title }),
    ]),
    el("div", { class: "confirm-text", text: message }),
    el("div", { class: "confirm-actions" }, [
      el("button", {
        class: "btn-cancel",
        text: cancelLabel,
        on: { click: () => closeModal() },
      }),
      el("button", {
        class: danger ? "btn-danger" : "",
        text: confirmLabel,
        on: {
          click: () => {
            closeModal();
            if (typeof onConfirm === "function") onConfirm();
          },
        },
      }),
    ]),
  ]);

  openModal(content, { center: true });
}

/**
 * Zeigt einen Hinweis-"Toast" am unteren Rand.
 * @param {string} message
 * @param {number|object} [opts]
 *   - Zahl: Anzeigedauer in Millisekunden (altes Verhalten).
 *   - Objekt: { persist:boolean, duration:number }
 *     persist=true -> bleibt stehen, bis man darauf tippt.
 * @returns {Function} Funktion zum manuellen Schliessen.
 */
export function toast(message, opts = {}) {
  let duration = 2500;
  let persist = false;
  if (typeof opts === "number") duration = opts;
  else { if (opts.duration) duration = opts.duration; if (opts.persist) persist = true; }

  const node = el("div", { class: "toast" + (persist ? " toast-error" : "") });
  node.appendChild(el("span", { text: message }));
  if (persist) node.appendChild(el("span", { class: "toast-close", text: "✕" }));

  const remove = () => {
    node.style.transition = "opacity 0.3s";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 300);
  };

  // Tippen schliesst den Hinweis immer.
  node.addEventListener("click", remove);
  toastRoot().appendChild(node);

  // Nicht-dauerhafte Hinweise verschwinden nach Ablauf der Zeit von selbst.
  if (!persist) setTimeout(remove, duration);
  return remove;
}

/**
 * Bequemer Helfer fuer FEHLER: bleibt stehen, bis der Nutzer darauf tippt.
 * @param {string} message
 */
export function errorToast(message) {
  return toast(message, { persist: true });
}
