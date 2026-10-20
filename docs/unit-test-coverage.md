# Asana unit-test coverage

## Implementation changes

- Retry-After now preserves zero, parses UTC HTTP dates, and rejects valid delays too large to represent safely without retrying early. Extraction delay consumers preserve zero.
- Formula fields are requested from Asana and normalized consistently as read-only text using their display values.
- Empty custom-field text is preserved instead of omitted.
- Added a no-mock unit command and 85 unit cases. Corrected the new overflow expectation after review.

**Verification:** 8 suites and 257 tests pass; 3 existing callback cases are excluded. Whole-connector statement coverage is 36.69%; the default full-suite 80% gate is unchanged. Component, static, live, and default full-suite tests were not run.

## Scenario inventory

19 covered, 28 partial, 33 missing, 12 inapplicable, 3 defensive-only. Coverage applies only to supplied function inputs; mapper lookups, formula transport, worker execution, and destination permission enforcement remain unverified.

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
