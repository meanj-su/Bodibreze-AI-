---
name: shopee-official-excel-export
description: Export official Shopee Seller Center files through the visible Export Data, Latest Reports, Export Management, and Download flows in already logged-in AdsPower or Chrome CDP sessions. Use when Codex is asked to download Shopee Product Performance, Voucher, Shopee Ads, or Affiliate reports for Indonesia, Malaysia, Thailand, or configured countries; run guided country/module/date prompts; preserve original downloads; create supported derived combined workbooks; optionally sync supported modules to Google Sheets. Do not use for private API reverse engineering, page cache extraction, task queues, schema regression, or production GUI workflows.
---

# Shopee Official Excel Export

## Objective

Download Shopee Seller Center official report files through the configured browser sessions, preserve every original download unchanged, and generate only the supported derived outputs needed for downstream reporting.

## Required Inputs

Determine these before running:

- Countries: configured country names, codes, or aliases such as `Indonesia`, `Malaysia`, `Thailand`, `ID`, `MY`, `TH`.
- Modules: `Product Performance`, `Voucher`, `Shopee Ads`, or `Affiliate`.
- Date range: explicit range like `2026/07/01~2026/07/13`, a supported shortcut, or the module default.
- Export approval: real downloads require explicit approval or the `--approved-real-export` flag.

Use guided prompts when country, module, or date is missing. For `Affiliate`, default to the page's recent-30-day export and ignore the ordinary requested date unless the module config changes.

## Quick Commands

PowerShell:

```powershell
node "$env:USERPROFILE\.codex\skills\shopee-official-excel-export\scripts\shopee-export.mjs"
node "$env:USERPROFILE\.codex\skills\shopee-official-excel-export\scripts\shopee-export.mjs" "Indonesia Malaysia Product Performance: 2026/07/01~2026/07/13"
```

cmd:

```cmd
node "%USERPROFILE%\.codex\skills\shopee-official-excel-export\scripts\shopee-export.mjs"
node "%USERPROFILE%\.codex\skills\shopee-official-excel-export\scripts\shopee-export.mjs" "Indonesia Malaysia Product Performance: 2026/07/01~2026/07/13"
```

Approved real export:

```powershell
node "E:\AI项目汇总\shopee-official-excel-export\scripts\shopee-export.mjs" --approved-real-export "Indonesia Malaysia Thailand Affiliate"
```

## Workflow

1. Parse the natural-language command, or ask guided questions in this order: country, module, date range.
2. Load `config/default.config.json` and user overrides from `%USERPROFILE%\.codex\shopee-official-excel-export.config.json`.
3. Detect active AdsPower profiles through the AdsPower Local API.
4. Map each active profile to its configured country.
5. For each requested country/module, find a matching Seller Center page by host, target path, URL hints, and module hints.
6. If no matching page is open and the module has a configured target URL, open that URL in the matching already-open AdsPower profile and continue.
7. Run preflight checks:
   - AdsPower is reachable.
   - The profile is open and mapped.
   - The page is Shopee Seller Center and appears logged in.
   - The page country and module match the request.
   - The date control is readable when the module requires date selection.
   - Export Data is visible and enabled.
8. If simulation mode is active, stop after readiness checks and report status.
9. If real export is approved, execute the module's official export flow.
10. Save the official downloaded file under the configured output root and print path, filename, byte size, SHA-256, status, and timing.
11. Build supported derived combined workbooks only after original downloads are saved.
12. Sync supported modules to Google Sheets only when `googleSheets.enabled` and `writeAfterExport` are true.
13. Disconnect the automation client. Do not close or restart AdsPower profiles.

## Decision Rules

- If a page check fails, or a configured resource cannot be found, tell the user to confirm the corresponding page is opened/verified or to modify the request before continuing.
- If the first date selection succeeds for a module/country, reuse the same proven click flow for later days and only re-check deeply when the page state becomes inconsistent.
- If `Export Data` does not produce a Latest Reports response, retry the export click every configured 10 seconds until the report appears or the timeout expires. Treat platform 60-second same-module throttling as expected pacing, not a reason for broad debugging.
- For modules without Latest Reports, such as Voucher, stop retrying once a download succeeds or a terminal download error is detected.
- Run different countries and independent modules in parallel when configured. Keep same country/module exports paced by the configured interval.
- Let one task fail without stopping unrelated countries or modules.
- Prefer configured URLs, paths, aliases, profile IDs, output directories, and timing values over hard-coded logic.
- Do not rerun existing expensive checks when an earlier task in the same run already established the page shape and the next action can safely follow the validated flow.

## Module Rules

- Product Performance: split multi-day requests into daily By Day exports, preserve every daily official workbook, then generate derived combined workbooks with date rows sorted ascending. Final derived data filters `Variation ID` to `-` and applies Indonesia numeric normalization only in the derived output.
- Voucher: use the official marketing voucher export flow, preserve original downloads, and generate supported derived combined workbooks.
- Shopee Ads: export configured ads sections. Indonesia only downloads `All Product Ads`; that official file already includes Shop Ads rows, so do not download a separate Indonesia `Shop Ads` section. If a historical run contains both sections, the derived combiner removes duplicate Shop Ad rows from `All Product Ads`.
- Affiliate: download and preserve the official recent-30-day conversion report only. Do not write Affiliate data to Google Sheets.

## Resources

Use these resources as needed:

- `scripts/shopee-export.mjs`: primary guided and natural-language export runner.
- `scripts/export-official-excel.mjs`: compatibility wrapper for the same runner.
- `scripts/write-google-summary.mjs`: Google Sheets writer for supported modules only; Affiliate is excluded.
- `config/default.config.json`: country, profile, module, URL, output, timing, and Google Sheets settings.
- `references/export-flow.md`: detailed export-flow reference for implementation or debugging.
- `agents/openai.yaml`: UI metadata for skill listing and default prompt.

Do not read every reference by default. Load `references/export-flow.md` only when changing or debugging the export flow. Keep SKILL.md as the SOP entry point; place detailed business rules in `references/` and deterministic repeated steps in `scripts/`.

## Tool Usage

- Use `scripts/shopee-export.mjs` instead of reimplementing browser automation.
- Run `npm.cmd run check` or the equivalent `node --check` commands after code changes.
- Use `--approved-real-export` only when the user has explicitly approved a real export.
- Use user config overrides for machine-specific settings instead of editing defaults for local-only behavior.
- For Google Sheets work, keep source downloads unchanged and write only supported derived data.

## Output Requirements

Final user-facing output must include:

- Completed and failed country/module tasks.
- Original download paths for successful tasks.
- Derived combined workbook paths when created.
- Google Sheets sync status only for supported modules.
- Timing summary when a real export ran.
- Clear next action when a task is blocked by verification, login, missing page, or missing resource.

## Validation

Before saying the task is complete:

- Confirm scripts pass syntax checks after code changes.
- Confirm every successful real export has a saved file path and SHA-256 hash.
- Confirm original downloaded files were not edited or overwritten by derived processing.
- Confirm derived combined workbooks open/read successfully when they are generated.
- Confirm Google Sheets sync is skipped for Affiliate and only runs for supported modules.
- Confirm failures are reported with the country, module, date range, and concrete recovery instruction.

## Safety Constraints

- Do not log in, solve verification, refresh arbitrarily, close profiles, restart AdsPower, or modify browser accounts unless the user explicitly asks.
- Do not construct private Shopee API requests or reverse-engineer endpoints for official report downloads.
- Do not use page cache, SourceData, collectors, production GUI, task queue framework, schema regression, manifests, or validation reports.
- Do not modify original Shopee downloaded files. Apply filtering, normalization, formulas, and sorting only in derived outputs or Google Sheets writers for supported modules.
- Do not expose service account keys, tokens, cookies, browser storage, or account credentials in logs or final output.
- Ask before deleting test files, overwriting existing outputs, or making external write actions that are not already part of the requested flow.

## Completion Criteria

Treat the task as complete only when:

- Requested exports either completed or have actionable failure reasons.
- Successful original files are preserved unchanged.
- Supported derived outputs are generated and verified when required.
- Supported Google Sheets writes are complete or clearly reported as failed.
- Affiliate has no Google Sheets write attempt.
- The user receives paths, statuses, and timing in concise Chinese.
