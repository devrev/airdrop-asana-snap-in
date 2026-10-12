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

- Baseline upgrade — medium confidence: upgraded 1.20.2 to 1.20.3 before migration. Release notes list axios and release-CI fixes without connector migration instructions. All baseline checks passed. Verify deployed Asana API traffic during rollout.
- §1 package, imports and runtime — high confidence: removed v1 and beta dependencies, pinned stable 2.0.0, migrated root imports and mocks, required Node.js 20+, and added direct development dependency `@devrev/typescript-sdk` 1.1.78 for the local runner. Existing axios and ts-node dependencies remain.
- §2 event types — high confidence: source uses `AirSyncEvent`. No deprecated event-context keys or reset flags remained.
- §3 spawn and local mode — high confidence: retained existing `baseWorkerPath`; both the test-server npm script and deployment script enable `AIRSYNC_LOCAL_DEVELOPMENT=1`.
- §4 worker results and timeouts — medium confidence: six workers return `TaskResult`, metadata helper failures bubble up and stop later enrichment, data timeout paths return progress, and redundant timeout callbacks were removed. Existing Retry-After numbers remain seconds, with the existing 60-second fallback. ESU rate limits remain errors with a retry hint. Repo pushes are awaited before cursor advancement; no push return values are consumed. Verify metadata failures, timeouts/resume, and rate-limit delays in live syncs.
- §5 adapters — high confidence: extraction helpers use `ExtractionAdapter`; loading workers receive the phase adapter from `processLoadingTask`. No SDK adapter constructors, internal state or manual state-posting calls remain.
- §6 streaming/loading callbacks — high confidence: callbacks return status unions and workers preserve SDK success/progress/delay/error results. Missing comment and attachment GIDs return per-item errors, retaining v1 failed-item behavior. No SSOR workaround exists.
- §7 external sync units — high confidence: retained the existing ESU repo configuration and awaited push; tests assert the repo contents.
- §9 HTTP — high confidence: axios imports come from the connector's existing dependency. Asana retry policy and connector error serialization remain unchanged.
- §10 mappers — medium confidence: both production lookup sites consume unwrapped records or null. `resolveExternalId` uses `Pick<Mappers, 'getByTargetId'>`, logs missing/failed lookups and retains the null fallback. Extraction skips mapped attachments and retains unmapped attachments or files whose lookup failed. Removed the obsolete mapper-404 branch. Verify reverse-sync ID resolution and duplicate-attachment suppression with real mapper records.
- §11 removed symbols — high confidence: removed old registration, adapter and response-event symbols; no deprecated event strings or deep SDK imports remain.
- §13 tests — high confidence: assertions cover returned results and default timeout registration; mapper doubles use null/unwrapped responses. Added regressions for missing GIDs, all three SDK streaming/loading progress paths, and metadata upload rejection.

Three entries need a second look during rollout: baseline upgrade, §4 and §10. No low-confidence entries.

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
