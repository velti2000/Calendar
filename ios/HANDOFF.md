# Übergabe / Kontext für neue Chat-Sitzung

Kurzkontext, damit eine neue Sitzung sofort weiterarbeiten kann. (Details stehen
zusätzlich in der automatischen Projekt-Erinnerung und in der README.md.)

## Was es ist
Native iOS-Kalender-App **„Calzi"** in `ios/`: **React Native + Expo SDK 54**
(RN 0.81.5), TypeScript. Portierung der PWA aus `../pwa/`. Anbindung mailbox.org
per CalDAV. (App-Name `expo.name` = "Calzi"; `slug` bleibt "kalender". Name-/
Icon-Aenderung wirkt erst nach NATIVEM Rebuild `npx expo run:ios`, nicht per `r`.)

## HARTE Einschränkung (nicht ändern!)
Nutzer hat **MacBook Air 2020 (Intel), macOS 15, Xcode 16.4** (= Swift 6.1).
macOS 26 / Xcode 26 laufen auf Intel NICHT → **Expo SDK darf höchstens 54 sein**
(SDK 56+ braucht Swift 6.2). Kein SDK-Upgrade vorschlagen.

## Starten / Testen
- **JS-Änderungen** (das meiste): im laufenden `npx expo start`-Terminal **`r`** drücken.
- **Native Änderungen** (neues Modul, Icon, Info.plist): `npx expo run:ios` (voller Rebuild).
- Build muss OHNE Sandbox laufen (CocoaPods braucht Netz); `LANG=en_US.UTF-8 CI=1`.
- Aufs echte iPhone (iOS 26): lokal NUR über AltStore/AltServer (gratis, 7 Tage) oder
  EAS Build (braucht 99-€-Account). Direkt per Xcode geht nicht (Intel/iOS-26-Sperre).
- Verifikation in dieser Repo: `./node_modules/.bin/tsc --noEmit` und
  `npx expo export --platform ios --output-dir /tmp/x` (beide müssen durchlaufen).

## Funktionsstand (alles fertig & getestet)
- Monats-, **Wochen-** und **Tagesansicht** (Stundenraster). Tagesansicht: horizontal
  **wischen** = Tag wechseln; Wochenansicht: durchgehende Schraffur über alle 7 Spalten.
- CalDAV-Sync + Schreiben (mailbox.org); Termin-Editor mit Serienterminen (RRULE),
  Erinnerungen (inkl. „frei einstellbar" Wählräder), Mehrtages-Balken, Datum-Springen.
- **Todoist** (nur lesen, API v1) und **iPhone-Erinnerungen** (nur lesen, expo-calendar)
  als farbige Overlays; Farbe je Quelle wählbar.
- **Zeitphasen** (3, nur Tag/Woche): farbig + diagonal schraffiert, halbstundengenau,
  über Mitternacht möglich (`utils/timeBands.ts`, `components/HatchBand.tsx`).
- Einstellbar: Theme, Nav-Position, Schriftgröße Termine, Start-Stunde Tag/Woche.

## Serien-Vorkommen löschen: TZID/EXDATE (2026-06-18, Teil 3)
Einzelnes Vorkommen aus einer **vom Server geladenen** Serie löschen -> HTTP 400
`CAL-4061` ("targeted occurrence is not part of the appointment series"). Bei
Calzi-eigenen Serien ging es. Ursache: Server-Serien haben `DTSTART;TZID=Europe/
Berlin:` (lokale Wandzeit); OX identifiziert das zu löschende Vorkommen über die
Recurrence-ID in DIESER TZID. Wir schrieben EXDATE aber in UTC (`…Z`) -> kein Match.
- **Fix** (`data/ical.ts` + `types.ts`): `CalEvent.tzid` beim Parsen merken
  (DTSTART-TZID); buildICalendar schreibt DTSTART/DTEND/EXDATE dann in TZID-Form
  mit lokaler Wandzeit (`formatLocalNaive`) statt UTC. Ohne tzid (UTC-/Calzi-
  Termine) bleibt alles wie bisher in UTC. Annahme: Geräte-TZ == Serien-TZ
  (gilt fuer den Nutzer); kein VTIMEZONE mitgeschrieben (OX kennt Olson-TZIDs).
- FALLS WEITER Fehler: Server-Antworttext steht in der Meldung -> schicken.

## Kalenderfarben + Serien-Erinnerungen (2026-06-18, Teil 2)
- **Kalenderfarbe änderbar**: in Einstellungen → KALENDER auf den Farbpunkt
  tippen -> ColorRow klappt auf. Store-Action `setCalendarColor(id,color)`
  setzt cal.color sofort UND merkt sie in `settings.calendarColorOverrides`
  (id->hex). `syncFromServer` wendet die Overrides an (Vorrang vor Server-Farbe),
  damit die Wahl den Sync überlebt – analog zu `visible`.
- **Serien-Erinnerungen in Monatsansicht ausblenden**: neuer Schalter
  `settings.hideRecurringRemindersInMonth` (Einstellungen → iPHONE-ERINNERUNGEN).
  MonthScreen filtert dann Erinnerungs-Overlays mit `recurringMaster`/`rrule`
  heraus; Tag/Woche zeigen sie weiterhin.

## Erinnerungen + Wochenansicht (2026-06-18)
- **iPhone-Erinnerungen, erledigte ausblenden**: `data/appleReminders.ts` lud
  ALLE (auch erledigte!). Fix: `getRemindersAsync(..., null, ...)` (Status NULL!)
  + Filter `if (r.completed) return null` in mapReminder. WICHTIG: Status
  `ReminderStatus.INCOMPLETE` NICHT nutzen – expo-calendar verlangt dann zwingend
  start-/endDate (sonst Laufzeitfehler "must be called with a startDate") und
  verschluckt datumslose/wiederkehrende. (Gelöschte gibt EventKit eh nicht zurück.)
- **Sync-Button für Erinnerungen** in Einstellungen → iPHONE-ERINNERUNGEN
  („Erinnerungen jetzt aktualisieren", ruft `syncReminders`).
- **Wochenansicht – Mehrtages-Balken**: ganztägige Termine über mehrere Tage
  laufen jetzt als durchgehender Balken (eigene `computeWeekBars`/`isMultiDayAllDay`
  in `WeekScreen.tsx`, gleiche Logik wie Monatsansicht; absolute Balken über den
  7 Spalten via gemessener `colWidth`; eintägige bleiben Chips).
- **Wochenansicht – Wochen-Wischen** mit Entprellung: Gesture.Pan wie in
  DayScreen (`swipingRef`, `activeOffsetX`, `failOffsetY`, 150ms-onFinalize) →
  links/rechts wechselt die Woche, ohne den „neuer Termin"-Dialog auszulösen.

## 412 CAL-4121 – ECHTE URSACHE: SEQUENCE (2026-06-17, Teil 4)
Frischer ETag (Teil 3) hat den Konflikt NICHT geloest -> es ist KEIN HTTP-ETag-
Problem. Open-Xchange prueft die **iCalendar-`SEQUENCE`** (Revisionsnummer):
unser `buildICalendar` schrieb gar keine SEQUENCE (=0). Ein schon einmal
geaenderter Server-Termin hat SEQUENCE>=1 -> beim Zurueckschreiben mit 0 meldet
OX "newer version exists" (CAL-4121).
- **Fix**: `CalEvent.sequence` (neu in types.ts), beim Parsen mitgelesen
  (`data/ical.ts` finishEvent), beim Schreiben ausgegeben als `SEQUENCE` +
  `LAST-MODIFIED` (buildICalendar). In `store/useStore.ts` pushEventToServer
  wird SEQUENCE VOR jedem PUT **hochgezaehlt** (+1) -> immer >= Server-Stand.
- Der fetchCurrentEtag-Retry aus Teil 3 bleibt als Fallback fuer echte
  ETag-Konflikte erhalten.
- FALLS WEITER 412: Server-Antworttext steht in der Fehlermeldung -> schicken.

## 412-WURZEL (Teilschritt) (2026-06-17, Teil 3)
mailbox.org läuft auf **Open-Xchange (OX)**, NICHT SabreDAV. Server-Antwort bei
412 war `CAL-4121: a newer version already exists` = **Versionskonflikt**. OX
vergibt ETags teils neu, sodass der beim Sync gespeicherte ETag schon veraltet
ist – und ein PUT/DELETE GANZ OHNE If-Match lehnt OX ebenfalls ab.
- **Fix in `data/caldav.ts`**: bei 412 holt `fetchCurrentEtag()` den AKTUELLEN
  ETag der Ressource per PROPFIND (Tiefe 0); PUT/DELETE wird damit als frisches
  If-Match wiederholt ("meine Änderung gewinnt"). Ersetzt die alte
  "ohne If-Match wiederholen"-Logik (funktioniert bei OX NICHT).
- (Die EXDATE-ohne-RRULE-Korrektur unten bleibt sinnvoll, war aber nicht die
  Ursache für CAL-4121.)

## Zuletzt geändert (2026-06-17, Teil 2)
- **412 (erste Annahme)**: 412 kann bei CalDAV auch eine INHALTS-Vorbedingung
  sein. **EXDATE ohne RRULE** ist ungültiges iCalendar → `data/ical.ts` schreibt
  EXDATE jetzt nur noch mit RRULE; der Editor leert `exdates` beim Umwandeln
  Serie→Einzeltermin. `data/caldav.ts` zeigt den **Server-Antworttext** in der
  Fehlermeldung (so wurde CAL-4121 ueberhaupt sichtbar).
- **WICHTIG – Icon/Name aktualisieren**: Änderungen an `app.json` (Name „Calzi",
  Icon) landen NICHT automatisch im nativen Xcode-Projekt (`ios/ios/`). Nötig:
  `npx expo prebuild --clean` (regeneriert Info.plist + Icons aus app.json),
  danach `npx expo run:ios` bzw. Xcode-Build/AltStore. Ohne Prebuild bleibt die
  App „Kalender". (Bundle-ID net.gmx.velti2000.kalender bleibt.)
- **Standardkalender**: `settings.defaultCalendarId` (neu). In Einstellungen →
  KALENDER per ★ markierbar; im „Neuer Termin"-Dialog ist dieser Kalender
  vorausgewählt (EventEditor `defaultCalId`).
- **„Speichern"** steht jetzt oben rechts in der Editor-Kopfleiste (`headerRight`
  via `saveRef`, vermeidet veraltete Closure); der untere Speichern-Button entfiel.
- **Styles dokumentiert**: MonthScreen/DayScreen/EventEditor-StyleSheets sind
  durchkommentiert (welcher Eintrag steuert was) – für eigenes UI-Finetuning.

## Zuletzt behoben (2026-06-17)
- CalDAV-Schreiben warf HTTP **412** beim Aendern server-synchronisierter
  Termine/Serien (ETag-Konflikt). Fix in `data/caldav.ts`: bei 412 wird der
  PUT/DELETE EINMAL ohne `If-Match` wiederholt (Last-Write-Wins, Einzel-Nutzer);
  ETag-Auslesen robust gemacht (`readEtag`, Objekt-`#text` + trim).
- Erinnerungszeit aus Sync ging verloren: VALARM-`TRIGGER`-Parser in `data/ical.ts`
  neu (vollstaendige ISO-8601-Dauer `-P1W/-P1D/-PT1H30M/...` + absolute DATE-TIME).
- Monatsansicht: Ganztagestermine ruecken pro Tag korrekt hoch (Balken-Platz jetzt
  **pro Spalte** via `lanesByDay`); Ganztages-Box/Top-Leiste flacher, Nav-Leiste ~20% flacher.
  Mehrtages-Balken ebenfalls flacher (`BAR_H` 15→13, passend zur Ganztages-Box).
- Termin-Editor: ScrollView mit `automaticallyAdjustKeyboardInsets` -> Notizfeld
  bleibt bei offener Tastatur sichtbar.

## Wichtige Stolperfallen (gelöst, zur Erinnerung)
- Neue `settings`-Felder: `useStore` hat ein `merge` in der persist-Config (sonst sind
  neue Felder bei altem Speicher `undefined` → NaN). Trotzdem in Consumern `?? default`.
- expo-calendar braucht ALLE 4 Usage-Descriptions in `app.json ios.infoPlist`
  (NSReminders…/NSCalendars…, je FullAccess + Legacy), sonst Start-Crash.
- Hermes parst manche ISO-Daten nicht (Todoist) → eigener Parser in `data/todoist.ts`.
- Schraffur NICHT per Image+tintColor+repeat (iOS-Bug: nur 1 Kachel) → rotierte Views.

## Offene Punkte / Ideen
- Mehrsprachigkeit (i18n), volle Zeitzonen-Unterstützung, iPad-Layout.
- Background-Sync (braucht natives Modul + Rebuild).
- Einzelne Serien-Vorkommen ÄNDERN (RECURRENCE-ID); Löschen geht schon (EXDATE).
- App-Icon „Calzi" (Kalenderkarte + korallenrote „C"-Kachel) liegt in
  `assets/icon.png`, erzeugt mit `tools/make_icon.py` (Pillow im venv:
  `tools/venv/bin/python tools/make_icon.py assets/icon.png`; `tools/venv/`
  ist in `.gitignore`). Icon-Aenderung braucht nativen Rebuild (`expo run:ios`).
