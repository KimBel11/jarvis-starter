#!/bin/zsh
# One click: builds the Jarvis iPhone app (and the Apple Watch app inside it) and installs it on YOUR iPhone.
# Needs: a Mac with Xcode (free in the App Store), an iPhone connected by cable and unlocked, Developer Mode on,
# and your Apple ID added in Xcode (Xcode > Settings > Accounts). A free Apple ID is enough; a paid account adds notifications and CarPlay.
cd "$(dirname "$0")"
bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
say() { printf "%s\n" "$1"; }
fail() { printf "\n\033[31m✗ %s\033[0m\n\n" "$1"; read -k 1 "?Press any key to close."; exit 1; }

command -v xcodebuild >/dev/null || fail "Xcode is not installed. Install it free from the Mac App Store, open it once, then run this again."
xcodebuild -version >/dev/null 2>&1 || fail "Open Xcode once (accept the license), then run this again."

bold "Jarvis for iPhone"
CFG=.install-config
[ -f "$CFG" ] && source "$CFG"

if [ -z "$PREFIX" ]; then
  say "Apple needs every app to have a unique name. Choose a short word that is only yours (letters/numbers), for example your first name."
  read "?Your unique word: " W; W=$(echo "$W" | tr -cd 'a-zA-Z0-9' | tr 'A-Z' 'a-z'); [ -z "$W" ] && fail "A word is needed."
  PREFIX="com.$W"
fi
BUNDLE="$PREFIX.jarvis"

if [ -z "$SERVER" ]; then
  say ""
  say "Your Jarvis server address. It is the https address of YOUR Mac from Tailscale (see docs/IPHONE.md, step 2). It looks like https://my-mac.tail1234.ts.net"
  say "Leave empty to set it later inside the app (App settings)."
  read "?Server address: " SERVER
fi

# Team: the one Xcode created for your Apple ID
TEAM="${TEAM:-$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | grep -oE 'teamID = [A-Z0-9]{10}' | head -1 | awk '{print $3}')}"
if [ -z "$TEAM" ]; then
  say ""; say "I could not find your Apple team automatically. Open Xcode > Settings > Accounts, add your Apple ID, click it, and you will see a team with a 10-character Team ID."
  read "?Team ID (10 characters): " TEAM
fi
[ ${#TEAM} -eq 10 ] || fail "That does not look like a Team ID (10 letters/numbers)."
printf 'PREFIX=%s\nSERVER=%s\nTEAM=%s\n' "$PREFIX" "$SERVER" "$TEAM" > "$CFG"

# personalise the project once
if grep -q "com.example.jarvis" Jarvis.xcodeproj/project.pbxproj; then
  sed -i '' "s/com\.example\.jarvis/$BUNDLE/g" Jarvis.xcodeproj/project.pbxproj
  grep -rl "com\.example\.jarvis" Jarvis JarvisWatch Shared 2>/dev/null | xargs -I{} sed -i '' "s/com\.example\.jarvis/$BUNDLE/g" {} 2>/dev/null
fi
[ -n "$SERVER" ] && sed -i '' -E "s#(static let defaultServer = \")[^\"]*(\")#\1$SERVER\2#" Jarvis/JarvisApp.swift

bold "Looking for your iPhone…"
DEV=$(xcrun devicectl list devices 2>/dev/null | grep -i "iphone" | grep -iE "connected|available" | grep -iv simulat | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}')
[ -z "$DEV" ] && fail "No iPhone found. Connect it with a cable, unlock it, tap 'Trust', and turn on Developer Mode (Settings > Privacy & Security > Developer Mode, then restart). See docs/IPHONE.md."
say "Found your iPhone ($DEV). Building… this takes a few minutes the first time."

ENT="${ENTITLEMENTS:-Jarvis/Jarvis.entitlements}"   # free account: no push or CarPlay. Paid: ./install-iphone.command paid
[ "$1" = "paid" ] && ENT="Jarvis/Jarvis.paid.entitlements"
[ "$1" = "carplay" ] && ENT="Jarvis/Jarvis.carplay.entitlements"

xcodebuild -project Jarvis.xcodeproj -scheme Jarvis -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build-device -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_ENTITLEMENTS="$ENT" build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" 
APP=build-device/Build/Products/Release-iphoneos/Jarvis.app
[ -d "$APP" ] || fail "The build did not finish. Open Jarvis.xcodeproj in Xcode, choose your team under Signing & Capabilities, and read the red message. Or paste it into your AI."

xcrun devicectl device install app --device "$DEV" "$APP" || fail "Installing failed. Unlock the iPhone, keep it connected, and run this again."
bold "✓ Jarvis is on your iPhone."
say "First time with a free Apple ID: on the iPhone open Settings > General > VPN & Device Management > your Apple ID > Trust."
say "Free Apple ID apps stop opening after 7 days; just run this file again (takes 2 minutes). A paid developer account lasts a year."
say "Apple Watch: see docs/WATCH.md. The watch app was installed inside the iPhone app."
read -k 1 "?Press any key to close."
