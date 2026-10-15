# v2 Migration Review

Migrated `@devrev/ts-adaas` 1.20.2 → latest stable v1 baseline 1.20.3 → `@devrev/airsync-sdk` 2.0.0.

Repository: https://github.com/devrev/airdrop-asana-snap-in
Checkout: `/Users/rado/Job/airdrop-asana-snap-in`
Branch: `codex/migrate-asana-sdk-v2-ga`
Starting commit: `605764adb47d501f9a7bcfe66803eff49f21d747`
Date: 2026-10-12
Runtime: Node.js 26.10.0 / npm 11.19.1; connector minimum Node.js 20, CI already uses 22.

The starting checkout had an added `@devrev/airsync-sdk` 2.0.0-beta.11 dependency alongside v1; all source still used v1. Initial local changes were saved before editing. Reused the earlier migration draft at the same starting commit, audited against all sections of the published GA guide, and added GA verification and regression coverage. The other draft checkout was preserved.

Guide: installed `code/node_modules/@devrev/airsync-sdk/docs/MIGRATION.md`, identical to the guide obtained by packing the registry's stable `@latest` (2.0.0) before editing.
Guide SHA-256: `12f94a58fd6d5fedfb905b5aa454cc338941e32d4868bee7414a84c88e2b8510`.

## Review entries

- Baseline upgrade — medium confidence: upgraded 1.20.2 to 1.20.3 before migration. Release notes list axios and release-CI fixes without connector migration instructions. All baseline checks passed. Verified locally on 2026-10-15: the API client implementation is unchanged apart from the event type import and a comment; real HTTP integration confirms request parameters and transient 5xx retries.
- §1 package, imports and runtime — high confidence: removed v1 and beta dependencies, pinned stable 2.0.0, migrated root imports and mocks, required Node.js 20+, and added direct development dependency `@devrev/typescript-sdk` 1.1.78 for the local runner. Existing axios and ts-node dependencies remain.
- §2 event types — high confidence: source uses `AirSyncEvent`. No deprecated event-context keys or reset flags remained.
- §3 spawn and local mode — high confidence: retained existing `baseWorkerPath`; both the test-server npm script and deployment script enable `AIRSYNC_LOCAL_DEVELOPMENT=1`.
- §4 worker results and timeouts — medium confidence: six workers return `TaskResult`, metadata helper failures bubble up and stop later enrichment, data timeout paths return progress, and redundant timeout callbacks were removed. Existing Retry-After numbers remain seconds, with the existing 60-second fallback. ESU rate limits remain errors with a retry hint. Repo pushes are awaited before cursor advancement; no push return values are consumed. Verified locally on 2026-10-15 against real SDK worker callbacks, including metadata short-circuiting, timeout defaults, persisted data cursor/resume, Retry-After seconds and fallback, and ESU errors.
- §5 adapters — high confidence: extraction helpers use `ExtractionAdapter`; loading workers receive the phase adapter from `processLoadingTask`. No SDK adapter constructors, internal state or manual state-posting calls remain.
- §6 streaming/loading callbacks — high confidence: callbacks return status unions and workers preserve SDK success/progress/delay/error results. Missing comment and attachment GIDs return per-item errors, retaining v1 failed-item behavior. No SSOR workaround exists.
- §7 external sync units — high confidence: retained the existing ESU repo configuration and awaited push; tests assert the repo contents.
- §9 HTTP — high confidence: axios imports come from the connector's existing dependency. Asana retry policy and connector error serialization remain unchanged.
- §10 mappers — medium confidence: both production lookup sites consume unwrapped records or null. `resolveExternalId` uses `Pick<Mappers, 'getByTargetId'>`, logs missing/failed lookups and retains the null fallback. Extraction skips mapped attachments and retains unmapped attachments or files whose lookup failed. Removed the obsolete mapper-404 branch. Verified locally on 2026-10-15 with the real SDK mapper HTTP client: record/404/403 responses, attachment suppression/retention, loader create/update and mapper writes, and loader failure without advancing the cursor.
- §11 removed symbols — high confidence: removed old registration, adapter and response-event symbols; no deprecated event strings or deep SDK imports remain.
- §13 tests — high confidence: assertions cover returned results and default timeout registration; mapper doubles use null/unwrapped responses. Added regressions for missing GIDs, all three SDK streaming/loading progress paths, and metadata upload rejection.

The three originally medium-confidence entries retain their initial labels for the migration audit. All three now have passing local HTTP integration evidence below; no migration decision remains unverified locally. No low-confidence entries.

§8 was a no-op: connector state contains no top-level SDK bookkeeping, colliding state keys or SDK-owned sync cursor; extraction already reads `extract_from`/`extract_to`. §12 and §14 had no code hits. Updated README, AGENTS.md and docs/tdd.md to describe the v2 worker contract, local mode, actual comment-update behavior and state rollback requirements.

## Verification

| Check | v1 baseline 1.20.3 | Stable v2 2.0.0 |
|---|---|---|
| Production TypeScript (`npx tsc --noEmit`) | Passed | Passed |
| ESLint (`npm run lint`) | Passed | Passed |
| Build (`npm run build`) | Passed | Passed |
| Jest (`npm test -- --runInBand`) | 20 suites / 586 tests passed | 20 suites / 592 tests passed |
| Expanded TypeScript (source, tests and excluded local runner) | Passed | Passed |
| Final `npm install` | Passed | Passed |
| Local server startup | — | Passed; empty async event batch returned HTTP 200 |
| Migration sweep, including hidden files and local runner | — | Only legitimate direct typescript-sdk dependency, runner import and documentation hits |
| Mapper call-site inspection | — | Both production call sites verified |
| Diff whitespace check | — | Passed |

V2 verification passed on the first attempt, within the guide's four-attempt limit. Local server was stopped after the startup check; the empty batch ran no sync or external-system operations.

Evidence logs and initial local-change snapshot: `/Users/rado/Documents/Codex/2026-10-12/let/work/` (baseline/ and v2/). The expanded temporary tsconfig is `work/tsconfig.local.json` and includes source unit tests as well as `code/test/`.

## Pre-existing

No baseline compiler, lint, build or test failures. npm audit reported dependency vulnerabilities during installation; dependency security cleanup was not part of this migration.

## Unresolved

- No migration-added verification failures or identified package/guide defects.
- Live initial, incremental, reverse, attachment, timeout and rate-limit syncs remain unverified; no deployment was performed.
- Upgrade between runs after v1 workers finish. Once v2 persists state, rollback requires a verified saved v1 state with the v1 connector, or explicit reset/reinitialization and reimport. Draining alone does not restore v1 compatibility.

## PR review follow-up — 2026-10-15

Addressed all three reviewer comments: attachment extraction and both loading workers directly return the SDK operation result and omit redundant completion/start logs.

Added `code/src/sdk-migration.integration.test.ts`: 16 integration cases using real worker threads, the installed 2.0.0 worker driver, SDK HTTP clients, real Asana client/connector helpers, and local SDK MockServer endpoints. The worker bootstrap redirects only the Asana base URL; it does not mock the task, mapper methods, error handlers, result translation or state persistence. Timeout tests deliver the SDK's soft-timeout worker message while a real HTTP request is in flight and assert the wire callback and saved state. This validates worker timeout handling; it does not exercise the spawn timer or a deployed Lambda deadline.

| Original medium-confidence entry | Additional evidence | Result |
|---|---|---|
| Baseline upgrade | Asana client behavior unchanged by source diff; actual HTTP request parameters and 500→200 retry, with existing unit coverage for auth configuration | Verified locally |
| §4 results/timeouts | Metadata 403/429 stops later enrichment/upload; exactly one callback; metadata soft timeout returns progress; data 429 preserves 120 seconds or 60-second fallback; ESU 429 remains a phase error; flat v1 state becomes v2 envelope; fresh continuation worker resumes at page 2 with correct totals | Verified locally |
| §10 mappers | Actual SDK lookups unwrap records, convert 404 to null and propagate 403; attachment filter skips mapped files and keeps unmapped/failed lookups; real loader chooses create/update correctly and writes the mapper; 429 and mapper errors retain the item cursor | Verified locally |

Follow-up checks: production TypeScript, expanded TypeScript (including tests/local runner), ESLint and build pass. Full Jest suite: **21 suites / 608 tests pass**, including all 16 new integration cases. Diff whitespace check passes.

Live deployment remains untested. Local verification supports merging the code; upgrade between runs using the state/rollback guidance above. PR checks and required approval must pass independently. The pre-existing CircleCI Pipeline status reports "No configuration was found in your project" on both this PR's original commit and main; it is not a migration test failure. Repository rules require a code-owner approval, approval after the latest push, and resolved review threads.
