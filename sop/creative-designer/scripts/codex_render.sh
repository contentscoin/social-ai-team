#!/usr/bin/env bash
# codex_render.sh — Codex(OpenAI) image render lane for /social-creative-designer
#
# Usage:
#   codex_render.sh --prompt-file <path/to/prompt.txt> --out <path/to/image.png> [--size 1024x1024|1536x1024|1024x1536]
#
# Auth (one of):
#   - OPENAI_API_KEY env var  (headless environments — recommended)
#   - existing `codex login` session (~/.codex/auth.json)
#
# Exit codes: 0 = success, 2 = auth missing, 3 = generation failed
set -euo pipefail

PROMPT_FILE="" OUT="" SIZE="1024x1024"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) PROMPT_FILE="$2"; shift 2;;
    --out)         OUT="$2";         shift 2;;
    --size)        SIZE="$2";        shift 2;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done
[[ -f "$PROMPT_FILE" && -n "$OUT" ]] || { echo "need --prompt-file <file> and --out <path>" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
PROMPT="$(cat "$PROMPT_FILE")"

# --- auth check -------------------------------------------------------------
have_codex() { command -v codex >/dev/null 2>&1; }
codex_logged_in() { have_codex && codex login status 2>&1 | grep -qi "logged in using"; }

if ! codex_logged_in; then
  if [[ -n "${OPENAI_API_KEY:-}" ]] && have_codex; then
    printf '%s\n' "$OPENAI_API_KEY" | codex login --with-api-key >/dev/null 2>&1 || true
  fi
fi
if ! codex_logged_in && [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "AUTH MISSING: set OPENAI_API_KEY (environment secret) or run 'codex login'." >&2
  exit 2
fi

# --- path 1: codex as executor ---------------------------------------------
if codex_logged_in; then
  WORKDIR="$(dirname "$OUT")"
  TASK="Non-interactive task. Generate ONE image with the OpenAI Images API (model gpt-image-1, size ${SIZE}) using the exact prompt in the file ${PROMPT_FILE} (read it; do not rewrite it). Save the decoded PNG to ${OUT}. Use OPENAI_API_KEY from the environment. When the file exists and is a valid PNG, print RENDER_DONE and stop. Do not edit any other files."
  if timeout 300 codex exec --full-auto --skip-git-repo-check -C "$WORKDIR" "$TASK" 2>&1 | tail -3; then
    if [[ -s "$OUT" ]] && file "$OUT" | grep -qi "image"; then
      echo "OK codex: $OUT"; exit 0
    fi
  fi
  echo "codex path did not produce a valid image — falling back to direct API." >&2
fi

# --- path 2: direct Images API fallback (same key) ---------------------------
[[ -n "${OPENAI_API_KEY:-}" ]] || { echo "AUTH MISSING for fallback (OPENAI_API_KEY)." >&2; exit 2; }
RESP="$(mktemp)"
curl -sS https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d "$(python3 - "$PROMPT" "$SIZE" <<'PY'
import json,sys
print(json.dumps({"model":"gpt-image-1","prompt":sys.argv[1],"size":sys.argv[2],"n":1}))
PY
)" > "$RESP" || { echo "API call failed" >&2; exit 3; }
python3 - "$RESP" "$OUT" <<'PY'
import base64, json, sys
d = json.load(open(sys.argv[1]))
if "data" not in d:
    sys.stderr.write("API error: %s\n" % json.dumps(d.get("error", d))[:500]); sys.exit(3)
open(sys.argv[2], "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
PY
[[ -s "$OUT" ]] && file "$OUT" | grep -qi "image" && { echo "OK direct-api: $OUT"; exit 0; }
echo "generation failed" >&2; exit 3
