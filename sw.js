/*
 * sw.js  –  Service Worker der Calendar-PWA
 * --------------------------------------------------------------------------
 * Aufgaben:
 *   1. Offline-Faehigkeit: Wichtige App-Dateien werden in einen Cache gelegt,
 *      damit die App auch ohne Internet startet (App-Shell-Prinzip).
 *   2. Benachrichtigungen anzeigen: Der Service Worker kann Notifications
 *      darstellen, auch wenn das App-Fenster gerade nicht im Vordergrund ist.
 *
 * Hinweis: Der Service Worker laeuft in einem eigenen Kontext, getrennt von
 * der Seite. Er hat KEINEN Zugriff auf das DOM (document/window).
 */

// Version des Caches. Bei jeder Aenderung an den Dateien hochzaehlen,
// damit Browser die alten Dateien verwerfen und neu laden.
const CACHE_VERSION = "calendar-v5";

// Diese Dateien bilden die "App-Shell" und werden beim Installieren gecacht.
// Relativ zum Scope (dem Ordner, in dem sw.js liegt).
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/store.js",
  "./js/reminders.js",
  "./js/data/demoData.js",
  "./js/data/dataSource.js",
  "./js/data/ical.js",
  "./js/data/caldav.js",
  "./js/utils/dates.js",
  "./js/utils/dom.js",
  "./js/views/monthView.js",
  "./js/views/dayView.js",
  "./js/views/datePicker.js",
  "./js/views/eventEditor.js",
  "./js/views/searchView.js",
  "./js/views/settingsView.js",
];

// --- Installation: App-Shell in den Cache legen -------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll bricht ab, wenn EINE Datei fehlt. Deshalb tolerant einzeln cachen.
      return Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    })
  );
  // Neuen Service Worker sofort aktiv werden lassen.
  self.skipWaiting();
});

// --- Aktivierung: alte Caches aufraeumen --------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Service Worker uebernimmt sofort die Kontrolle ueber offene Seiten.
  self.clients.claim();
});

// --- Netzwerkanfragen: "Network first" fuer den Proxy, sonst "Cache first" ----
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Nur GET-Anfragen koennen sinnvoll gecacht werden.
  if (request.method !== "GET") return;

  // Anfragen an den CalDAV-Proxy NIEMALS aus dem Cache beantworten –
  // hier brauchen wir immer aktuelle Daten. (Erkennung per URL-Bestandteil.)
  if (request.url.includes("caldav-proxy")) {
    return; // Standardverhalten des Browsers (direkt ans Netz).
  }

  // Strategie "Netzwerk zuerst": Wir holen die Datei immer zuerst frisch aus dem
  // Netz (damit Updates sofort ankommen) und legen sie in den Cache. Nur wenn
  // das Netz nicht erreichbar ist (offline), antworten wir aus dem Cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)) // offline -> Cache
  );
});

// --- Klick auf eine Benachrichtigung ------------------------------------------
// Holt das App-Fenster in den Vordergrund (oder oeffnet es neu).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const hadWindow = clientsArr.find((c) => "focus" in c);
      if (hadWindow) return hadWindow.focus();
      return self.clients.openWindow("./index.html");
    })
  );
});

// --- Nachricht von der App: "zeige diese Erinnerung an" -----------------------
// Die App plant Erinnerungen und schickt sie zum passenden Zeitpunkt hierher.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "show-notification") {
    self.registration.showNotification(data.title || "Erinnerung", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: data.payload || {},
    });
  }
});
