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
  etag?: string;          // Versionskennung (optimistische Sperre)
}

/** Einstellungen der App. */
export interface Settings {
  theme: "auto" | "light" | "dark";
  navPosition: "bottom" | "top";   // Position der Navigationsleiste
  eventFontSize: number;           // Schriftgroesse der Termine (Monatsansicht)
  readOnly: boolean;               // Sicherheit: keine Server-Schreibzugriffe
  defaultReminder: number;         // Standard-Erinnerung in Minuten (-1 = keine)
  notificationsEnabled: boolean;
  dataSource: "demo" | "caldav";
  // Benutzername fuer mailbox.org. Das PASSWORT liegt NICHT hier, sondern
  // sicher im iOS-Schluesselbund (expo-secure-store) – siehe store/useStore.ts.
  username: string;
}
