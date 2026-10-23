#!/bin/bash
# Puts motionmaxxing.app in ~/Applications: a Dock and Spotlight launcher for this checkout's studio (bin/mm).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${MM_APP_DIR:-$HOME/Applications}/motionmaxxing.app"
VER="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/package.json" | head -1)"
# installed with Homebrew: the launcher calls Homebrew's mm, which outlives brew upgrade (the Cellar folder does not)
MM="$ROOT/bin/mm"
case "$ROOT" in */Cellar/*) MM="$(brew --prefix 2>/dev/null || echo /opt/homebrew)/bin/mm" ;; esac
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>motionmaxxing</string>
  <key>CFBundleDisplayName</key><string>motionmaxxing</string>
  <key>CFBundleIdentifier</key><string>com.subh05sus.motionmaxxing</string>
  <key>CFBundleVersion</key><string>${VER:-0.1.0}</string>
  <key>CFBundleShortVersionString</key><string>${VER:-0.1.0}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>motionmaxxing</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
printf '#!/bin/bash\nexec "%s" open\n' "$MM" >"$APP/Contents/MacOS/motionmaxxing"
chmod +x "$APP/Contents/MacOS/motionmaxxing"
touch "$APP"
echo "$APP (drag it to the Dock)"
