/*
 * types.ts  –  zentrale Datentypen der App
 * ==========================================================================
 * Die Struktur ist bewusst identisch zur PWA (pwa/js/data/demoData.js),
 * damit die Logik 1:1 uebernommen werden konnte.
 */

/** Kalender = Kategorie = "Sub-Kalender" eines Accounts. */
export interface Calendar {
  id: string;          // eindeutige Kennung (bei CalDAV: die Kalender-URL)
  name: string;        // Anzeigename, z.B. "Termine Thomas"
  color: string;       // Farbe (Hex), bestimmt das Aussehen der Termine
  visible: boolean;    // Termine dieses Kalenders anzeigen?
  url?: string;        // CalDAV-Adresse (fuer den Sync)
  readOnly?: boolean;  // manche Kalender (z.B. Feiertage) sind nur lesbar
}

/** Termin (Event). */
export interface CalEvent {
  uid: string;            // eindeutige Kennung (in CalDAV der UID)
  calendarId: string;     // zu welchem Kalender der Termin gehoert
  title: string;
  allDay: boolean;
  start: string;          // ISO-String des Beginns
  end: string;            // ISO-String des Endes
  location?: string;
  notes?: string;
  reminders?: number[];   // Erinnerungen in Minuten vor Beginn
  rrule?: string | null;  // Wiederholungsregel (Serientermin), z.B. "FREQ=WEEKLY"
  exdates?: string[];     // ausgenommene Tage einer Serie ("YYYY-MM-DD")
  recurringMaster?: string; // bei aufgeloesten Vorkommen: UID des Originals
  // Felder fuer den CalDAV-Sync:
  href?: string;          // Server-Adresse der .ics-Ressource
  etag?: string;          // Versionskennung (optimistische Sperre, HTTP-Ebene)
  // iCalendar-SEQUENCE (Revisionsnummer des Termins). Open-Xchange (mailbox.org)
  // prueft diese beim Schreiben: ein Update MUSS eine >= so hohe SEQUENCE haben
  // wie die gespeicherte, sonst HTTP 412 CAL-4121 ("newer version exists").
  sequence?: number;
  // Zeitzone (TZID) des Serien-/Termin-Beginns, wie vom Server geliefert
  // (z.B. "Europe/Berlin"). Wird beim Zurueckschreiben fuer DTSTART/DTEND/EXDATE
  // beibehalten, damit Open-Xchange die Vorkommen einer Serie wiedererkennt
  // (EXDATE muss exakt der Recurrence-ID in dieser TZID entsprechen → CAL-4061).
  // Fehlt (z.B. bei UTC-/Calzi-eigenen Terminen) -> Schreiben in UTC.
  tzid?: string;
  // Felder fuer externe, NUR-LESENDE Quellen (z.B. Todoist). Solche Eintraege
  // werden niemals zum CalDAV-Server geschrieben oder im Editor geaendert.
  source?: "todoist" | "reminders"; // Herkunft (fehlt = normaler Kalendertermin)
  color?: string;         // eigene Farbe des Eintrags (ueberschreibt Kalenderfarbe)
  externalUrl?: string;   // Link in die Quelle (z.B. Aufgabe in der Todoist-App)
}

/**
 * Eine farbig hinterlegte Zeitphase (nur Tages-/Wochenansicht), z.B. eine
 * Müdigkeits-, Schlaf- oder Nachtphase. Stundengenau. Phasen ueber Mitternacht
 * sind erlaubt (endHour <= startHour, z.B. 22–6 Uhr).
 */
export interface TimeBand {
  enabled: boolean;
  startHour: number;  // 0–23
  endHour: number;    // 1–24 (24 = Mitternacht)
  color: string;
}

/** Einstellungen der App. */
export interface Settings {
  theme: "auto" | "light" | "dark";
  navPosition: "bottom" | "top";   // Position der Navigationsleiste
  // Standardkalender (Kategorie), der im "Neuer Termin"-Dialog vorausgewaehlt
  // ist. Leer/unbekannt -> es wird der erste sichtbare Kalender genommen.
  defaultCalendarId?: string;
  eventFontSize: number;           // Schriftgroesse der Termine (Monatsansicht)
  dayStartHour: number;            // Stunde (0–23), zu der Tag/Woche beim Oeffnen scrollt
  timeBands: TimeBand[];           // farbige Zeitphasen (nur Tag/Woche), genau 3
  readOnly: boolean;               // Sicherheit: keine Server-Schreibzugriffe
  defaultReminder: number;         // Standard-Erinnerung in Minuten (-1 = keine)
  notificationsEnabled: boolean;
  dataSource: "demo" | "caldav";
  // Benutzername fuer mailbox.org. Das PASSWORT liegt NICHT hier, sondern
  // sicher im iOS-Schluesselbund (expo-secure-store) – siehe store/useStore.ts.
  username: string;
  // Todoist-Aufgaben (mit Faelligkeit) NUR LESEND im Kalender anzeigen.
  // Das API-Token liegt im Schluesselbund, nicht hier.
  todoistEnabled: boolean;
  todoistColor: string;            // Farbe der Todoist-Eintraege
  // iPhone-Erinnerungen (Apple "Erinnerungen") NUR LESEND anzeigen.
  remindersEnabled: boolean;
  remindersColor: string;          // Farbe der Erinnerungs-Eintraege
  // Serien-Erinnerungen (wiederkehrende iPhone-Erinnerungen) in der
  // MONATSANSICHT ausblenden (Tag/Woche zeigen sie weiterhin).
  hideRecurringRemindersInMonth: boolean;
  // Vom Nutzer gewaehlte Kalenderfarben (Kalender-id -> Hex). Ueberschreibt die
  // vom Server gelieferte Farbe und bleibt ueber den Sync hinweg erhalten.
  calendarColorOverrides: Record<string, string>;
}
