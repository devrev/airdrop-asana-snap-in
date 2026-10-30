# Asana DEV regression testing

**Overall: FAIL — keep PR94 in draft.** The deleted-project scheduling fix passed live, and reverse data assertions passed. Forward nested-parent references still fail in the backend loader.

## Artifact and method

Source: `ed6b21c0e4a8af83281fabf8ef2cc526c4112bc2`; SDK2.0.1; explicit profile `radorg-dev`.
Source digest: `sha256:a87caaa00f3d8e53fe064fee44163f9830d58e7e1ef8fe7f1e3324e25d1a074b`.
Active DEV lambda version: `don:integration:dvrv-us-1:devo/1Db8mOoXww:snap_in_package/8829cc78-95eb-43e4-87a5-110f35c2a3e0:snap_in_version/dbd7a61e-e43a-4fe3-aafb-b0442dec4ca2`.

Source was frozen across the runs. The upload archive, package, lockfile and compiled entrypoint hashes are recorded in the JSON evidence. This used an existing DEV org and authorized run-owned fixtures; no org provisioning, invitations, production deployment or marketplace publication. All initial imports were unbounded.

## Results

| Case | Evidence | Verdict |
|---|---|---|
| Local build gate | Typecheck, lint, build; 27 suites /782 tests, including63 real worker/SDK HTTP cases | PASS |
| Additional HTTP matrix |13 cases;0/1/99/100/101/250/1000 projects; page boundaries, zero task-count calls, later-page429 and recovered503 | PASS |
| Live discovery |22 actual projects; optional count omitted | PASS |
| Empty/single project |0 and1 work respectively, isolated destination parts;22 emitted warnings each from shared deferred-reference resolution | Data PASS; logs FAIL |
| Initial | 32 works,24 comments,12 original file hashes;3 missing depth-two parent fields; emitted warnings: 20 | FAIL |
| Incremental | 46 works,34 comments,18 original file hashes; stable existing IDs;4 missing parent fields; emitted warnings: 22 | FAIL |
| No-change | Stable work/comment/artifact IDs; no new works/comments/files/links;4 missing parent fields; emitted warnings: 22 | FAIL |
| Reverse | 179/179 data assertions;5 new tasks,3 subtasks,2 updates,5 comments,3 files; emitted warnings: 4 | Data PASS; logs FAIL |
| Reverse title-only | 83/83 data assertions; titles change while GID/body/assignee/dates/completion/parent remain intact; emitted warnings: 2 | Data PASS; logs FAIL |
| Deleted project, periodic both directions | Common code1 on first scheduled failure; periodic→manual; no additional forward/reverse history over 223s after failure | PASS |

All phases have exact history IDs and Grafana counts collected after a120-second ingestion margin. Emitted severity counts come from Loki metric queries, not bounded log samples. Raw logs and credentials stay in restricted scratch files.

## Findings and prepared fixes

The loader omits the existing subtype when resolving a deferred reference. Direct parent references succeed during creation; depth-two references fail with `ctype__parent_task FieldNotInSchema`. The same global resolution pass retries older records, so even the empty-project run reports warnings. The local backend patch preserves subtype, with a regression proven red→green; full Go tests and vet pass. It is **not deployed**, so this report does not claim the live defect is fixed. See `asana-deferred-parent-diagnosis.md` and `asana-deferred-parent-backend-fix.patch`.

The original verifier also expected the external user to remain the platform modifier after hierarchy link writes.18 initial and25 later assertions fail for this reason. Backend source and record correlation show link writes use SYSU-1 and update both endpoints; source creator/reporter mappings remain correct. Original failures are retained in the JSON evidence and are not counted as a connector regression. Parent-field and warning failures remain real.

Reverse logs show two missing optional flag defaults and two not-yet-mapped parent references; all actual output parents are correct. Title-only reverse logs show only the two flag-default warnings. A separate extractor patch classifies expected flag fallback as INFO and only typed mapper-not-found as DEBUG; other failures retain WARN and the same return behavior. Repository-prescribed `make vet test` passes, including lint and full race-enabled tests; see `asana-reverse-warning-backend-fix.patch` and `asana-reverse-warning-diagnosis.md`. No common terminal code is appropriate for these expected fallbacks.

The CLI-generated `airsync-smoke-v1` report passes its generic policy. That policy permits these warnings and has no field assertions; it is narrower than this report. The regression verdict remains FAIL.

## Remaining coverage

- No approved separate principals were available for new identity creation, multiple roles, authenticated nonmember denial or exact destination access policy semantics.
- Project401/402/403/404 and429 behavior was tested through real worker/SDK HTTP cases; live credential/permission revocation was not performed.
- Stable SDK2.0.1 may swallow an access error during attachment streaming after its initial guard; SDK PR262 remains open.
- The periodic experiment proves future scheduling stops in both directions. It does not prove cancellation of a job already running.
- A separate manual reverse attempt after deletion was rejected by the platform (HTTP400, no new history); a live deleted-project reverse worker invocation is unverified.
- Many-project live discovery covered22 projects;1000-project pagination was synthetic HTTP testing, not1000 live imports.

## Reproduction and retained state

Dedicated DEV snap-in `asana-smoke`, connection, fixtures, sync units and histories are retained. The deleted-project unit is manual; the two other units are manual. Source snapshot and every history are in `asana-regression-evidence.json`. The additional HTTP suite is saved as `asana-additional-http-tests.ts`; it was executed with the repository Jest aliases and ts-jest using a separate test root.

A backend review/deployment and repeat forward initial/incremental tests are required before asserting complete end-to-end success or closing related issues. The backend patches belong to different repositories and cannot be included as executable changes in the single Asana PR.
