# Übergabe / Kontext für neue Chat-Sitzung

Kurzkontext, damit eine neue Sitzung sofort weiterarbeiten kann. (Details stehen
zusätzlich in der automatischen Projekt-Erinnerung und in der README.md.)

## Was es ist
Native iOS-Kalender-App in `ios/`: **React Native + Expo SDK 54** (RN 0.81.5),
TypeScript. Portierung der PWA aus `../pwa/`. Anbindung mailbox.org per CalDAV.

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
- App-Icon liegt in `assets/icon.png` (erzeugt mit `tools/make_icon.py`).
