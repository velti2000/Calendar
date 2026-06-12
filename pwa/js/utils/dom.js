/*
 * utils/dom.js  –  kleine Helfer zum Erzeugen von HTML-Elementen
 * ==========================================================================
 * Damit wir kein grosses Framework brauchen, bauen wir das UI mit diesen
 * Mini-Funktionen zusammen. `el()` ist eine kompakte Art, Elemente samt
 * Attributen und Kindern in einem Aufruf zu erstellen.
 */

/**
 * Erstellt ein DOM-Element.
 * @param {string} tag        z.B. "div", "button"
 * @param {object} [props]    Attribute/Eigenschaften. Sonderfaelle:
 *                            - class: CSS-Klassen (String)
 *                            - text: setzt textContent
 *                            - html: setzt innerHTML (nur fuer vertrauenswuerdigen Inhalt!)
 *                            - dataset: { key: value } -> data-Attribute
 *                            - style: { prop: value }
 *                            - on: { eventName: handler }
 *                            - alles andere wird als Attribut gesetzt
 * @param {Array|Node|string} [children] Kindelemente
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "dataset") {
      for (const [d, v] of Object.entries(value)) node.dataset[d] = v;
    } else if (key === "style") {
      for (const [s, v] of Object.entries(value)) node.style.setProperty(s, v);
    } else if (key === "on") {
      for (const [evt, handler] of Object.entries(value)) node.addEventListener(evt, handler);
    } else {
      node.setAttribute(key, value);
    }
  }

  appendChildren(node, children);
  return node;
}

/** Haengt ein oder mehrere Kinder (Knoten oder Strings) an ein Element an. */
export function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** Leert ein Element (entfernt alle Kinder). */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Ersetzt den kompletten Inhalt eines Elements durch neue Kinder. */
export function render(node, children) {
  clear(node);
  appendChildren(node, children);
}

/**
 * Baut eine dreigeteilte Leiste (links / mittig / rechts). Der mittlere
 * Bereich bleibt dabei optisch zentriert, egal wie breit links/rechts sind.
 * @param {Node|Node[]} left
 * @param {Node|Node[]} center
 * @param {Node|Node[]} right
 * @returns {HTMLElement}
 */
export function bar3(left, center, right) {
  return el("div", { class: "app-bar" }, [
    el("div", { class: "bar-left" }, asArray(left)),
    el("div", { class: "bar-center" }, asArray(center)),
    el("div", { class: "bar-right" }, asArray(right)),
  ]);
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/**
 * Einfacher Icon-Helfer. Wir nutzen Emoji/Unicode-Symbole, damit keine
 * zusaetzliche Icon-Bibliothek noetig ist. Kann spaeter durch SVGs ersetzt
 * werden, ohne die aufrufenden Stellen zu aendern.
 */
export const ICONS = {
  prev: "‹",
  next: "›",
  today: "•",
  search: "🔍",
  settings: "⚙︎",
  add: "+",
  back: "‹",
  close: "✕",
  trash: "🗑",
};
