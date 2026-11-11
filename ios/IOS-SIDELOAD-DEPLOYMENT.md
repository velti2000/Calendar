# iOS-Sideload-Deployment: Expo-App aufs eigene iPhone (ohne Developer-Account)

Kontext-Dokument für Chat-Sitzungen. Beschreibt den in der Praxis erprobten Weg,
eine Expo/React-Native-App ohne kostenpflichtigen Apple-Developer-Account auf ein
echtes iPhone zu bringen. Alle Stolperfallen stammen aus real durchgeführten
Deployments (Juni–Oktober 2026, Apps „Calzi" und „FitZi").

Es gibt zwei Installationswege:

- **Weg A – AltStore** (Hauptweg): komfortabel, erneuert die App ohne neuen Build.
- **Weg B – Finder** (Notlösung): ohne AltServer, wenn dessen Apple-Anmeldung klemmt.
  Erfordert alle 7 Tage einen neuen Build.

---

## 1. Hardware-/Umgebungs-Rahmen

| | |
|---|---|
| Mac | MacBook Air 2020, **Intel**, macOS 15 |
| Xcode | **16.4** (= Swift 6.1, Maximum für Intel-Macs) |
| Shell | zsh |
| iPhone | iPhone 13 mini, iOS 27.2 |
| Apple ID | **kostenlos** (Personal Team), kein Developer Program |
| Tooling | AltServer 1.8.3 (Mac) + AltStore 2.3.2 (iPhone) |

**Harte Konsequenz:** macOS 26 / Xcode 26 laufen auf Intel nicht. Damit ist
**Expo SDK maximal 54** (RN 0.81.x). SDK 56+ verlangt Swift 6.2 / Xcode 26 und
ist auf dieser Maschine unbaubar. Kein SDK-Upgrade vorschlagen.

**Zweite Konsequenz:** Xcode 16.4 kennt das aktuelle iOS nicht. Ein direktes
„Run auf dem Gerät" aus Xcode scheitert daran. Deshalb der Umweg über
Archiv → IPA → Installation. Xcode dient nur zum **Bauen und Signieren**,
nicht zum Installieren.

---

## 2. Einmalige Vorbereitung

### 2.1 Signierung in Xcode

1. Workspace öffnen: `open ios/<AppName>.xcworkspace` (nicht `.xcodeproj`)
2. Projekt-Navigator → App-Target (blaues Icon) → Tab **Signing & Capabilities**
3. **„Push Notifications" Capability entfernen** — „–"-Button in der Box
   - **Pflicht.** Kostenlose Personal Teams unterstützen diese Capability nicht.
   - Fehlermeldung sonst: *„Personal development teams … do not support the
     Push Notifications capability"* gefolgt von *„No profiles … were found"*.
   - Unbedenklich, solange die App nur **lokale** Notifications nutzt
     (`expo-notifications` / `scheduleNotificationAsync`). Nur echte
     APNs-Server-Pushes bräuchten das Entitlement.
   - Falls die Capability im UI fehlt, aber trotzdem stört:
     `grep -r "aps-environment" ios/` und den Block aus der `.entitlements` löschen.
   - Achtung: Ein `npx expo prebuild --clean` kann die Capability wieder anlegen.
4. **Automatically manage signing** ✓, Team = eigene Apple ID (Personal Team)
5. iPhone einmal per Kabel anschließen und oben als Ziel wählen. Xcode trägt dann
   die **UDID des iPhones** in seine Signierprofile ein — Voraussetzung für Weg B.
6. Xcode erzeugt das Provisioning Profile selbst (grünes Häkchen abwarten)

### 2.2 AltStore aufs iPhone (nur für Weg A)

1. iPhone per **USB** anschließen, entsperren, „Diesem Computer vertrauen"
2. AltServer (Menüleiste) → **Install AltStore** → iPhone wählen → Apple ID
3. iPhone: **Einstellungen → Allgemein → VPN & Geräteverwaltung** → Apple ID → **Vertrauen**
4. AltServer → **Launch at Login** ✓

### 2.3 WLAN-Sync aktivieren (für automatische AltStore-Erneuerung)

1. iPhone per USB anschließen
2. **Finder** → iPhone in der Seitenleiste → Tab **Allgemein**
3. ✓ **„iPhone über WLAN mit diesem Mac synchronisieren"** → Anwenden

Wirkt nur in Netzen ohne Client-Isolation → siehe Abschnitt 7.

### 2.4 Build-Skript ins Projekt legen

Datei `tools/build-ipa.sh` im Expo-Projektordner anlegen (Inhalt in Anhang A),
dann einmalig: `chmod +x tools/build-ipa.sh`

---

## 3. Build: Archiv und IPA erzeugen

### 3.1 Verifikation vor dem Build

```bash
./node_modules/.bin/tsc --noEmit
npx expo export --platform ios --output-dir /tmp/x
```

Beide müssen fehlerfrei durchlaufen.

### 3.2 Empfohlen: per Skript (ein Befehl)

```bash
./tools/build-ipa.sh
```

Das Skript archiviert per `xcodebuild`, packt die IPA, zeigt das Ablaufdatum des
Signierprofils an und öffnet den Ordner. Ergebnis: `~/Desktop/<App>IPA/<App>.ipa`.
Workspace- und App-Name werden automatisch erkannt. Das Archiv landet im selben
Ordner statt im Xcode-Organizer — **Verwechslungen mit Archiven anderer Apps sind
damit ausgeschlossen.**

`-allowProvisioningUpdates` sorgt dafür, dass Xcode mit der unter
**Xcode → Settings → Accounts** hinterlegten Apple ID automatisch ein frisches
7-Tage-Profil holt.

### 3.3 Alternativ: manuell über die Xcode-Oberfläche

1. Ziel oben: **„Any iOS Device (arm64)"** *oder* das angeschlossene iPhone
   (nur der Simulator geht nicht)
2. **Product → Archive** (über das Menü), 5–10 Minuten
3. IPA packen — **App-Namen anpassen**:

```bash
NAME=Calzi   # <-- Name der App, die gerade archiviert wurde

ARCHIVE=$(ls -td ~/Library/Developer/Xcode/Archives/**/${NAME}*.xcarchive | head -1)
APP="$ARCHIVE/Products/Applications/$NAME.app"
echo "Archiv: $ARCHIVE"

OUT=~/Desktop/${NAME}IPA
rm -rf "$OUT" && mkdir -p "$OUT/Payload"
cp -r "$APP" "$OUT/Payload/"
cd "$OUT" && zip -qr "$NAME.ipa" Payload/
echo "Fertig: $OUT/$NAME.ipa"
```

> **Fallstrick:** Ohne den Namensfilter würde `ls -td … | head -1` das neueste
> Archiv **irgendeiner** App greifen — wer zuletzt eine andere App archiviert hat,
> packt dann die falsche. Deshalb `${NAME}*` im Muster.

> **Der Organizer-Export funktioniert nicht.** „Distribute App" bietet nur
> App Store Connect / TestFlight / Release Testing / Enterprise / Debugging /
> Custom — **alle** verlangen ein eingeschriebenes Developer-Programm
> (*„Team … is not enrolled in the Apple Developer Program"*). Deshalb packen
> Skript und manueller Weg die IPA selbst.

### 3.4 Hinweise

- Das JS-Bundle wird beim Release-Archiv automatisch eingebacken. Metro muss
  **nicht** laufen, die App ist standalone.
- Hunderte Compiler-Warnungen (`-Wdocumentation-deprecated-sync` u.ä.) aus
  React-Native-Pods sind **harmlos** und kein Fehlerhinweis.
- IPA-Struktur prüfen (muss mit `Payload/<Name>.app/` beginnen):
  `unzip -l ~/Desktop/<Name>IPA/<Name>.ipa | head -5`

---

## 4. Installation — Weg A: AltStore (Hauptweg)

1. iPhone **per USB** anschließen (WLAN ist unzuverlässig, Abschnitt 7)
2. IPA per **AirDrop** aufs iPhone schicken
3. iPhone: **„Öffnen mit AltStore"**
4. Ggf. **Einstellungen → Allgemein → VPN & Geräteverwaltung** → Apple ID → **Vertrauen**

**Erneuerung:** In AltStore → **My Apps** → **Refresh All**. AltServer signiert
die vorhandene App neu — **kein neuer Build nötig**. Läuft automatisch im
Hintergrund, wenn AltServer läuft und beide im selben WLAN ohne Client-Isolation sind.

---

## 5. Installation — Weg B: Finder (ohne AltServer)

Für den Fall, dass AltServer sich nicht bei Apple anmelden kann (Fehler 503,
3840 o.ä.). Funktioniert, weil Xcode sich regulär mit der Apple ID anmeldet
und die IPA für genau dieses iPhone signiert (UDID im Profil, siehe 2.1 Schritt 5).

1. Prüfen: **Xcode → Settings → Accounts** zeigt die Apple ID ohne rote Fehlermeldung
2. `./tools/build-ipa.sh` (Abschnitt 3.2) — erzeugt ein **frisches** 7-Tage-Profil
3. iPhone per Kabel anschließen, **Finder** öffnen, links das iPhone auswählen
4. **IPA ins Finder-Fenster des iPhones ziehen**

**Nachteil:** Die Signatur steckt in der App selbst. Für jede Verlängerung um
7 Tage ist ein **neuer Build** nötig (Schritte 2–4). Deshalb nur Notlösung.

Prüfen, ob das Profil das iPhone enthält und wie lange es gilt:

```bash
APP=$(ls -d ~/Desktop/CalziIPA/Payload/*.app)
security cms -D -i "$APP/embedded.mobileprovision" > /tmp/prof.plist
/usr/libexec/PlistBuddy -c "Print :ExpirationDate" -c "Print :ProvisionedDevices" /tmp/prof.plist
# UDID des angeschlossenen iPhones zum Vergleich:
system_profiler SPUSBDataType | grep -A12 -i iphone | grep -i serial
```

---

## 6. Gemeinsame Regeln beider Wege

### Update statt Neuinstallation

Solange die **Bundle-ID unverändert** bleibt, ersetzt die neue IPA die alte App und
**alle gespeicherten Daten bleiben erhalten** (AsyncStorage, SecureStore/Schlüsselbund).
Das gilt auch beim Wechsel zwischen Weg A und B. Ein geänderter Anzeigename
(`expo.name`) ändert daran nichts — nur eine geänderte `bundleIdentifier` erzeugt
eine zweite, separate App.

### Das 7-Tage-Limit

Kostenlose Apple IDs erzeugen Zertifikate mit **7 Tagen** Gültigkeit. Apple-
Beschränkung — **kein Tool umgeht sie**. Zusätzlich max. **3 sideloadete Apps**
gleichzeitig (AltStore zählt mit → real 2 eigene Apps).

| | Weg A: AltStore | Weg B: Finder | Sideloadly |
|---|---|---|---|
| 7-Tage-Limit | ja | ja | ja |
| Verlängern | Refresh, ohne Build | neuer Build | erneut signieren, ohne Build |
| Automatisch | ✓ (WLAN ohne Isolation) | ✗ | ✗ |
| Braucht AltServer-Anmeldung | ja | **nein** | eigene Anmeldung |

### Entwarnung bei Ablauf

Ein abgelaufenes Zertifikat **löscht die App nicht**. Sie bleibt samt Daten auf dem
iPhone und startet nur nicht mehr. Nach der nächsten erfolgreichen Installation mit
derselben Bundle-ID ist alles wieder da. Ein verpasster Termin kostet nichts Dauerhaftes.

### iPhone umbenennen

Unproblematisch. AltServer und Apples Entwicklerportal identifizieren das Gerät
über die **UDID**, nicht über den Namen. Nicht mitten im Troubleshooting umbenennen,
damit nicht zwei Dinge gleichzeitig wechseln.

---

## 7. Bekannte Fehlermeldungen

| Meldung | Bedeutung / Lösung |
|---|---|
| `Personal development teams … do not support the Push Notifications capability` | Capability entfernen → 2.1 |
| `No profiles for '<bundle-id>' were found` | Folgefehler des obigen |
| `Team … is not enrolled in the Apple Developer Program` (Organizer-Export) | Erwartet. IPA per Skript/manuell packen → 3 |
| `AltServer.ServerError 2005` / `AltStore.OperationError 1008` | Kommunikationsfehler AltStore ↔ AltServer, meist netzwerkbedingt. **Läuft die App danach: ignorieren.** Sonst Abschnitt 8 |
| `Failed to install … data isn't in the correct format` | IPA neu packen, iPhone per USB |
| `AltServer could not find this device` | Netzwerk-Discovery scheitert → **USB-Kabel**, Abschnitt 8 |
| `NSCocoaErrorDomain 3840` / `Encountered unknown tag html on line 1` | AltServer bekommt HTML statt plist von Apple. **Erst Mac + AltServer neu starten** (hat in der Praxis gereicht). Sonst Abschnitt 8 |
| `Apple's authentication servers returned an error (HTTP 503)` | Apple lehnt AltServers Anmeldung ab. **Zuerst nach Updates suchen:** AltServer → Check for Updates und in AltStore → My Apps. Im Oktober 2026 hatte Apple die Anmeldung geändert, behoben erst mit AltServer 1.8.3 / AltStore 2.3.2. Danach AltServer → Install AltStore (über die bestehende Version, **nicht vorher löschen**). Ohne Update: Störung oder Rate-Limit → warten; hält es an → **Weg B** |
| `Apple's authentication servers returned an error (HTTP 429)` | **Echtes Rate-Limit** („Too Many Requests") nach zu vielen Anmeldungen, z.B. Neuinstallation von AltStore + sofortiger Refresh. **Keine weiteren Versuche**, auch keine automatischen: AltStore → Settings → **Background Refresh aus** und/oder AltServer auf dem Mac beenden. Bis zum nächsten Tag warten, dann **ein** Refresh, danach Background Refresh wieder an. Auch Weg B meldet sich bei derselben Apple ID an, also besser nicht ausweichen |
| Hunderte Compiler-Warnungen beim Archivieren | Harmlos, aus RN-Pods |

Ein erfolgreicher Login im regulären **App Store** sagt über AltServer nichts aus:
AltServer meldet sich über einen anderen Dienst an (`gsa.apple.com`, gibt sich als
Mac mit Xcode aus).

---

## 8. Netzwerk- und Anmelde-Fallstricke

AltStore braucht zwei getrennte Verbindungen:
**(a)** AltServer ↔ iPhone (Gerätekommunikation) und
**(b)** AltServer ↔ Apple (Anmeldung/Signierung).
Fast alle Probleme stammen daraus, dass eine der beiden gestört ist.

### Client-Isolation (Hotel, Büro, Café, Flughafen) → betrifft (a)

Verwaltete Netze trennen die Clients: Jedes Gerät kommt ins Internet, aber die
Geräte sehen sich gegenseitig **nicht**. AltServer findet das iPhone dann
prinzipiell nicht, auch der Finder-WLAN-Sync hilft nicht.

```bash
route -n get default | grep -E "interface|gateway"
arp -a -n | grep -v incomplete
```

Zeigt die ARP-Tabelle **nur das Gateway** (und liegt das Netz z.B. in `172.16.x.x`
statt `192.168.x.x`), ist Client-Isolation sehr wahrscheinlich.
→ **Nicht reparierbar. USB-Kabel verwenden.**

### iPhone-Hotspot für den Mac → betrifft (a)

Bezieht der Mac sein Internet vom iPhone-Hotspot, ist die Topologie umgekehrt.
Das führt zu Fehlern 1008/2005. → Für Installationen echtes gemeinsames WLAN,
Hotspot nur als Fallback für die reine Apple-Anmeldung.

### Captive Portal / TLS-Interception → betrifft (b)

```bash
# Captive Portal?  Erwartet: <HTML>…Success…</HTML>
curl -s -m 10 http://captive.apple.com/hotspot-detect.html

# TLS-Interception?  Erwartet: issuer = Apple Inc.
echo | openssl s_client -connect idmsa.apple.com:443 -servername idmsa.apple.com 2>/dev/null \
  | grep -E "issuer=|subject="

# Apple-Dienste erreichbar?
for u in https://gsa.apple.com/grandslam/GsService2 \
         https://developerservices2.apple.com/services/QH65B2/listTeams.action; do
  curl -s -m 15 -o /dev/null -w "%{http_code}  $u\n" "$u"
done
# Erwartet: 401 für gsa (= Dienst läuft, nur ohne Login) und 200 für developerservices2.
# 5xx hier = Störung bei Apple bzw. im Netz.

# Proxy gesetzt?  Erwartet: leer
scutil --proxy | grep -E "HTTPEnable|HTTPSEnable|ProxyAutoConfigEnable"
```

Hinweis: `idmsa.apple.com/appleauth/auth/signin` liefert per GET **immer**
`text/html` — das ist die Login-Seite und **kein** Befund.

### Apple-Systemstatus → betrifft (b)

```bash
curl -s -m 15 "https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js" \
| python3 -c "
import sys,json
t=sys.stdin.read(); d=json.loads(t[t.find('{'):t.rfind('}')+1])
bad=[(s['serviceName'],e) for s in d['services'] for e in s.get('events',[])]
[print(n,'|',e.get('eventStatus'),'|',e.get('startDate')) for n,e in bad] or print('Keine Störungen')"
```

Oder im Browser: developer.apple.com/system-status

### Rate-Limiting → betrifft (b)

Nach mehreren fehlgeschlagenen Anmeldungen sperrt Apple temporär (HTML-Fehlerseiten
→ 3840, oder direkt 503). **Warten, nicht wiederholen.** Bei 2FA hilft ein
**app-spezifisches Passwort** (`account.apple.com` → Anmeldung und Sicherheit →
App-spezifische Passwörter) statt des Account-Passworts.

### Reihenfolge beim Troubleshooting

1. **Mac und AltServer neu starten**
2. **Updates prüfen:** AltServer → Check for Updates, AltStore → My Apps
   (bei Fehlern direkt nach einer Apple-Änderung kommt der Fix oft binnen Tagen)
3. iPhone per **USB**, nicht über WLAN
4. Netzwerk-Diagnose und Apple-Systemstatus prüfen
5. Bei 503/429/3840: **warten** (Stunden bis ein Tag), dann **ein** Versuch, ggf. mit
   app-spezifischem Passwort
6. Hält es an → **Weg B (Finder)** und auf ein AltServer-Update warten

---

## 9. Alternativen

**Sideloadly** (sideloadly.io) — aktiv gepflegt, arbeitet über USB, kein AltStore
nötig. Keine automatische Erneuerung. Nutzt aber einen ähnlichen Anmeldeweg wie
AltServer und kann daher von denselben Apple-Sperren betroffen sein.

**Apple Developer Program (99 €/Jahr)** — Zertifikate **1 Jahr** gültig, keine
Sideload-Werkzeuge, keine wöchentliche Erneuerung. Löst das 7-Tage-Problem als
einziges wirklich.

**EAS Build** (Expo Cloud) — umgeht die Intel/Xcode-16.4-Grenze beim Bauen, für die
Installation aufs Gerät aber ebenfalls Developer-Account nötig.

---

## 10. Kurzreferenz

```bash
# 1. Verifizieren
./node_modules/.bin/tsc --noEmit
npx expo export --platform ios --output-dir /tmp/x

# 2. Bauen + IPA packen
./tools/build-ipa.sh

# 3a. Weg A: AirDrop → iPhone → „Öffnen mit AltStore" (iPhone per USB)
# 3b. Weg B: Finder → iPhone auswählen → IPA ins Fenster ziehen
```

---

## Anhang A: `tools/build-ipa.sh`

```bash
#!/bin/zsh
# Baut ein Release-Archiv und packt daraus eine IPA - ohne Xcode-Organizer und
# ohne bezahlten Developer-Account. Signiert wird mit dem Personal Team, das in
# Xcode -> Settings -> Accounts hinterlegt ist (Profil gilt 7 Tage).
#
# Aufruf aus dem Expo-Projektordner:   ./tools/build-ipa.sh
# Ergebnis:                            ~/Desktop/<App>IPA/<App>.ipa
set -e
cd "$(dirname "$0")/.."

WS=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WS" .xcworkspace)
OUT=~/Desktop/${SCHEME}IPA
ARCHIVE="$OUT/$SCHEME.xcarchive"

echo "Workspace: $WS  |  Schema: $SCHEME"
rm -rf "$OUT"
mkdir -p "$OUT/Payload"

echo "Archiviere (dauert 5-10 Minuten) ..."
xcodebuild -quiet \
  -workspace "$WS" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  archive

APP=$(ls -d "$ARCHIVE/Products/Applications/"*.app | head -1)
NAME=$(basename "$APP" .app)
cp -r "$APP" "$OUT/Payload/"
(cd "$OUT" && zip -qr "$NAME.ipa" Payload)

security cms -D -i "$APP/embedded.mobileprovision" > "$OUT/profile.plist" 2>/dev/null
EXP=$(/usr/libexec/PlistBuddy -c "Print :ExpirationDate" "$OUT/profile.plist")

echo ""
echo "Fertig:       $OUT/$NAME.ipa"
echo "Gueltig bis:  $EXP"
open "$OUT"
```
