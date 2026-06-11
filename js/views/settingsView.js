/*
 * views/settingsView.js  –  Einstellungen
 * ==========================================================================
 * Dialog mit allen Einstellungen:
 *   - Darstellung (Theme: automatisch/hell/dunkel)
 *   - SICHERHEIT: "Nur-Lesen" (keine Aenderungen an den Server)
 *   - Benachrichtigungen aktivieren + Standard-Erinnerung
 *   - mailbox.org-Zugangsdaten (Server/Proxy, Benutzername, Passwort)
 *   - Liste der Kalender (Kategorien) mit Sichtbarkeits-Schaltern
 *   - Sync / Verbindung testen
 */

import { el } from "../utils/dom.js";
import { openModal, closeModal, toast, confirmDialog } from "../ui.js";
import {
  getSettings, updateSettings, getCalendars, toggleCalendarVisible,
} from "../store.js";
import { enableNotifications } from "../reminders.js";
import { syncFromServer, testConnection } from "../data/dataSource.js";

/**
 * Oeffnet die Einstellungen.
 * @param {object} ctx
 */
export function openSettings(ctx) {
  const settings = getSettings();

  const body = el("div", { class: "modal-body" });

  /* ---------------- Darstellung / Theme ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "Darstellung" }));

  const themeSelect = el("select", {},
    [
      { v: "auto", l: "Automatisch (System)" },
      { v: "light", l: "Hell" },
      { v: "dark", l: "Dunkel" },
    ].map((o) => el("option", { value: o.v, selected: settings.theme === o.v ? "selected" : null }, [o.l]))
  );
  themeSelect.addEventListener("change", () => {
    updateSettings({ theme: themeSelect.value });
    ctx.applyTheme();
  });
  body.appendChild(field("Farbschema", themeSelect));

  // Position der Navigationsleiste (unten = einhaendig bequemer)
  const navSelect = el("select", {},
    [
      { v: "bottom", l: "Unten (einhändig)" },
      { v: "top", l: "Oben" },
    ].map((o) => el("option", { value: o.v, selected: settings.navPosition === o.v ? "selected" : null }, [o.l]))
  );
  navSelect.addEventListener("change", () => { updateSettings({ navPosition: navSelect.value }); ctx.rerender(); });
  body.appendChild(field("Navigationsleiste", navSelect));

  // Schriftgroesse der Termine in der Monatsansicht
  const fontSelect = el("select", {},
    [
      { v: 8, l: "Sehr klein" },
      { v: 9, l: "Klein" },
      { v: 10, l: "Mittel" },
      { v: 11, l: "Normal" },
      { v: 13, l: "Groß" },
    ].map((o) => el("option", { value: String(o.v), selected: settings.eventFontSize === o.v ? "selected" : null }, [o.l]))
  );
  fontSelect.addEventListener("change", () => { updateSettings({ eventFontSize: Number(fontSelect.value) }); ctx.rerender(); });
  body.appendChild(field("Schriftgröße Termine", fontSelect));

  /* ---------------- Sicherheit: Nur-Lesen ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "Sicherheit" }));
  body.appendChild(switchRow({
    label: "Nur-Lesen (empfohlen am Anfang)",
    desc: "Verhindert JEDE Änderung auf dem Server. Sync läuft nur Server → App.",
    checked: settings.readOnly,
    onChange: (checked) => {
      if (!checked) {
        // Beim Deaktivieren bewusst nachfragen – das ist sicherheitsrelevant.
        confirmDialog({
          title: "Schreibzugriff erlauben?",
          message: "Wenn du Nur-Lesen ausschaltest, können Änderungen später auf den mailbox.org-Server geschrieben werden. Sicher?",
          confirmLabel: "Erlauben",
          cancelLabel: "Abbrechen",
          danger: false,
          onConfirm: () => { updateSettings({ readOnly: false }); ctx.rerender(); },
        });
        return false; // Aenderung erst nach Bestaetigung uebernehmen
      }
      updateSettings({ readOnly: true });
      ctx.rerender();
      return true;
    },
  }));

  /* ---------------- Benachrichtigungen ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "Erinnerungen" }));
  body.appendChild(switchRow({
    label: "Benachrichtigungen aktivieren",
    desc: "Lokale Erinnerungen für Termine. iOS: nur bei zum Homescreen hinzugefügter App.",
    checked: settings.notificationsEnabled,
    onChange: async (checked) => {
      if (checked) {
        const granted = await enableNotifications();
        updateSettings({ notificationsEnabled: granted });
        toast(granted ? "Benachrichtigungen aktiv" : "Vom Browser abgelehnt");
        return granted;
      }
      updateSettings({ notificationsEnabled: false });
      return true;
    },
  }));

  const reminderSelect = el("select", {},
    [
      { v: -1, l: "Keine" }, { v: 0, l: "Zur Startzeit" }, { v: 10, l: "10 Min vorher" },
      { v: 15, l: "15 Min vorher" }, { v: 30, l: "30 Min vorher" }, { v: 60, l: "1 Std vorher" },
    ].map((o) => el("option", { value: String(o.v), selected: settings.defaultReminder === o.v ? "selected" : null }, [o.l]))
  );
  reminderSelect.addEventListener("change", () => updateSettings({ defaultReminder: Number(reminderSelect.value) }));
  body.appendChild(field("Standard-Erinnerung", reminderSelect));

  /* ---------------- mailbox.org Zugangsdaten ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "mailbox.org-Konto (CalDAV)" }));

  const serverInput = el("input", { type: "url", placeholder: "https://deinserver.de/caldav-proxy.php", value: settings.account.serverUrl });
  const userInput = el("input", { type: "text", placeholder: "E-Mail-Adresse", value: settings.account.username, autocomplete: "username" });
  const passInput = el("input", { type: "password", placeholder: "App-Passwort", value: settings.account.password, autocomplete: "current-password" });

  body.appendChild(field("Proxy-/Server-URL", serverInput));
  body.appendChild(field("Benutzername", userInput));
  body.appendChild(field("Passwort", passInput));
  body.appendChild(el("div", { class: "switch-desc", style: { "margin-bottom": "8px" },
    text: "Tipp: Bei mailbox.org ein eigenes App-Passwort anlegen statt des Hauptpassworts." }));

  const saveAccountBtn = el("button", { class: "btn-secondary", text: "Zugangsdaten speichern",
    on: { click: () => {
      updateSettings({ account: {
        serverUrl: serverInput.value.trim(),
        username: userInput.value.trim(),
        password: passInput.value,
      }});
      toast("Zugangsdaten gespeichert");
    } } });
  body.appendChild(saveAccountBtn);

  const testBtn = el("button", { class: "btn-secondary", text: "Verbindung testen",
    on: { click: async () => {
      toast("Teste Verbindung …");
      const res = await testConnection();
      toast(res.ok ? "Verbindung OK" : `Fehler: ${res.message}`);
    } } });
  body.appendChild(testBtn);

  const syncBtn = el("button", { class: "btn-primary", style: { "margin-top": "8px" }, text: "Jetzt synchronisieren (Server → App)",
    on: { click: async () => {
      toast("Synchronisiere …");
      const res = await syncFromServer();
      if (res.ok) { ctx.rerender(); toast(`Synchronisiert: ${res.count} Termine`); }
      else toast(`Sync-Fehler: ${res.message}`);
    } } });
  body.appendChild(syncBtn);

  /* ---------------- Kalender / Kategorien ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "Kalender (Kategorien)" }));
  const calList = el("ul", { class: "cal-list" },
    getCalendars().map((cal) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = cal.visible;
      cb.addEventListener("change", () => { toggleCalendarVisible(cal.id); ctx.rerender(); });
      return el("li", { class: "cal-item" }, [
        el("span", { class: "cal-dot", style: { background: cal.color } }),
        el("span", { class: "cal-name", text: cal.name }),
        el("label", { class: "switch" }, [cb, el("span", { class: "slider" })]),
      ]);
    })
  );
  body.appendChild(calList);

  /* ---------------- Daten zuruecksetzen ---------------- */
  body.appendChild(el("div", { class: "section-title", text: "Wartung" }));
  body.appendChild(el("button", { class: "btn-secondary", text: "Auf Demo-Daten zurücksetzen",
    on: { click: () => {
      confirmDialog({
        title: "Zurücksetzen?",
        message: "Alle lokalen Termine werden gelöscht und durch Demo-Daten ersetzt.",
        confirmLabel: "Zurücksetzen",
        onConfirm: () => {
          localStorage.removeItem("calendar.state.v1");
          location.reload();
        },
      });
    } } }));

  /* ---------------- Dialog zusammenbauen ---------------- */
  const content = el("div", {}, [
    el("div", { class: "modal-header" }, [
      el("div", { class: "modal-title", text: "Einstellungen" }),
      el("button", { class: "modal-link", text: "Fertig", on: { click: () => { closeModal(); ctx.rerender(); } } }),
    ]),
    body,
  ]);

  openModal(content);
}

/* -------------------------------------------------------------------------- */
/*  Bausteine                                                                  */
/* -------------------------------------------------------------------------- */

function field(labelText, inputNode) {
  return el("div", { class: "form-row" }, [el("label", { text: labelText }), inputNode]);
}

/**
 * Baut eine Schalter-Zeile. onChange darf false zurueckgeben, um die
 * optische Aenderung rueckgaengig zu machen (z.B. bei Abbruch einer Nachfrage).
 */
function switchRow({ label, desc, checked, onChange }) {
  const cb = el("input", { type: "checkbox" });
  cb.checked = checked;
  cb.addEventListener("change", async () => {
    const result = await onChange(cb.checked);
    if (result === false) cb.checked = !cb.checked; // zuruecksetzen
  });
  return el("div", { class: "switch-row" }, [
    el("div", {}, [
      el("div", { class: "switch-label", text: label }),
      desc ? el("div", { class: "switch-desc", text: desc }) : null,
    ]),
    el("label", { class: "switch" }, [cb, el("span", { class: "slider" })]),
  ]);
}
