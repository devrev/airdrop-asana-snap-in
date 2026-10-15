#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_airdrop_framework_common.sh"
prepare_asana_framework_test

run_asana_framework_scenario airdrop_framework_fixture EXTERNAL_SYNC_UNIT_EXTRACTION_DONE
