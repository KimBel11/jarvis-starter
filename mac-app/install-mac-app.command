#!/bin/zsh
# Builds the Jarvis Mac app (a window + menu-bar orb around your local Jarvis) and puts it in Applications. No Apple account needed.
cd "$(dirname "$0")"
command -v xcodebuild >/dev/null || { echo "Install Xcode (free, Mac App Store), open it once, then run this again."; read -k 1; exit 1; }
sed -i '' "s/com\.example\.jarvis/com.jarvis.macapp/g" Jarvis.xcodeproj/project.pbxproj 2>/dev/null
cat > /tmp/jarvis-mac-local.entitlements <<'X'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict></dict></plist>
X
echo "Building the Mac app (a few minutes the first time)…"
xcodebuild -project Jarvis.xcodeproj -scheme Jarvis -configuration Release -derivedDataPath build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM="" CODE_SIGN_ENTITLEMENTS=/tmp/jarvis-mac-local.entitlements build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
APP=build/Build/Products/Release/Jarvis.app
[ -d "$APP" ] || { echo "The build failed. Paste the message above into your AI."; read -k 1; exit 1; }
osascript -e 'tell application "Jarvis" to quit' 2>/dev/null; sleep 1
rm -rf /Applications/Jarvis.app; ditto "$APP" /Applications/Jarvis.app
xattr -dr com.apple.quarantine /Applications/Jarvis.app 2>/dev/null
open -a /Applications/Jarvis.app
echo "✓ Jarvis is in your Applications folder. Make sure Jarvis is running (double-click start.command in the Jarvis folder)."
read -k 1 "?Press any key to close."
