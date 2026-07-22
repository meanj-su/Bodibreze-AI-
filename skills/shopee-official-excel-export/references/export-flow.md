# Official Export Flow

This skill intentionally avoids the previous Production GUI architecture. Keep the implementation small, inspectable, and focused on official Excel export only.

## Command Handling

Prefer natural-language and guided interaction:

- Parse country names from standalone lines.
- Parse modules from configured module names and aliases.
- Parse date ranges from `YYYY/MM/DD~YYYY/MM/DD`, `YYYY-MM-DD~YYYY-MM-DD`, `M/D~M/D`, `昨天`, `今天`, `最近7天`, and `最近30天`.
- If a command omits country, module, or date, ask the user to choose.
- Expand `全部模块` to every module listed in configuration.
- Build a sequential batch as `country -> module -> export`.
- Let one task fail without stopping subsequent tasks.

## Preflight Scope

Preflight is read-only. It must not click, refresh, navigate, switch dates, or inspect Latest Reports.

Required checks:

- AdsPower Local API is reachable.
- A matching already-open AdsPower profile exists.
- Current page is Shopee Seller Center and appears logged in.
- Current page matches the requested country/site.
- Current page matches the requested module.
- Current page date range is readable.
- Requested date equals current page date before real export.
- Export Data button is visible and enabled.

Latest Reports is not a preflight requirement. It exists after an export is triggered.

## Real Export Scope

Real export may perform only these page actions:

1. Click official Export Data once.
2. Open/check official Latest Reports after the export click.
3. Click official Download for the matching ready report.

All downloads must be captured through Playwright's `download` event and saved to the user-selected output directory.

After the run, disconnect only the automation client. Do not close the user's AdsPower Browser profile.

## Matching The Current Page

Do not default to the first Shopee page when multiple pages are open. Candidate pages must be filtered by:

- Seller Center hostname
- requested site
- requested module URL/path/title hints

If multiple pages match, ask the owner to choose and rerun with an explicit page index or URL fragment.

## Output Contract

Return:

- workbook path
- original suggested filename
- saved filename
- byte size
- SHA-256 hash
- download time
- task status summary

Do not generate normalized JSON, schema reports, manifests, validation reports, dashboards, or queue state.
