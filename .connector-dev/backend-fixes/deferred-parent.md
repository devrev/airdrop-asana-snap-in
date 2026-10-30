# DEV initial-sync defect diagnosis

Asana source: `ed6b21c0e4a8af83281fabf8ef2cc526c4112bc2`.
Loader baseline: `a5389a448b78104f22f8b92e98b942f6f683b977`.
DEV history: `9baf1678-2c4a-4fdb-b85f-99f6172e4d40`.
DEV unit: `0e53df82-90c9-47a5-832c-e5b4fc53a2c3`.

The initial import completed with all 32 works, 24 comments and 12 files. Three depth-two subtasks lost their custom `parent_task` reference despite retaining the correct hierarchy link. This is a backend loader defect, not evidence of a passing smoke test.

| Source fixture | DevRev record | Expected parent | Observed custom parent |
|---|---|---|---|
| subtask 3 | ISS-265 | ISS-266 | absent |
| subtask 7 | ISS-269 | ISS-270 | absent |
| subtask 11 | ISS-260 | ISS-262 | absent |

All 12 child records share the same subtype and schema fragments (custom type fragment 91, tenant fragment 16). Nine direct children successfully store the custom parent. Source metadata already permits references to both task and subtask record types.

Grafana records ten loader warning occurrences with hash `98204c109028f128`. Three identify the current depth-two children; seven identify older source records outside this fixture. Each reports `ctype__parent_task (FieldNotInSchema): field ctype__parent_task is not in selected schemas` during `RESOLVE_REFERENCES`.

`newWorkReferenceResolutionItem` fetches the existing work but omits its subtype when constructing the deferred update. The `ResolvingReferences` branch of `UpdateWork` consequently sends an empty custom schema specification with only the tenant fragment selected. References that resolve during initial creation include their subtype; deferred references fail. This also explains warnings from previously deferred records.

The patch preserves the fetched work's existing subtype in the reference-resolution update. It changes no source metadata, mapping, or user-selected subtype. Removing the custom parent mapping would discard useful reverse-sync data; merely ordering records would leave true forward references vulnerable.

## Regression evidence

The new `TestResolveWorkReferences/Resolve_deferred_parent_in_existing_subtask_subtype` exercises the full resolver, target mapper, and expected Codex request for a deferred `ctype__parent_task` reference on an existing Asana subtask subtype.

Before the patch it fails with `CustomSchemaSpec.Subtype: string != <nil pointer>`. After the patch all `TestResolveWorkReferences` cases, `go test ./internal/...`, `go test ./...` and `go vet ./internal/...` pass. `git diff --check` is clean. The patch has not been deployed or pushed; live behavior remains unfixed until the backend change is reviewed and deployed, then retested.

## Modifier assertions

Eighteen original modifier assertions failed: all six linked root works and all 12 children report SYSU-1. All 14 unlinked root works retain DEVU-1. Link normalization supplies no creator; the loader falls back to its default SYSU-1 and passes that identity as `CreateLink.ActorId`. Link writes update both endpoints. This is expected platform audit behavior, supported by the exact identity/link correlation and the backend actor code.

Retain the original failed verification artifact. Add a distinct assertion for current platform modifier: SYSU-1 on records changed by fixture hierarchy links, DEVU-1 on unlinked records. Continue checking source creator, `external_source_data.created_by`, reported-by, hierarchy targets, object versions and stable IDs independently. Do not weaken parent-field or warning assertions.
