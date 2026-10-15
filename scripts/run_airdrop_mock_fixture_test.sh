#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_airdrop_framework_common.sh"

if [[ -z "${AIRDROP_EXTERNAL_API_MOCK:-${EXTERNAL_API_MOCK_BIN:-}}" ]]; then
  AIRDROP_EXTERNAL_API_MOCK="$(command -v airdrop-external-api-mock || true)"
fi
if [[ -z "${AIRDROP_EXTERNAL_API_MOCK:-${EXTERNAL_API_MOCK_BIN:-}}" ]]; then
  echo "Set AIRDROP_EXTERNAL_API_MOCK or add airdrop-external-api-mock to PATH before running this fixture." >&2
  exit 1
fi
export AIRDROP_EXTERNAL_API_MOCK="${AIRDROP_EXTERNAL_API_MOCK:-${EXTERNAL_API_MOCK_BIN:-}}"

# The mock serves deterministic synthetic responses locally and has no proxy target;
# the fixture does not contact Asana or require credentials.

prepare_asana_framework_test --offline
run_asana_framework_scenario airdrop_framework_mock EXTERNAL_SYNC_UNIT_EXTRACTION_DONE
