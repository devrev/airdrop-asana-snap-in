#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASANA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CODE_ROOT="$ASANA_ROOT/code"
ENV_FILE="$CODE_ROOT/.env"
FRAMEWORK_ROOT="${AIRDROP_TEST_RUNNER_ROOT:-$ASANA_ROOT/../airdrop-snap-in-mock-dependencies}"
FRAMEWORK_ROOT="$(cd "$FRAMEWORK_ROOT" 2>/dev/null && pwd)" || {
  echo "Framework runner not found. Set AIRDROP_TEST_RUNNER_ROOT to its repository path." >&2
  return 1
}
OUTPUT_ROOT="${AIRDROP_TEST_OUTPUT_ROOT:-/tmp/airdrop-asana-tests}"

require_asana_test_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE. Add ASANA_PAT, ASANA_WORKSPACE_ID, and ASANA_PROJECT_ID." >&2
    return 1
  fi

  node - "$ENV_FILE" ASANA_PAT ASANA_WORKSPACE_ID ASANA_PROJECT_ID <<'NODE'
const fs = require('node:fs');
const [file, ...required] = process.argv.slice(2);
const values = new Map();
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '');
  }
  values.set(match[1], value.trim());
}
const missing = required.filter((name) => !values.get(name));
if (missing.length) {
  console.error(`Set non-empty ${missing.join(', ')} in ${file}.`);
  process.exitCode = 1;
}
NODE
}

prepare_asana_framework_test() {
  if [[ "${1:-}" != "--offline" ]]; then
    require_asana_test_env
  fi
  if [[ ! -f "$FRAMEWORK_ROOT/package.json" || ! -f "$CODE_ROOT/package.json" ]]; then
    echo "Expected framework and Asana connector package.json files were not found." >&2
    return 1
  fi
  npm --prefix "$CODE_ROOT" ci
  npm --prefix "$CODE_ROOT" run build
  npm --prefix "$FRAMEWORK_ROOT" install
}

run_asana_framework_scenario() {
  local scenario="$1"
  local expected_callback="$2"
  local cli_output
  cli_output="$(mktemp)"

  if ! node "$FRAMEWORK_ROOT/bin/airdrop-extraction-test.js" "$scenario" \
    --fixtures "$CODE_ROOT/fixtures" \
    --connector-root "$CODE_ROOT" \
    --output-root "$OUTPUT_ROOT" >"$cli_output" 2>&1; then
    cat "$cli_output"
    rm -f "$cli_output"
    return 1
  fi
  cat "$cli_output"

  local run_dir
  run_dir="$(awk -v scenario="$scenario" '$1 == "PASS" { label = $2; sub(/:$/, "", label); if (label == scenario) { sub(/^[^:]+: /, ""); print } }' "$cli_output")"
  rm -f "$cli_output"
  if [[ -z "$run_dir" ]]; then
    echo "Could not locate the retained run directory for $scenario." >&2
    return 1
  fi

  node - "$run_dir/diagnostics/callbacks.jsonl" "$expected_callback" <<'NODE'
const fs = require('node:fs');
const [file, expected] = process.argv.slice(2);
if (!fs.existsSync(file)) {
  console.error(`Expected lifecycle callback diagnostics at ${file}.`);
  process.exit(1);
}
const callbacks = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
if (callbacks.at(-1)?.event_type !== expected) {
  const received = callbacks.map((callback) => callback?.event_type || '<missing event_type>').join(', ') || '<none>';
  console.error(`Expected the final callback to be ${expected}; received ${received}.`);
  process.exit(1);
}
console.log(`Verified final callback: ${expected}`);
NODE
}
