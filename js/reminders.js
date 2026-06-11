/*
 * reminders.js  –  lokale Termin-Erinnerungen (Benachrichtigungen)
 * ==========================================================================
 * Plant Benachrichtigungen fuer anstehende Termine, solange die App laeuft.
 *
 * Funktionsweise (bewusst einfach gehalten):
 *   - Wir schauen die naechsten 24 Stunden voraus.
 *   - Fuer jeden Termin mit Erinnerung setzen wir einen Timer (setTimeout).
 *   - Loest der Timer aus, bitten wir den Service Worker, eine
 *     Benachrichtigung anzuzeigen (funktioniert auch bei minimiertem Fenster,
 *     solange das System die App nicht beendet hat).
 *
 * WICHTIGE EINSCHRAENKUNG (iOS/iPhone):
 *   iOS unterstuetzt KEINE echten geplanten Hintergrund-Benachrichtigungen
 *   fuer Web-Apps. Erinnerungen erscheinen dort zuverlaessig nur, wenn die
 *   App (als Homescreen-PWA) gerade laeuft. Fuer Benachrichtigungen bei
 *   geschlossener App braucht es echtes Web-Push ueber einen Server – das ist
 *   als spaeterer Ausbau vorgesehen (siehe README).
 */

import { getVisibleEvents } from "./store.js";

// Vorausschau-Fenster: nur Erinnerungen der naechsten 24h einplanen.
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

// Merkt sich gesetzte Timer, um sie bei Neuplanung wieder zu loeschen.
let scheduledTimers = [];
// Merkt sich, was schon benachrichtigt wurde (verhindert Doppel-Benachrichtigung).
const firedKeys = new Set();

/**
 * Fragt die Erlaubnis fuer Benachrichtigungen an.
 * @returns {Promise<boolean>} true, wenn erlaubt
 */
export async function enableNotifications() {
  if (!("Notification" in window)) {
    console.warn("Dieser Browser unterstützt keine Benachrichtigungen.");
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/**
 * Plant alle Erinnerungen der naechsten 24h neu.
 * Sollte nach jeder Datenaenderung aufgerufen werden.
 * @param {boolean} enabled  ob Benachrichtigungen in den Einstellungen aktiv sind
 */
export function scheduleReminders(enabled) {
  // Alte Timer loeschen.
  scheduledTimers.forEach((t) => clearTimeout(t));
  scheduledTimers = [];

  if (!enabled || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const now = Date.now();

  for (const event of getVisibleEvents()) {
    const reminders = event.reminders || [];
    const startMs = new Date(event.start).getTime();

    for (const minutesBefore of reminders) {
      const fireAt = startMs - minutesBefore * 60 * 1000;
      const delay = fireAt - now;

      // Nur Erinnerungen einplanen, die in der Zukunft und im Fenster liegen.
      if (delay <= 0 || delay > LOOKAHEAD_MS) continue;

      const fireKey = `${event.uid}@${fireAt}`;
      if (firedKeys.has(fireKey)) continue;

      const timer = setTimeout(() => {
        firedKeys.add(fireKey);
        showReminder(event, minutesBefore);
      }, delay);

      scheduledTimers.push(timer);
    }
  }
}

/**
 * Zeigt eine einzelne Erinnerung an – bevorzugt ueber den Service Worker,
 * sonst direkt ueber die Notification-API.
 * @param {CalEvent} event
 * @param {number} minutesBefore
 */
function showReminder(event, minutesBefore) {
  const start = new Date(event.start);
  const timeStr = event.allDay
    ? "heute"
    : start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  const title = event.title;
  const body = minutesBefore > 0
    ? `Beginnt um ${timeStr} (in ${minutesBefore} Min)`
    : `Beginnt jetzt (${timeStr})`;

  // Bevorzugt: Service Worker zeigt die Notification an (robuster).
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "show-notification",
      title, body, tag: event.uid, payload: { uid: event.uid },
    });
    return;
  }

  // Fallback: direkte Notification (nur wenn Seite im Vordergrund).
  try {
    new Notification(title, { body, tag: event.uid, icon: "./icons/icon-192.png" });
  } catch (err) {
    console.warn("Benachrichtigung konnte nicht angezeigt werden:", err);
  }
}
