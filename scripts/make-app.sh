#!/bin/bash
# Puts motionmaxxing.app in ~/Applications: a Dock and Spotlight launcher for this checkout's studio (bin/mm).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${MM_APP_DIR:-$HOME/Applications}/motionmaxxing.app"
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
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>motionmaxxing</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
printf '#!/bin/bash\nexec "%s/bin/mm" open\n' "$ROOT" >"$APP/Contents/MacOS/motionmaxxing"
chmod +x "$APP/Contents/MacOS/motionmaxxing"
touch "$APP"
echo "$APP (drag it to the Dock)"
