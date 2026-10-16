# Asana marketplace end-to-end test

**DevRev:** FORGE-641, FORGE-699

Tested on 2026-10-16 against the live dev marketplace in org `devrev` (787). [Open the Asana test draft](https://app.dev.devrev-eng.ai/devrev/settings/snap-ins/developer-console/inbox/don%3Aintegration%3Advrv-global%3Adevo%2F787%3Amarketplace%2F653d1e49-7f0a-4009-91df-05436191ec56%3Amarketplace_submission%2F878b149c-7c45-46db-bc20-1e748982defb). The submission remains restricted, in `draft`, with automatic publication disabled.

## Source versions

- Asana connector source: `ee2a31f4e4ef746c7650f9c78e2f67ac430eec19`.
- GitHub Action: `33e2882573240c1c4a261c616b09432bb1bcc71d` on `tilenk/forge-699-marketplace-yaml`.
- Content skill and contract: `cc90f0ebf081ce89dacdc3c29997e4ddb6cbb93e` on `tilenk/forge-641-marketplace-yaml-contract`.
- Asana content and evidence: this commit on `tilenk/asana-marketplace-content-e2e`.

## Results

| Check | Result |
| --- | --- |
| Content preparation | YAML, published article handoff, source attribution, official logo, 512×512 icon, and 1500×600 banner created and inspected. |
| Change detection | The actual Action binary selected this connector for listing-only, media-only, and deleted-media paths; docs-only changes selected nothing. |
| Full Action execution | Built/packaged the connector, created its dev package/version and initial draft, then populated listing content, blueprint, version, and code-change link. Corrected full run exited 0. |
| Independent API readback | Name, tagline, summary, Markdown description, documentation URL, category, null dev part, draft state, version, blueprint, and code-change link all matched. |
| Uploaded bytes | Downloaded icon and banner hashes exactly matched the repository files; final draft has one icon and one banner. |
| Unchanged content retry | Zero POST writes or image uploads; artifact IDs unchanged. Repeated after restoration and final copy correction. |
| Explicit clearing | `documentation_link: null` and `media: []` cleared both persisted fields, preserved the icon, and used two submission updates. |
| Restoration | Restored the documentation URL and banner with one image upload and two submission updates. A following unchanged retry made zero writes. |
| UI readback | Verified rendered copy, Project Management category, documentation URL, one banner, icon, and Draft state in the dev developer console. |

`marketplace-e2e-evidence.json` contains the sanitized field checks, asset IDs/hashes, detector outputs, and request counts. It contains no credentials or signed download URLs.

## Bugs found and fixed

1. Attached marketplace images can have no artifact `parent_id`; querying assets by submission parent missed them and uploaded duplicates. The Action now reads attached icon/media references and hashes their downloaded bytes.
2. The marketplace rejects `artifacts.set` with already-attached IDs. Media removal also deletes the underlying artifact. The Action now removes obsolete media and appends missing images in declared order, retaining the reusable prefix. The corrected run recovered the draft with duplicate media left by the failed retry. Regression tests model both live behaviors and cover reorder plus unchanged retry.

The content contract and all three generated plugin packages were updated to describe these API semantics. Action tests, `go vet`, and repository-pinned golangci-lint v2.10.1 passed. Codegen's 37 Python tests and two OpenCode tests passed; all three packages were rebuilt and their contract copies match source. The standalone installed plugin-creator validator was unavailable.

## Local test configuration

The public connector repository ignores root `marketplace.yaml`; deployment configuration belongs to the deployer repository. This test used a local ignored file with dev listing and package slug `asana-airsync-forge-699-e2e`, and the existing `asana-oauth-secret` developer connection. No credentials are stored in listing content. A deployed workflow needs the corresponding root configuration and access to that developer connection.

The full Action ran as a locally compiled production binary against live dev APIs, with the existing source code link `https://github.com/devrev/airdrop-asana-snap-in/pull/79`. It did not run on a GitHub-hosted runner, post a PR comment, or exercise release binary download. The Action branch must be released and the caller's path filters must include `marketplace/**` before this behavior is available through the hosted workflow.

No connector sync was run. `REQUIRE_SMOKE_TEST_REPORT=false` allowed the missing sync validation report; this test establishes marketplace content preparation, not connector review readiness. Dev accepts `part: null`, although the UI marks Part required; production needs its own verified category and connector part. Nothing was submitted for review or published.

## Article discrepancy

The existing published Asana setup article ART-22648 still says comments sent to Asana are create-only. Current loading code implements comment updates. Listing copy follows the implemented code; `marketplace/setup-article.md` preserves the existing article snapshot. Updating and publishing the article remains separate follow-up work.

## Part resolution follow-up

On 2026-10-16, the Action at `5bb8626` was checked against live QA and production APIs without remote writes. QA preflight with `part: null` resolved the existing test enhancement ENH-31 (`don:core:dvrv-us-1:devo/188:enhancement/31`). Production Asana lookup preferred feature FEAT-3145 (`don:core:dvrv-us-1:devo/0:feature/3145`) over the same-named enhancement ENH-2504, using 50 GET requests and zero writes. Neither path creates parts.

Regression tests cover feature preference across paginated results, enhancement fallback when no feature matches, ambiguity between features, lookup failures before writes, explicit production IDs, and skipping all content/part resolution for existing listings. The dev draft from the full test retains its null part; the QA/production follow-up did not create submissions or change the dev draft. The content contract at `02ccf36` documents this selection policy.
