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
