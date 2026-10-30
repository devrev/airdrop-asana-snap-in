# Asana follow-up regression testing

**Overall: FAIL — backend parent-reference loss and emitted warnings remain.** Camping World’s proposed 8,000-project rollout is deferred. This report focuses on existing defects and source-pinned DEV regression tests.

## Fixes found by this round

- A project-guard 429 could persist the previous incremental run’s completed flags. Continuation then skipped extraction. The state reset now precedes the guard; the regression restores actual SDK-persisted state.
- All eight pre-fix live incremental runs missed a changed depth-two task and its new comment because the intermediate parent was unchanged. Descendant traversal now runs independently of each record’s window filter. Root `modified_since` is retained only when subtasks are excluded.
- Concurrent initial mapping exposed a backend Mongo transaction conflict. The local recipe-manager patch preserves Mongo’s transient error cause so the driver can retry the transaction; it preserves the external Aborted behavior and adds no retry loop.

## Validation

The final source passes typecheck, lint, build and the coverage gate: **28 suites / 797 tests**. Added coverage includes unchanged ancestors, missing timestamps, inclusive time bounds, root/subtask pagination, no-change output and real worker/SDK continuation after a deep-branch 429 without replaying a completed preceding root. Both newly found connector bugs were reproduced before their fixes.

Seven supplementary real worker/SDK HTTP cases cover discovery at 7,999/8,000/8,001/8,109 projects, exact uploaded JSONL IDs and 2,000-record SDK batches, zero task-count calls, no partial publication after page 80 returns 429, and eight workers sharing a synthetic quota in initial/incremental modes. These ran on the preceding 429-fix source; they are not evidence of 8,000 live imported projects.

## Fresh DEV runs on the final source

Four new private projects and dedicated destination parts were created after deployment. Each initial fixture has 3 roots, 2 subtasks including depth 2, 2 comments and 1 file verified by its original byte hash. Incremental changes add a root and child, update a root and the depth-two task, and add comments. In projects 08/10 both ancestors of the changed nested task remain untouched; 09/11 also add a root comment. No-change runs check exact stable work/comment/file IDs and duplicates.

| Project | Phase | Works/comments/files | Assertions | Failed assertions | Emitted warnings |
|---|---|---|---:|---:|---:|
| 08 | initial | 5/2/1 | 73 | 2 | 44 |
| 08 | incremental | 7/3/1 | 103 | 1 | 42 |
| 08 | nochange | 7/3/1 | 106 | 1 | 38 |
| 09 | initial | 5/2/1 | 73 | 2 | 46 |
| 09 | incremental | 7/4/1 | 105 | 1 | 40 |
| 09 | nochange | 7/4/1 | 108 | 1 | 38 |
| 10 | initial | 5/2/1 | 73 | 2 | 44 |
| 10 | incremental | 7/3/1 | 103 | 1 | 38 |
| 10 | nochange | 7/3/1 | 106 | 1 | 38 |
| 11 | initial | 5/2/1 | 73 | 2 | 40 |
| 11 | incremental | 7/4/1 | 105 | 1 | 44 |
| 11 | nochange | 7/4/1 | 108 | 1 | 38 |

The final-source runs completed 1,136 assertions: 1,120 passed; four initial custom-parent checks and twelve history-warning checks failed. Corrected incremental updates filled the four custom-parent fields once their parents were already mapped; this does not repair the initial-loading defect. Every original failure remains in the JSON evidence. A completed history is not treated as a field-correctness pass. The custom parent field and warning assertions are not suppressed. Grafana counts use exact history run IDs, emitted severity metric queries across all airdrop/airsync services, explicit target correlation and a 120-second ingestion margin.

## Deployment provenance

- 429-fix: commit `d6d6a901f399802e7a73eaf0b3fc68c0e1897272`, digest `sha256:774ae85f21a8725961354bfdb8e23c62c034ec7e58a67cce72576cc15494a7a5`, DEV version `don:integration:dvrv-us-1:devo/1Db8mOoXww:snap_in_package/8829cc78-95eb-43e4-87a5-110f35c2a3e0:snap_in_version/2fc9d471-098f-41d8-978f-28d4a66b7e82`.
- nested-fix: commit `a1da45c4695cec84b266f4107e810e0fc4e76de7`, digest `sha256:7f57f698f5f106032494295e8e9a779a6a464543a15daa09ade83299303072ad`, DEV version `don:integration:dvrv-us-1:devo/1Db8mOoXww:snap_in_package/8829cc78-95eb-43e4-87a5-110f35c2a3e0:snap_in_version/45fd4df1-b224-4656-9bf0-854932c7b056`.

The active lambda version and uploaded archive package/lock/compiled worker/helper hashes were checked. Covered source remained frozen across its runs. Credentials and raw logs remain in restricted scratch files. This adapts the Asana E2E skill to a dedicated source-pinned lambda and does not claim a marketplace installation passed.

## Backend work and remaining limits

The existing devrev-loader bug still drops `ctype__parent_task` for a depth-two deferred reference because the update omits the existing subtype. Its separately prepared patch has a red-to-green regression and passing full Go tests/vet, but is not deployed. This round again verifies the actual missing value and correlated `FieldNotInSchema` warnings. Hierarchy links and the custom parent field are checked separately.

The new recipe-manager patch has a real Mongo-driver/mock-wire red-to-green test, full v2/internal tests, focused race tests and vet. A live replica-set contention test and a patched backend DEV retest were not performed. The original failed mapping was reconciled read-only and the same proposed mapping was retried once; it resumed the original initial history. No duplicate import was created. These backend patches are review assets, not executable changes in the Asana repository.

The final traversal fix increases incremental root/subtask/story reads to preserve descendant completeness. Existing delay/resume support is tested, and unchanged attachment bytes are not fetched. A source event feed or equivalent guarantee is required before safely restoring ancestor pruning. This is not a customer-scale capacity assessment.

Earlier reverse and deleted-project scheduling evidence remains available in the original regression report and applies to its recorded source. It is not a new reverse test on the final source. Identity/role-denial coverage, live permission revocation, running-job cancellation, existing maximum-depth limits and comment-edit semantics remain unchanged. Stable SDK 2.0.1 can still swallow an access failure mid attachment stream; SDK PR 262 remains separate.

For cases 08/09, initial Grafana captures completed just after the incremental trigger due to a harness filename-padding error. The captures still query the exact closed initial run and interval. A prior-phase-evidence guard now prevents further triggers without the preceding checks.

The CLI smoke report is generated by the actual CLI for the final source and real initial/incremental histories. Its generic policy permits these warnings and does not establish field fidelity; it cannot override this report’s FAIL verdict. Test sync units and fixtures are retained in manual mode. No production deployment, package publication, merge or related issue closure is claimed.
