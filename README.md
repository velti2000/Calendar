# Calendar

Eine **Progressive Web App (PWA)** im Stil von *CalenGoo* mit Anbindung an
**mailbox.org** (CalDAV). Gebaut mit reinem HTML/CSS/JavaScript – **ohne
Build-Schritt**, damit der Code gut lesbar und einfach zu veröffentlichen ist.

> **Stand:** Die komplette Oberfläche läuft mit **Demo-Daten**. Die Anbindung an
> mailbox.org ist vorbereitet (Proxy + CalDAV-Client) und muss nur noch
> konfiguriert und getestet werden – siehe unten.

---

## Funktionen

- **Monatsansicht** (Standard) im CalenGoo-Look:
  - Ganztagestermine sind **farbig hinterlegt**.
  - Zeit-Termine haben **weißen Hintergrund**, nur der Text ist in der
    Kategoriefarbe (plus farbiger Punkt).
- **Tagesansicht**: öffnet sich durch Tippen auf einen Tag; dort Termine
  ansehen, ändern oder über „+" neu anlegen.
- **Mehrere Kalender/Kategorien** eines Kontos (z. B. „Termine Thomas",
  „Kinder", „Geburtstage", „Arbeit") mit eigenen Farben, einzeln ein-/ausblendbar.
- **Termin-Editor**: Titel, Kategorie, ganztägig, Beginn/Ende, Erinnerung, Ort, Notizen.
- **Löschen mit Bestätigungs-Popup**.
- **Suche** (über die Lupe) über Titel, Ort und Notizen.
- **Dark Mode**: automatisch (System), hell oder dunkel erzwingbar.
- **Lokale Erinnerungen** (Benachrichtigungen).
- **Sicherheits-Schalter „Nur-Lesen"** (standardmäßig **an**): verhindert
  jegliche Änderung auf dem Server. Sync läuft dann nur **Server → App**.

---

## Projektaufbau

```
Calendar/
├── index.html              App-Grundgerüst
├── manifest.webmanifest    PWA-Manifest (Name, Icons, Farben)
├── sw.js                   Service Worker (Offline + Benachrichtigungen)
├── css/
│   └── styles.css          gesamtes Design inkl. Dark Mode
├── js/
│   ├── app.js              Steuerung / Einstiegspunkt
│   ├── store.js            zentraler Datenspeicher (+ localStorage)
│   ├── ui.js               Dialoge, Bestätigungen, Toasts
│   ├── reminders.js        lokale Erinnerungen
│   ├── data/
│   │   ├── demoData.js     Beispiel-Kalender und -Termine
│   │   ├── dataSource.js   Vermittler Demo ⇄ CalDAV
│   │   ├── caldav.js       CalDAV-Client (über den Proxy)
│   │   └── ical.js         iCalendar (.ics) lesen/schreiben
│   ├── utils/
│   │   ├── dates.js        Datums-Helfer
│   │   └── dom.js          kleine HTML-Bau-Helfer
│   └── views/
│       ├── monthView.js    Monatsansicht
│       ├── dayView.js      Tagesansicht
│       ├── eventEditor.js  Termin anlegen/ändern/löschen
│       ├── searchView.js   Suche
│       └── settingsView.js Einstellungen
├── icons/                  App-Icons (PNG)
├── proxy/
│   └── caldav-proxy.php    PHP-Proxy für deinen Webserver
└── README.md               diese Datei
```

---

## Lokal ausprobieren (auf dem Mac)

Die App nutzt JavaScript-Module (`import`/`export`). Diese funktionieren **nur
über einen Webserver**, **nicht** per Doppelklick auf `index.html`
(`file://` wird vom Browser blockiert).

Starte im Projektordner einen kleinen lokalen Server – wähle **eine** Variante:

```bash
# Variante A: mit PHP (falls installiert) – kann später auch den Proxy testen
php -S localhost:8000

# Variante B: mit Python 3 (auf dem Mac vorinstalliert)
python3 -m http.server 8000
```

Dann im Browser öffnen: **http://localhost:8000**

Du solltest sofort die Monatsansicht mit Demo-Terminen sehen.

---

## Auf dem iPhone installieren (als App)

1. Lege die App auf einem über **HTTPS** erreichbaren Webserver ab (PWAs
   brauchen HTTPS; `localhost` ist die einzige Ausnahme).
2. Öffne die Adresse in **Safari** auf dem iPhone.
3. Tippe auf **Teilen → „Zum Home-Bildschirm"**.
4. Starte die App vom Home-Bildschirm – sie läuft dann im Vollbild wie eine App.

> **Hinweis Benachrichtigungen:** Auf dem iPhone erscheinen lokale Erinnerungen
> zuverlässig nur, solange die (vom Home-Bildschirm gestartete) App läuft. iOS
> unterstützt keine geplanten Hintergrund-Benachrichtigungen für Web-Apps.
> Für Erinnerungen bei geschlossener App wäre **echtes Web-Push über einen
> Server** nötig (möglicher späterer Ausbau).

---

## mailbox.org anbinden (CalDAV) — Schritt für Schritt

### 1. App-Passwort bei mailbox.org anlegen
Verwende **nicht** dein Hauptpasswort, sondern ein eigenes:
- mailbox.org → Einstellungen → Passwörter/Sicherheit → **App-Passwort** erstellen.

### 2. Den PHP-Proxy hochladen
- Lade die Datei `proxy/caldav-proxy.php` auf deinen Webserver (mit PHP).
- Notiere dir die öffentliche Adresse, z. B.
  `https://deinserver.de/calendar/caldav-proxy.php`.
- Voraussetzung: PHP mit **cURL** (bei den meisten Hostern Standard).

### 3. In der App eintragen
Öffne **Einstellungen** (Zahnrad) und trage ein:
- **Proxy-/Server-URL:** die Adresse aus Schritt 2.
- **Benutzername:** deine mailbox.org-E-Mail.
- **Passwort:** das App-Passwort aus Schritt 1.

Danach:
- **„Verbindung testen"** → sollte „Verbindung OK" melden.
- **„Jetzt synchronisieren (Server → App)"** → lädt deine echten Kalender und Termine.

> Damit die App CalDAV statt Demo nutzt, muss `settings.dataSource` auf
> `"caldav"` stehen. Aktuell ist „demo" voreingestellt. Sobald die Verbindung
> steht, kann das in `js/store.js` (Funktion `defaultSettings`) bzw. über eine
> kleine Ergänzung in den Einstellungen umgestellt werden – sag Bescheid, dann
> baue ich dafür einen Umschalter ein.

### Sicherheit „Nur-Lesen"
Der Schalter **Nur-Lesen** ist anfangs **an**. So kann nichts versehentlich auf
dem Server verändert werden. Zum Anlegen/Ändern/Löschen auf dem Server schaltest
du ihn (nach Rückfrage) in den Einstellungen aus.

---

## Was du noch selbst tun musst — Checkliste

- [ ] **Ausprobieren:** lokalen Server starten und die App im Browser öffnen
      (siehe „Lokal ausprobieren").
- [ ] **App-Passwort** bei mailbox.org anlegen.
- [ ] **`caldav-proxy.php`** auf deinen PHP-Webserver hochladen (per HTTPS erreichbar).
- [ ] **Frontend hochladen:** den restlichen Ordner (alles außer `proxy/`) auf
      denselben Webserver legen, damit die App über HTTPS erreichbar ist.
- [ ] In den **Einstellungen** Proxy-URL + Zugangsdaten eintragen und
      „Verbindung testen".
- [ ] Auf dem **iPhone** über Safari „Zum Home-Bildschirm" hinzufügen.
- [ ] Mir Rückmeldung geben, dann bauen wir den **CalDAV-Echtbetrieb** scharf
      (Umschalter Demo→CalDAV, Test mit echten Daten, Feinschliff).

---

## Auf GitHub speichern (für Einsteiger)

Das Projekt ist bereits ein Git-Repository und mit
`https://github.com/velti2000/Calendar.git` verbunden. So speicherst du deinen
Stand online (im Terminal, im Projektordner):

```bash
# 1. Welche Dateien haben sich geändert?
git status

# 2. Alle Änderungen vormerken
git add -A

# 3. Mit einer kurzen Beschreibung "festschreiben"
git commit -m "Erste Version der Kalender-App"

# 4. Zu GitHub hochladen
git push
```

> Beim ersten `git push` fragt GitHub nach Anmeldedaten. Empfehlung: ein
> **Personal Access Token** (GitHub → Settings → Developer settings → Tokens)
> als Passwort verwenden. Sag Bescheid, wenn du dabei Hilfe brauchst – das machen
> wir dann gemeinsam Schritt für Schritt.

**Wichtig:** Trage **keine echten Passwörter** in den Code ein. Zugangsdaten
gehören nur in die Einstellungen der laufenden App, nicht ins Repository.

---

## Bekannte Grenzen / geplanter Ausbau

- **Wiederkehrende Termine** (z. B. „jeden Montag", Geburtstage als Serie)
  werden noch nicht aufgelöst – jeder Termin wird als Einzeltermin behandelt.
- **Zeitzonen** werden vereinfacht behandelt (UTC bzw. lokale Zeit). Für
  mitteleuropäische Kalender meist ausreichend.
- **Echtes Web-Push** (Benachrichtigungen bei geschlossener App) ist noch nicht
  umgesetzt – bräuchte einen kleinen Server-Teil (VAPID).
- **Zugangsdaten** liegen im `localStorage` des Browsers (nicht verschlüsselt).
  Auf dem eigenen Gerät akzeptabel; für höhere Sicherheit wäre eine
  serverseitige Sitzungsverwaltung denkbar.

---

## Lizenz / Nutzung

Privates Projekt. Frei für deine eigene Nutzung und Weiterentwicklung.
