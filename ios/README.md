# Kalender – native iOS-App (React Native + Expo)

Die native Version der Kalender-PWA (siehe `../pwa/`) im **CalenGoo-Stil** mit
direkter **CalDAV-Anbindung an mailbox.org** – ohne PHP-Proxy.

> **Stand:** Projektgerüst mit allen Kern-Bausteinen. Die App startet mit
> **Demo-Daten** (wie die PWA). CalDAV-Sync, Serientermine und lokale
> Benachrichtigungen sind eingebaut und können in den Einstellungen
> aktiviert werden.

---

## Was ist anders als bei der PWA?

| Thema | PWA | Native App |
|---|---|---|
| CalDAV-Zugriff | über PHP-Proxy (CORS) | **direkt** zu `https://dav.mailbox.org/` |
| Passwort | localStorage (unverschlüsselt) | **iOS-Schlüsselbund** (expo-secure-store) |
| Erinnerungen | nur bei geöffneter App | **echte iOS-Benachrichtigungen**, auch bei geschlossener App |
| Installation | „Zum Home-Bildschirm“ | echte App (Simulator / TestFlight / App Store) |

---

## Projektaufbau

```
ios/
├── App.tsx                       Einstiegspunkt + Navigation
├── app.json                      App-Konfiguration (Name, Bundle-ID, Plugins)
├── src/
│   ├── types.ts                  zentrale Datentypen (Calendar, CalEvent, Settings)
│   ├── navigation/index.ts       Screen-Namen + Parameter (typsicher)
│   ├── theme/
│   │   ├── index.ts              Farben hell/dunkel
│   │   └── useTheme.ts           liefert das aktive Farbschema
│   ├── utils/dates.ts            Datums-Helfer (KW, Monatsraster, deutsch)
│   ├── data/
│   │   ├── demoData.ts           Beispiel-Kalender und -Termine
│   │   ├── ical.ts               iCalendar lesen/schreiben + RRULE auflösen
│   │   └── caldav.ts             CalDAV-Client (direkt, Basic Auth)
│   ├── store/useStore.ts         zentraler Datenspeicher (zustand + AsyncStorage)
│   ├── notifications/reminders.ts lokale Erinnerungen (expo-notifications)
│   └── screens/
│       ├── MonthScreen.tsx       Monatsansicht (CalenGoo-Stil, KW-Spalte, Wischen)
│       ├── DayScreen.tsx         Tagesansicht + "+" für neue Termine
│       ├── EventEditorScreen.tsx Termin anlegen/ändern/löschen
│       ├── SearchScreen.tsx      Suche (Titel, Ort, Notizen)
│       └── SettingsScreen.tsx    Einstellungen inkl. mailbox.org-Konto
└── README.md                     diese Datei
```

## Wichtigste Abhängigkeiten

- **expo** (SDK 56) + **react-native** – das App-Grundgerüst
- **@react-navigation/native-stack** – Wechsel zwischen den Ansichten
- **zustand** + **@react-native-async-storage/async-storage** – Datenspeicher mit Persistenz
- **expo-secure-store** – Passwort sicher im iOS-Schlüsselbund
- **expo-notifications** – Termin-Erinnerungen als echte Benachrichtigungen
- **fast-xml-parser** – liest die XML-Antworten des CalDAV-Servers
- **@react-native-community/datetimepicker** – native Datums-/Zeiträder
- **react-native-gesture-handler** – Wischen zwischen Monaten

---

## Ausprobieren (auf dem Mac)

```bash
cd ios
npm install          # nur beim ersten Mal
npx expo start
```

Dann gibt es zwei Wege:

1. **iPhone-Simulator** (braucht Xcode aus dem Mac App Store):
   im Terminal `i` drücken.
2. **Echtes iPhone**: die App **Expo Go** aus dem App Store laden und den
   QR-Code aus dem Terminal mit der Kamera scannen.
   *Hinweis:* Geplante Benachrichtigungen funktionieren in Expo Go nur
   eingeschränkt – voll erst mit einem Development Build (siehe unten).

## mailbox.org verbinden

1. Bei mailbox.org ein **App-Passwort** anlegen (nicht das Hauptpasswort).
2. In der App: **⚙︎ Einstellungen → MAILBOX.ORG** → E-Mail + App-Passwort
   eintragen → **„Verbindung testen“** → **„Jetzt synchronisieren“**.
3. Der Schalter **Nur-Lesen** ist anfangs **an** – die App schreibt dann
   nichts auf den Server (Sync nur Server → App).

## Aufs echte iPhone bringen (später)

Für den App Store / TestFlight braucht es einen **Development Build** über
EAS (Expo Application Services) und eine Apple-Developer-Mitgliedschaft:

```bash
npx eas build --platform ios
```

Das machen wir gemeinsam, wenn die App so weit ist.

---

## Serientermine

Der Termin-Editor unterstützt unter „Wiederholung“:

- **Frequenz + Intervall:** täglich/wöchentlich/monatlich/jährlich, „alle X …“
- **Wochentage** (bei wöchentlich): nur Mo/Mi/Fr usw.
- **Monatlich:** am N. Tag des Monats, am „2. Donnerstag“ oder am
  „letzten Donnerstag“ (abgeleitet vom Startdatum)
- **Ende:** nie · nach X Terminen · bis Datum

Alles wird als Standard-iCalendar-RRULE gespeichert und ist damit voll
CalDAV-/mailbox.org-kompatibel (auch andere Apps zeigen die Serie korrekt).

## Erledigt / Nächste Schritte

- [x] Schreiben zum Server (anlegen/ändern/löschen → CalDAV PUT/DELETE),
      sobald Nur-Lesen aus ist; bei Kalenderwechsel wird verschoben
- [x] „Zu Datum springen“ (Auswahlräder, 📅 in der Navigationsleiste)
- [x] Mehrtages-Termine als durchgehender Balken in der Monatsansicht
- [x] Erweiterte Serientermine (Intervall, Wochentage, Ende, N-ter Wochentag)
- [x] Einzelne Vorkommen einer Serie löschen („Nur diesen Termin" → EXDATE,
      wird auch zum Server geschrieben)
- [x] Automatischer Sync beim App-Start (still; Fehler werden nicht gemeldet,
      manueller Sync weiter in den Einstellungen)
- [x] Schriftgröße der Termine in den Einstellungen einstellbar
- [x] Tagesansicht als Stundenraster (0–24 Uhr) mit Termin-Blöcken nach Dauer,
      parallele Termine nebeneinander, Ganztages-Reihe oben, „Jetzt"-Linie;
      Tippen auf eine Stunde legt dort einen Termin an
- [x] Wochenansicht (7 Tage nebeneinander, gleiche Logik wie Tagesansicht;
      Überlappungs-/Ganztages-Logik geteilt in `utils/timeline.ts`).
      Öffnen durch Tippen auf die KW-Zahl in der Monatsansicht
- [x] Start-Stunde für Tages-/Wochenansicht in den Einstellungen wählbar
- [x] Todoist NUR LESEND als Overlay (Aufgaben mit Fälligkeit):
      API-Token im Schlüsselbund, Schalter in den Einstellungen, Antippen zeigt
      Info + „In Todoist öffnen". Schreibt nie nach Todoist; `source:"todoist"`
      hält die Einträge aus CalDAV-Schreibpfad und Editor heraus
- [x] iPhone-„Erinnerungen" NUR LESEND als Overlay (via expo-calendar, EventKit):
      Schalter + Berechtigung in den Einstellungen, `source:"reminders"`.
      Braucht NATIVEN Rebuild (neues Modul) – JS-Reload reicht NICHT
- [x] Farbe für Todoist- und Erinnerungs-Overlays in den Einstellungen wählbar
      (Farbpaletten-Auswahl); externe Einträge tragen ihre Farbe im `color`-Feld
- [x] App-Icon (Kalendermotiv im App-Blau, erzeugt mit `tools/make_icon.py`)
- [ ] Hintergrund-Sync (Background Fetch), damit Erinnerungen auch für neue
      Server-Termine geplant werden, ohne die App zu öffnen
- [ ] Einzelne Vorkommen einer Serie ÄNDERN (abweichende Uhrzeit/Titel nur an
      einem Tag – „RECURRENCE-ID") – löschen geht bereits
