#!/bin/bash
# Release motionmaxxing: set the version, tag vX.Y.Z on main, and point the Homebrew formula at it, so
# `brew upgrade motionmaxxing` brings it to everyone who installed with brew install subh05sus/tap/motionmaxxing.
#
#   scripts/release.sh 0.2.0
set -euo pipefail
V="${1:?usage: scripts/release.sh X.Y.Z}"
REPO="subh05sus/motionmaxxing"
TAP_REPO="subh05sus/homebrew-tap"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit your changes first." >&2; exit 1; }
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push main first: a release is what GitHub has." >&2; exit 1; }

# the version the studio shows and the Dock app carries
if [ "$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -1)" != "$V" ]; then
  npm version "$V" --no-git-tag-version >/dev/null
  sed -i '' -E "s/\"version\": \"[^\"]+\"/\"version\": \"$V\"/" plugin/.claude-plugin/plugin.json
  git commit -qam "motionmaxxing $V"
  git push -q origin main
fi
git tag -a "v$V" -m "motionmaxxing $V"
git push -q origin "v$V"

URL="https://github.com/$REPO/archive/refs/tags/v$V.tar.gz"
SHA="$(curl -fsSL "$URL" | shasum -a 256 | cut -d' ' -f1)"
TAP="$(mktemp -d)/tap"
gh repo clone "$TAP_REPO" "$TAP" -- -q
sed -i '' -e "s|^  url \".*\"|  url \"$URL\"|" -e "s|^  sha256 \".*\"|  sha256 \"$SHA\"|" "$TAP/Formula/motionmaxxing.rb"
git -C "$TAP" commit -qam "motionmaxxing $V"
git -C "$TAP" push -q
rm -rf "$(dirname "$TAP")"
echo "Released $V. Installed copies update with: brew upgrade motionmaxxing"
