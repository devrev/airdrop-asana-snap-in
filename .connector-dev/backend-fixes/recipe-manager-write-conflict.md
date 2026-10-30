# DEV mapping write conflict

The failed initial import stopped at mapping confirmation in `airdrop-recipe-manager`, before Asana loading resumed. This is a shared backend failure, not an Asana worker failure.

## Evidence

- Sync unit `851b1cb8-166e-43c5-9acb-d15ca9fda4e0`; original history `03a4702f-dba5-4616-834f-4a30ff024cfe`.
- `finish-mapping.json` records HTTP 500 with MongoDB `WriteConflict`.
- Grafana trace `00000000000000009e619a3fdf0f5283` identifies `RecipeManagerV2.AssociateRecipeBlueprint`, gRPC `Aborted`, at `2026-10-30T11:13:25.502Z`.
- Running backend tag `va7a0e06` matches the inspected repository commit `a7a0e069278e96442f91dc2773400915aaff8188`.
- Read-only reconciliation found no current blueprint, the same proposed blueprint, the same original history, and progress `recipe_discovery_waiting_for_user_input`.

## Cause and owner

`v2/db/recipe_status.go:conflictOrInternalError` converts Mongo command error 112 into a fresh service `Aborted` error, interpolating the Mongo error into text. This discards its `TransientTransactionError` label. `v2/db/transaction.go:Transact` returns that error from the Mongo driver's `WithTransaction` callback. The driver follows the error chain for labels to decide whether to abort and retry the complete transaction. With the label discarded, it aborts and returns the error instead of retrying.

Association writes the blueprint, shards, association/status, imported record types and system pack version in one transaction. Concurrent project mappings also increment the system pack version. This is a plausible shared contention point. The trace shows five record-type upserts before the error, but does not identify the exact failing database statement or competing writer, so that detail remains unproven. Pre-commit log messages do not imply persisted writes.

## Narrow local fix

The patch wraps only the existing recognized Mongo command-112 error, retains its original cause through `Unwrap`, and preserves the service error's gRPC `Aborted` code and message. The driver's existing transaction retry policy then handles the original Mongo label. No custom retry loop, retry count, external API retry or error-code reclassification is added.

`AssociateRecipeBlueprint` posts the chef resume SQS event only after `Transact` succeeds. Retrying an aborted transaction therefore does not repeat that published side effect. The local regression uses the real Mongo driver with mock wire responses: command conflict, abort, successful repeated command, commit. It proves exactly two callback attempts and one commit. An unlabeled command-112 case proves there is no newly introduced retry for an error the driver does not label transient, and the external gRPC code remains `Aborted`.

This patch is local, uncommitted and undeployed in `work/recipe-manager`. It belongs in the recipe-manager repository, separately from the Asana PR. It does not claim to repair other database wrappers that also discard causes.

Validation: the new real-driver regression failed before the source fix and passed afterward. The full `go test ./v2/... ./internal/...` suite passed (36 packages with tests), the focused race-enabled tests passed, `go vet ./v2/db` passed, and formatting/diff checks were clean. Evidence and commands are in `validation.json` and adjacent logs. This uses mock MongoDB wire responses; a live replica-set contention test, patched DEV backend retest, infrastructure integration suite and configured golangci-lint version were not run.

## Safe recovery of this DEV fixture

A bounded retry of the same proposed mapping is appropriate only after re-reading current status and fresh blueprint/status object versions. The failed Mongo transaction rolled back its association, and the observed missing current blueprint confirms it was not applied. Do not re-import, re-seed, delete the unit or create a new sync history.

If a current blueprint or resumed history appears before recovery, do not associate again: follow the existing history. If versions changed, review the refreshed state. A timeout or unknown-commit outcome requires read-only reconciliation before any subsequent mutation. This diagnosis did not retry or mutate any external system.
