/*
 * views/eventEditor.js  –  Termin anlegen / bearbeiten / loeschen
 * ==========================================================================
 * Oeffnet einen Dialog (Bottom-Sheet) mit einem Formular. Wird sowohl zum
 * Neuanlegen als auch zum Bearbeiten genutzt.
 *
 * Loeschen wird – wie gefordert – immer ueber ein zusaetzliches
 * Bestaetigungs-Popup abgesichert (confirmDialog).
 */

import { el } from "../utils/dom.js";
import { openModal, closeModal, confirmDialog, toast } from "../ui.js";
import {
  getCalendars, getSettings, addEvent, updateEvent, deleteEvent, getEvent,
} from "../store.js";
import {
  toDateInputValue, toTimeInputValue, dateFromInputs, addDays,
} from "../utils/dates.js";
import { pushChange } from "../data/dataSource.js";

/**
 * Oeffnet den Termin-Editor.
 * @param {CalEvent|null} event   bestehender Termin oder null fuer "neu"
 * @param {Date} [defaultDate]    Vorgabe-Datum beim Neuanlegen
 * @param {Function} [onSaved]    Callback nach Speichern/Loeschen (neu rendern)
 */
export function openEventEditor(event, defaultDate, onSaved) {
  const calendars = getCalendars();
  const settings = getSettings();

  // Tippt man ein einzelnes Vorkommen einer Serie an, bearbeiten wir den
  // Original-Termin (Aenderungen gelten dann fuer die ganze Reihe).
  let isSeries = false;
  if (event && event.recurringMaster) {
    const master = getEvent(event.recurringMaster);
    if (master) { event = master; isSeries = true; }
  } else if (event && event.rrule) {
    isSeries = true;
  }
  const isNew = !event;

  // Startwerte bestimmen (entweder aus dem Termin oder sinnvolle Vorgaben).
  // Hat defaultDate eine Uhrzeit (z.B. Tippen ins Stundenraster), wird sie
  // uebernommen – sonst Standard-Startzeit 8:00 Uhr, Ende 9:00 Uhr.
  const baseDate = defaultDate || (event ? new Date(event.start) : new Date());
  const hasTime = defaultDate && (defaultDate.getHours() || defaultDate.getMinutes());
  const startDate = event ? new Date(event.start)
    : (hasTime ? new Date(defaultDate) : defaultStartTime(baseDate));
  const endDate = event ? new Date(event.end) : new Date(startDate.getTime() + 60 * 60 * 1000);

  // Lokaler Formularzustand.
  const formState = {
    title: event ? event.title : "",
    calendarId: event ? event.calendarId : (calendars[0] && calendars[0].id),
    allDay: event ? event.allDay : false,
    startDate, endDate,
    location: event ? event.location || "" : "",
    notes: event ? event.notes || "" : "",
    reminder: event ? (event.reminders && event.reminders[0] != null ? event.reminders[0] : settings.defaultReminder)
                    : settings.defaultReminder,
    rrule: event ? (event.rrule || "") : "",
  };

  /* --------- Eingabefelder ---------- */
  const titleInput = el("input", { type: "text", placeholder: "Titel", value: formState.title });

  // Kategorie-Auswahl als farbige Chips.
  const categoryPicker = el("div", { class: "category-picker" },
    calendars.map((cal) => {
      const chip = el("div", {
        class: "category-chip" + (cal.id === formState.calendarId ? " is-selected" : ""),
        on: { click: () => {
          formState.calendarId = cal.id;
          // Auswahlmarkierung aktualisieren.
          categoryPicker.querySelectorAll(".category-chip").forEach((c) => c.classList.remove("is-selected"));
          chip.classList.add("is-selected");
        } },
      }, [
        el("span", { class: "dot", style: { background: cal.color } }),
        cal.name,
      ]);
      return chip;
    })
  );

  // Datums-/Zeitfelder
  const startDateInput = el("input", { type: "date", value: toDateInputValue(formState.startDate) });
  const startTimeInput = el("input", { type: "time", value: toTimeInputValue(formState.startDate) });
  const endDateInput = el("input", { type: "date", value: toDateInputValue(formState.endDate) });
  const endTimeInput = el("input", { type: "time", value: toTimeInputValue(formState.endDate) });

  const timeFields = el("div", { class: "form-inline" }, [startTimeInput, endTimeInput]);

  // Ganztags-Schalter blendet die Uhrzeitfelder aus.
  const allDayCheckbox = el("input", { type: "checkbox" });
  allDayCheckbox.checked = formState.allDay;
  const applyAllDay = () => {
    timeFields.classList.toggle("hidden", allDayCheckbox.checked);
  };
  allDayCheckbox.addEventListener("change", applyAllDay);
  applyAllDay();

  const locationInput = el("input", { type: "text", placeholder: "Ort (optional)", value: formState.location });
  const notesInput = el("textarea", { placeholder: "Notizen (optional)" }, [formState.notes]);

  // Erinnerung
  const reminderSelect = el("select", {},
    REMINDER_OPTIONS.map((opt) =>
      el("option", { value: String(opt.value), selected: opt.value === formState.reminder ? "selected" : null }, [opt.label])
    )
  );

  // Wiederholung (Serientermin)
  const recurrenceSelect = el("select", {},
    RECURRENCE_OPTIONS.map((opt) =>
      el("option", { value: opt.value, selected: opt.value === formState.rrule ? "selected" : null }, [opt.label])
    )
  );

  /* --------- Speichern ---------- */
  const handleSave = async () => {
    const title = titleInput.value.trim() || "(ohne Titel)";
    const allDay = allDayCheckbox.checked;

    let start, end;
    if (allDay) {
      start = dateFromInputs(startDateInput.value);
      // Ganztag: Ende = Folgetag 00:00 (iCal-Konvention, mind. 1 Tag).
      const endDay = dateFromInputs(endDateInput.value);
      end = addDays(endDay, 1);
    } else {
      start = dateFromInputs(startDateInput.value, startTimeInput.value);
      end = dateFromInputs(endDateInput.value, endTimeInput.value);
      if (end <= start) {
        // Sanfte Korrektur: Ende mindestens 30 Min nach Start.
        end = new Date(start.getTime() + 30 * 60 * 1000);
      }
    }

    const reminderVal = Number(reminderSelect.value);
    const reminders = reminderVal >= 0 ? [reminderVal] : [];

    const payload = {
      calendarId: formState.calendarId,
      title,
      allDay,
      start: start.toISOString(),
      end: end.toISOString(),
      location: locationInput.value.trim(),
      notes: notesInput.value.trim(),
      reminders,
      rrule: recurrenceSelect.value || null, // Serientermin-Regel oder keine
    };

    // 1) Lokal speichern (immer), damit die Anzeige sofort stimmt.
    const saved = isNew ? addEvent(payload) : updateEvent(event.uid, payload);

    closeModal();
    if (onSaved) onSaved();

    // 2) Auf den Server schreiben – nur wenn CalDAV aktiv UND Nur-Lesen aus.
    //    (Im Demo-/Nur-Lesen-Modus macht pushChange bewusst nichts.)
    const res = await pushChange("put", saved);
    if (res.ok) {
      // Server liefert ggf. Adresse (href) + Version (etag) zurueck -> merken,
      // damit spaeteres Aendern/Loeschen den richtigen Eintrag trifft.
      if (res.href || res.etag) updateEvent(saved.uid, { href: res.href, etag: res.etag });
      toast(isNew ? "Termin hinzugefügt" : "Termin gespeichert");
    } else {
      toast("Lokal gespeichert – Server-Fehler: " + res.message);
    }
  };

  /* --------- Loeschen (mit Bestaetigung) ---------- */
  const handleDelete = () => {
    confirmDialog({
      title: "Termin löschen?",
      message: `„${event.title}“ wird gelöscht. Das kann nicht rückgängig gemacht werden.`,
      confirmLabel: "Löschen",
      cancelLabel: "Abbrechen",
      onConfirm: async () => {
        // Erst auf dem Server loeschen (solange href/etag noch vorhanden sind) ...
        const res = await pushChange("delete", event);
        // ... dann lokal entfernen.
        deleteEvent(event.uid);
        closeModal();
        if (onSaved) onSaved();
        toast(res.ok ? "Termin gelöscht" : "Lokal gelöscht – Server-Fehler: " + res.message);
      },
    });
  };

  /* --------- Aufbau des Dialogs ---------- */
  const header = el("div", { class: "modal-header" }, [
    el("button", { class: "modal-link", text: "Abbrechen", on: { click: () => closeModal() } }),
    el("div", { class: "modal-title", text: isNew ? "Neuer Termin" : "Termin" }),
    el("button", { class: "modal-link", text: "Sichern", on: { click: handleSave } }),
  ]);

  const body = el("div", { class: "modal-body" }, [
    // Hinweis, falls Nur-Lesen aktiv ist (Aenderungen bleiben lokal).
    settings.readOnly
      ? el("div", { class: "empty-hint", style: { padding: "0 0 12px", "text-align": "left", color: "var(--text-secondary)" },
          text: "Nur-Lesen ist aktiv: Änderungen bleiben lokal und werden NICHT an mailbox.org gesendet." })
      : null,

    field("Titel", titleInput),
    field("Kategorie", categoryPicker),

    el("div", { class: "switch-row" }, [
      el("div", {}, [
        el("div", { class: "switch-label", text: "Ganztägig" }),
      ]),
      el("label", { class: "switch" }, [allDayCheckbox, el("span", { class: "slider" })]),
    ]),

    field("Beginn", el("div", { class: "form-inline" }, [startDateInput])),
    el("div", { class: "form-row" }, [timeFields]),
    field("Ende", el("div", { class: "form-inline" }, [endDateInput])),

    field("Erinnerung", reminderSelect),
    field("Wiederholung", recurrenceSelect),

    // Hinweis, wenn ein Serientermin bearbeitet wird.
    isSeries
      ? el("div", { class: "switch-desc", style: { "margin": "-6px 0 12px" },
          text: "Dies ist ein Serientermin – Änderungen gelten für die ganze Reihe." })
      : null,

    field("Ort", locationInput),
    field("Notizen", notesInput),

    // Loeschen-Knopf nur beim Bearbeiten anzeigen.
    !isNew
      ? el("button", { class: "btn-secondary", style: { color: "#d64545", "margin-top": "16px" },
          text: "🗑  Termin löschen", on: { click: handleDelete } })
      : null,
  ]);

  openModal(el("div", {}, [header, body]));
}

/* -------------------------------------------------------------------------- */
/*  Hilfen                                                                     */
/* -------------------------------------------------------------------------- */

/** Baut eine beschriftete Formularzeile. */
function field(labelText, inputNode) {
  return el("div", { class: "form-row" }, [
    el("label", { text: labelText }),
    inputNode,
  ]);
}

/** Standard-Startzeit fuer neue Termine: derselbe Tag um 8:00 Uhr. */
function defaultStartTime(date) {
  const d = new Date(date);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** Auswahlmoeglichkeiten fuer Erinnerungen (Minuten vor Beginn). */
const REMINDER_OPTIONS = [
  { value: -1, label: "Keine Erinnerung" },
  { value: 0, label: "Zur Startzeit" },
  { value: 5, label: "5 Minuten vorher" },
  { value: 10, label: "10 Minuten vorher" },
  { value: 15, label: "15 Minuten vorher" },
  { value: 30, label: "30 Minuten vorher" },
  { value: 60, label: "1 Stunde vorher" },
  { value: 120, label: "2 Stunden vorher" },
  { value: 1440, label: "1 Tag vorher" },
];

/** Auswahlmoeglichkeiten fuer die Wiederholung (Serientermine). */
const RECURRENCE_OPTIONS = [
  { value: "", label: "Keine Wiederholung" },
  { value: "FREQ=DAILY", label: "Täglich" },
  { value: "FREQ=WEEKLY", label: "Wöchentlich" },
  { value: "FREQ=MONTHLY", label: "Monatlich" },
  { value: "FREQ=YEARLY", label: "Jährlich" },
];
