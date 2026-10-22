#!/usr/bin/env bash
# Every script's self-check (no network, no keys). Run from the repo root with the engine's python:
#   PY=~/.motionmaxxing/venv/bin/python plugin/tests/demos.sh
set -uo pipefail
PY=${PY:-$HOME/.motionmaxxing/venv/bin/python}
C=plugin/skills/cut/scripts
L=plugin/lib/mm
failed=()
for s in "$C/test_build_timeline.py" "$C/test_retakes.py" "$C/test_media.py" "$C/transcribe.py demo" "$C/verify_cut.py demo" \
  "$C/hook_check.py demo" "$C/join.py demo" "$C/judge_cut.py demo" "$C/read_cut.py demo" "$C/trend.py demo" "$C/splice_check.py demo" \
  "$C/script_match.py demo" "$C/mirror.py demo" "$C/takes.py demo" "$C/edits.py demo" "plugin/skills/record/scripts/render.py demo" \
  "plugin/skills/edit/scripts/stock.py demo" "plugin/skills/edit/scripts/plan.py demo" "plugin/skills/edit/scripts/route.py demo" "plugin/skills/edit/scripts/check.py demo" "plugin/skills/edit/scripts/sfx.py demo" "$L/review.py demo" \
  "plugin/skills/taste/scripts/taste.py demo" "plugin/skills/taste/scripts/learn.py demo" "plugin/skills/setup/scripts/setup.py demo" \
  "$L/lang.py demo" "$L/progress.py demo" "$L/models.py" "$L/keys.py" "$L/profile.py demo" "$L/styleskill.py demo" \
  "$L/skillrules.py demo" "$L/custom.py demo" "$L/library.py demo" "$L/links.py demo" "$L/presets.py demo" "$L/run.py demo" "$L/net.py demo"; do
  echo "== $s"
  # shellcheck disable=SC2086
  "$PY" $s 2>&1 | grep -v '^objc\[' | tail -2 || true
  "$PY" $s >/dev/null 2>&1 || failed+=("$s")
done
if ((${#failed[@]})); then printf 'FAILED: %s\n' "${failed[@]}"; exit 1; fi
echo "all demos ok"
