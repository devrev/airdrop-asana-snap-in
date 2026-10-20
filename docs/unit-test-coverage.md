# Asana unit-test coverage and handoff

Audit completed 2026-10-20 on `tilenk/test-connector-unit-tests`. Work stayed on that branch. No push, PR, deployment, live sync, worker execution, component tests, or static validation was performed.

## Scope and evidence

The audit used the 95 ordered scenarios in `connector-generation:connector-unit-tests/references/unit-test-scenarios.md`, the connector PRD and TDD, manifest, EDM, IDM, generated Asana OpenAPI models, implementation and existing tests. No standalone Spec or plan was found. Three Luna agents audited normalization, reverse sync, and metadata/permissions.

Only direct connector-function tests with supplied data, real errors and fixed time inputs were selected. No mocks, spies, fake timers, replacement clients, HTTP servers or worker runners are used by the selected cases. Reverse-sync tests bind the real production resolver to a real SDK mapper; numeric GIDs take the direct path, so no mapper lookup is executed. State preparation receives an event/state data object with no replacement methods. Some normalization functions internally use ambient time; those synthetic timestamps are deliberately not asserted.

The initial four-suite baseline passed 175 tests. Coverage initially failed to collect because the installed SDK dependency was absent; `npm ci --ignore-scripts --no-audit --no-fund` restored lockfile dependencies and collection succeeded. Further inspection found two handwritten mapper callbacks in one existing group; that entire three-case group is excluded from the dedicated command. The eligible existing baseline is therefore 172 cases. Existing mocked suites and the SDK migration integration suite were read, but are not accepted as unit-only evidence for this audit. The normal default test command is preserved.

## Verification

Run from `code/`: `TZ=Europe/Ljubljana npm run test:unit -- --runInBand`. The review correction was verified with this explicit timezone.

Final result: **8 suites passed, 257 tests passed, 0 failures**. Three pre-existing callback-group cases are excluded. The four new suites add **85 passing cases** above the eligible 172-case baseline. Whole-connector coverage: **36.69% statements, 40.92% branches, 43.58% functions, 36.26% lines**.

Coverage includes the entire connector, including API calls and workers deliberately not executed. The dedicated command has no global coverage gate; the existing default command retains its 80% gate. Scenario completeness is reported below independently of coverage. Generated reports are ignored local artifacts under `code/coverage/unit/`.

## Confirmed defects fixed and failure investigation

- Pre-existing rate-limit defect: `Number(header) || 60` changed valid zero into 60, accepted negative delays, and discarded HTTP-date values. New direct error-handler cases failed for zero and negative seconds, then passed after both handlers adopted `parseRetryAfter`. Safe integer seconds are preserved, valid HTTP dates round up to whole seconds, equal/past dates yield zero, and invalid/missing values use 60 seconds. Signed/fractional/nonfinite literals are invalid header syntax; digit sequences above the safe integer range are valid headers and return explicit error results. An empty header value list is a defensive case, distinct from an empty wire string. Long delays are returned intact.
- All connector consumers of extraction delays now check presence instead of truthiness: metadata error conversion, metadata/data/attachment workers, and the ESU retry hint. The SDK 2.0.0 `TaskResult` union accepts numeric `delaySeconds`; its `emitFromResult` forwards that value directly. Worker-level execution is deferred.
- During the parser change, the new obsolete-asctime HTTP-date case failed in the local timezone because `Date.parse` assumed local time. This was a regression in the new code, fixed by explicitly parsing that HTTP-date form in GMT. The retained case supplies a fixed time. HTTP-date syntax is restricted before parsing to prevent permissive date parsing of malformed numeric values.
- Pre-existing formula mismatch: real Asana formulas can have base `type: number` with `representation_type: formula` or `is_formula_field: true`. `buildCustomFieldDefinition` now emits read-only text, and `extractCustomFields` uses `display_value`. Task and custom-field-settings API projections now request both formula discriminator fields. Direct builders and assembled normalized-task assertions verify the data/metadata agreement; real request/response transport remains deferred.
- Pre-existing loss of empty custom-field text: truthiness collapsed an explicit empty string into omission. Text and fallback display-value extraction now preserve empty strings while omitting null values. Regression inputs also retain zero, false and empty enum collections.
- Independent review corrected an incorrect new expectation: `9007199254740992` is valid RFC delay-seconds, not an invalid header eligible for the 60-second fallback. The original parser/test could schedule a retry earlier than the server allowed. Nine regression cases reproduced this for the parser and each handler using finite unsafe values (`9007199254740992` and the rounding-sensitive `9007199254740993`) and a 400-digit overflowing value. The parser now returns an error value, extraction returns an error record and loading returns an error status; no result schedules a delay and neither handler throws. Separate boundary cases retain `Number.MAX_SAFE_INTEGER` exactly. This is a defect introduced during the original audit, now corrected under the explicit conservative failure policy.
- No existing eligible baseline test assertion required weakening or rewriting. Targeted subset runs that hit the global 80% gate were configuration failures, not connector behavior failures. No failing case was skipped to produce a passing result; the pre-existing callback group is excluded solely by the no-mocks execution boundary.

## Expectation sources and owners

- **Identity, values and references:** Asana REST API 1.0 generated `TaskResponse`, `CustomFieldResponse` and story/attachment models; EDM field types and required names/GIDs; IDM field/reference mappings; TDD §§2.2, 2.5, 2.7–2.8. Source GIDs are stable; task/subtask dates preserve instants with JavaScript millisecond precision. Text empty-string preservation follows the distinction from nullable API values; formula text policy comes from the TDD. No new duplicate-removal or oversize fallback policy is invented.
- **Metadata:** EDM and TDD §2.5: text/float/enum/timestamp/user references, collection markers, enabled option GIDs, section GIDs and open/in-progress/closed stages. Formula read-only text is connector policy. Dynamic field installation and Recipe transformation remain outside these builders.
- **Permissions:** EDM `access_rules` and IDM authorization-policy mappings define separate users/groups, object-access targets and CRUD privilege arrays. The tested normalizer consumes already-resolved grants; it does not establish effective Asana privileges. PRD permission requirements and TDD §2.2.10 must be reconciled with current collectors before claiming inheritance, commenter, field-level or conditional support.
- **Reverse sync:** Asana REST API 1.0 task/story request models, IDM reverse mappings and EDM required fields. Partial request serialization omits undefined fields; explicit null assignee/dates clear them, and empty/null descriptions produce empty notes. Numeric source references pass through. The SDK/platform owns loading-input field selection and recipe processing; its enforcement is not verified here.
- **Errors:** RFC 9110 §§10.2.3 and 5.6.7 define Retry-After and UTC HTTP dates. The existing connector policy supplies a 60-second invalid/missing-header fallback. The parser policy clamps past dates to zero and rounds future delays up. RFC `delay-seconds = 1*DIGIT` has no upper limit; valid digit sequences that exceed safe integer seconds fail with an explicit error value, including numeric overflow, rather than falling back or scheduling early. Both error handlers propagate error results without throwing. Asana 429 responses are deferred rather than slept through; final other errors are returned. `axios-retry` owns transport retry execution, with connector settings of three retries and 2/4/8-second backoff.
- **Progress:** `prepareStateForExtraction` and the documented AirSync event contract reset connector entity progress only for a new incremental data phase. Event bounds come from the platform. SDK 2.0.0 owns persisted state, event emission and timeout defaults; its distributed migration integration tests are available but were not run here.

## Scenario inventory

Numbers follow the source checklist in order. “Covered” refers only to the supplied function inputs and assertions; “partial” leaves at least one listed variant unverified. “Missing” carries no passing-coverage claim. “Defensive-only” needs production reachability established separately. “Inapplicable” identifies absent optional mechanisms or a different owner. The inventory lists scenario inputs and final statuses. Evidence and follow-up approaches are grouped separately; test locations and classification reasons are omitted.

Scenario totals: 19 covered, 28 partial, 33 missing, 12 inapplicable, 3 defensive-only.

| # | Scenario inputs / variants | Status |
|---|---|---|
| 1 | Installation identifiers: supported installation inputs | inapplicable |
| 2 | Source field types, collections, enum keys, references and attributes | partial |
| 3 | Rename source fields and enum labels; retain source keys and IDM references | partial |
| 4 | Colliding normalized/truncated source names | partial |
| 5 | Dynamic IDM defaults and destination transformations | inapplicable |
| 6 | Stable IDs after rename, field changes and reordering | covered |
| 7 | Identical IDs across record types/accounts/import scopes | defensive-only |
| 8 | Missing stable source key | partial |
| 9 | Equivalent timestamp offsets and supported precision | covered |
| 10 | Missing/invalid timestamps and fixed-clock fallbacks | partial |
| 11 | Synthetic modified timestamps, versions and fixed clock | missing |
| 12 | Absent/null/empty scalar and collection normalization | partial |
| 13 | False and zero normalization | covered |
| 14 | Scalar, collection and structured values against EDM | partial |
| 15 | Collection duplicates and known ordering | partial |
| 16 | Unicode, multiline and escaped normalized text | covered |
| 17 | Invalid/oversized field values without collateral corruption | partial |
| 18 | Parent, author, assignee and other typed references | partial |
| 19 | Supported rich formatting, links and unsupported formatting fallback | covered |
| 20 | Known and unresolved mention identities/fallbacks | partial |
| 21 | Inline attachments and attachment-only comments | partial |
| 22 | Object permissions preserve targets, users, groups and distinct CRUD grants | partial |
| 23 | Field-level read/write and all-field grants | missing |
| 24 | One field-value condition | missing |
| 25 | Several conditions and AND/OR semantics | missing |
| 26 | User-reference conditions | missing |
| 27 | Unsupported conditions without broader grants | missing |
| 28 | Per-item shared-with roles | missing |
| 29 | User/group IDs distinct and identical across principal types | covered |
| 30 | Guest privileges without public substitution | missing |
| 31 | Anonymous/public audience | inapplicable |
| 32 | Authenticated workspace audience | missing |
| 33 | Repeated grants and source grant-combination rules | missing |
| 34 | Revised permissions remove principals or reduce privileges | partial |
| 35 | Unknown/unresolved principals without public substitution | missing |
| 36 | Inherited source grants with no override | missing |
| 37 | Inherited grants and item-specific restrictions | missing |
| 38 | Explicit empty permission result | partial |
| 39 | Missing/failed permission lookup | missing |
| 40 | Attachment IDs, parents, filenames and content types | partial |
| 41 | Unsupported URL rejected before download | missing |
| 42 | Required create fields and routing | partial |
| 43 | Missing required create fields and valid fallback/error | defensive-only |
| 44 | Explicitly read-only fields filtered from create/update | defensive-only |
| 45 | Excluded input supplies declared writable fallback | inapplicable |
| 46 | Writable and unspecified-writability inclusion | partial |
| 47 | Operation-specific create/update fields | partial |
| 48 | Connection-specific write restrictions | missing |
| 49 | Partial update omits unchanged fields | covered |
| 50 | Explicit null clearing | partial |
| 51 | Empty strings and string clearing | covered |
| 52 | Absent versus empty scalar/reference/structured collections | partial |
| 53 | All rejected collection values avoid unintended clear | missing |
| 54 | Mixed accepted/rejected collection values | missing |
| 55 | False and zero reverse-sync values | partial |
| 56 | Rich serialization, formatting, links, Unicode and escaping | covered |
| 57 | Resolved/unresolved mentions and inline references | partial |
| 58 | Selected/unselected/omitted record types and identity dependencies | inapplicable |
| 59 | Matching/nonmatching item filters and precedence | inapplicable |
| 60 | Enabled/disabled/omitted attachment-import choice | inapplicable |
| 61 | Visibility choices and default audience | inapplicable |
| 62 | Soft stop preserves pending item/cursor/completion flags | missing |
| 63 | Explicit bounds, saved times, reset and continuation precedence | partial |
| 64 | Exact source-query bounds, inclusion and precision | missing |
| 65 | Before/at/after bounds, shared timestamps, offsets and DST | missing |
| 66 | Invalid/reversed range errors | missing |
| 67 | Nonterminal token retains original scope/query | missing |
| 68 | Terminal signal emits final page and stops | missing |
| 69 | Missing/empty token with/without terminal signal | missing |
| 70 | Short/empty nonterminal page continues | missing |
| 71 | Repeated cursor with new item IDs | missing |
| 72 | Lack of progress: bounded recovery | missing |
| 73 | Overlapping IDs with advancing cursor | missing |
| 74 | Invalid or rejected opaque cursor recovery | partial |
| 75 | Field responses reordered and joined by item ID | inapplicable |
| 76 | New-run state reset and retention | covered |
| 77 | Continuation retains saved progress and time bounds | covered |
| 78 | One scope progress update leaves unrelated state intact | missing |
| 79 | ESU same key after rename | missing |
| 80 | Transient network error classification | partial |
| 81 | Server/rate-limit retry classification | partial |
| 82 | Authentication/access denied errors | covered |
| 83 | Permanent validation error | covered |
| 84 | Nonnegative Retry-After seconds including zero | covered |
| 85 | Future HTTP-date and fixed time with rounding | covered |
| 86 | Equal/past HTTP-date and fixed time | covered |
| 87 | Missing Retry-After | covered |
| 88 | Empty/malformed/nonnumeric header variants | covered |
| 89 | Negative/signed seconds | covered |
| 90 | Delay longer than execution budget | partial |
| 91 | Retry-attempt/elapsed-time limit | missing |
| 92 | Bulk CSV/JSON with escaping/Unicode/newlines | inapplicable |
| 93 | Bulk absent/null/empty values | inapplicable |
| 94 | Malformed/truncated bulk data | inapplicable |
| 95 | Counts combine created/updated/skipped/deleted/failed across pages | missing |

## Behavior gaps and follow-up work

| Gap or unresolved expectation | Evidence and effect | Approach for later agents |
|---|---|---|
| Effective source permissions | Only direct project memberships and `public_to_workspace` expansion feed rules. No proven team/project/item restriction precedence, guest derivation, field permissions, conditional grants, or multi-homed-task policy. Unknown member types are treated as users and unknown roles fall back to read. | Establish Asana effective privileges from its API and permission model first. Reconcile required PRD behavior; implement a pure grant builder where possible, then use component tests with protocol datasets and live tests for actual source/destination enforcement. Do not treat missing required permission support as optional. |
| Commenter privileges | TDD describes comment create/read grants, but EDM policy targets and collector output currently contain tasks/subtasks only. | Resolve the representation contract, then extend EDM/normalization/IDM and validate full authorization-policy snapshots. |
| Permission revocation | Independent normalizer calls remove supplied principals; extraction emits no rule when a level becomes empty. Destination replacement/deletion behavior and unchanged snapshot suppression are unverified. | Component tests across successive full snapshots; then verify actual destination access after removal/reduction. |
| Reverse-sync tags and section clearing | Worker only adds nonempty tag GIDs; absent tags and `[]` collapse to the same list. `section: null` does not perform removal. | Define exact replacement/clear semantics with the loading-input contract. Implement reconciliation against current Asana memberships/tags and component-test emitted add/remove requests; include absent, empty, all-invalid and mixed-valid inputs. |
| Reverse-sync mentions and inline references | Task/comment denormalizers use identity mention callbacks; DevRev IDs may reach Asana HTML without mapper resolution. Numeric IDs alone are proven here. | Supply real mapper protocol responses in component tests, implement async resolution at the connector boundary, and decide unresolved mention fallback without creating a wrong identity. Test inline artifact transfer separately. |
| Required/read-only/restricted loading inputs | Missing task name can reach an incomplete payload if upstream validation is bypassed; dynamic custom fields/effort are not loaded despite broad PRD/TDD bidirectional language. | Verify SDK/Recipe validation first. Keep upstream-invalid cases defensive. Scope any new writable field support and connection-specific policy separately. |
| Time ranges and multi-homing | Local extraction compares date strings lexically. Task/subtask upper-bound logic combines created/modified dates; effective latest-update semantics need a policy. Task section normalization does not receive the current project ID and can choose another project's section. | Resolve interval and multi-homing policy. Extract pure filtering/section-selection boundaries and test before/at/after, identical timestamps, offset-equivalent instants, DST, invalid/reversed dates. Use component tests for actual query construction and complete item emission. |
| Pagination and restart | Opaque offset loops, expired-token restart, overlapping pages, partial upload and mid-page progress require API/SDK execution. There is no explicit metadata/membership stall budget. | Component tests with protocol datasets for terminal/null/empty tokens, short/empty nonterminal pages, repeated tokens with new IDs, overlap, expired offsets and bounded no-progress. Then stop after upload and resume with saved progress to check item loss/duplication and counts. |
| Fresh attachment URLs and transport | Metadata does not expose content type; streaming refresh/download, unsupported URL rejection and unavailable-file policy are not unit-proven. | Component tests for URL refresh, scheme/host behavior, unavailable files, comment ownership, inline files and time filtering; live checks only after authorization for actual systems. |
| Formula transport | Direct supplied formula data passes; added opt_fields discriminators have not been exercised over HTTP. | Component tests assemble actual task/subtask/metadata HTTP responses and confirm projection/normalization and read-only metadata agree; use a live Asana formula only in a separately authorized run. |
| Synthetic timestamps and invalid dates | Users/groups/memberships/links/access rules use wall-clock timestamps; unchanged runs can get new modified dates. `toDateOnly` can pass malformed calendar strings through. | Agree stable synthetic-version and invalid-date policies. Add explicit clock inputs or a connector-owned pure calculation, then direct unit tests; use component tests for re-emission behavior. |
| Installation, selection, persistence and reporting | Constant manifest identifiers, SDK selected record types, platform time-range resolution, mapper transport, callbacks, SDK retry limits and combined loading reports are not direct unit-owned assertions. | Static consistency checks for manifest/EDM/IDM; SDK/platform contract tests for selection/bounds; component tests for retry scheduling, zero-delay propagation, single callbacks, persisted progress and counts. |

Later agents must obtain separate authorization before live syncs, deployment, pushing or PR creation. This artifact deliberately makes no claim that worker execution or destination permission enforcement passed.
