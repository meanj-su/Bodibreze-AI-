# Shopee AdsPower Scraper

Read-only inspector for Shopee Seller Center pages that are already open inside AdsPower.

## What It Does

- Reads currently opened AdsPower browsers from AdsPower Local API.
- Connects to each opened browser through Playwright CDP.
- Checks existing tabs for Shopee Seller Center URLs.
- If no Seller Center tab is open, prints the opened tabs and asks you to open Seller Center manually.
- If Seller Center is open, reads page data such as visible tables, summary-like metric cards, Vue chart datasets, and ECharts summaries.

It does not open Chrome, reopen AdsPower profiles, navigate to URLs, click, type, screenshot, hover, or modify page content.

## Run

```powershell
cd E:\AI项目汇总\shopee-adspower-scraper
npm run inspect
```

If Playwright is not installed in this project but already exists in an npm cache or another project:

```powershell
$env:NODE_PATH = "C:\path\to\node_modules"
node .\scripts\inspect-current-seller-center.mjs
```

Inspect only one currently opened AdsPower profile:

```powershell
node .\scripts\inspect-current-seller-center.mjs --profile-id kyme0da
```

Return machine-readable output:

```powershell
node .\scripts\inspect-current-seller-center.mjs --json
```

Export Shopee Ads hourly data from already-open Indonesia, Malaysia, and Thailand AdsPower Seller Center tabs. The exporter captures `report/get_time_graph` first and falls back to Vue chart `sourceData`:

```powershell
npm run export:ads-hourly
```

Export a specific local date:

```powershell
npm run export:ads-hourly -- --date 2026-07-07
```

Continuously refresh and update the CSV:

```powershell
npm run export:ads-hourly -- --watch --interval-ms 60000
```

The CSV is written to `exports\shopee_ads_hourly_<date>.csv`.

## Exit Codes

- `0`: Seller Center page found and analyzed.
- `1`: Runtime error.
- `2`: No matching opened AdsPower browser.
- `3`: AdsPower browser connected, but no Seller Center page is open.

## Shopee Ads Autopilot

Long-running Shopee Ads hourly backfill and recommendation tool for already-open AdsPower profiles ID/MY/TH.

Commands:

```powershell
cd E:\AI项目汇总\shopee-adspower-scraper
npm run ads:autopilot
npm run ads:autopilot -- --days 7 --no-google
npm run ads:autopilot -- --date 2026-07-16 --country MY --no-google
npm run ads:analyze -- --legacy exports\shopee_ads_hourly_2026-07-16.csv --no-google
npm run ads:google -- --dry-run-google
```

Outputs are written to `exports\ads-autopilot`:

- `hourly.csv`: country/date/hour metrics and source URL.
- `daily.csv`: country/date rollup for spend, GMV, ROI, traffic, impressions, clicks, orders, CTR, CPC.
- `recommendations.csv`: country/hour action recommendations using Broad ROI as primary decision signal and Direct ROI as risk signal.
- `latest.md` and `latest.json`: latest local summary.
- `state\runlog.csv`: run coverage, row counts, Google status, errors.

Google sync targets these dedicated sheets: `ShopeeAds_Hourly`, `ShopeeAds_Daily`, `ShopeeAds_Recommendations`, `ShopeeAds_RunLog`. If Google sync fails, local outputs are still kept and the failure is recorded in runlog.

Task Scheduler:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-ads-autopilot-task.ps1 -IntervalMinutes 60
```

This registers `ShopeeAdsAutopilot-Realtime` and `ShopeeAdsAutopilot-YesterdayRecheck` with working directory fixed to this project root.
## Silent Product ID Reports

The automated report pipeline runs in the background through Windows Task Scheduler and `wscript.exe`, so it does not open a visible `node.exe` or PowerShell window.

Install or refresh the silent tasks:

```powershell
cd E:\AI项目汇总\shopee-adspower-scraper
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-ads-autopilot-task.ps1 -Silent -IntervalMinutes 60 -ReportWindowBeijing 09:00-19:00 -ReportIntervalHours 2
```

Registered tasks:

- `ShopeeAdsAutopilot-Realtime`: hourly PAS backfill, no Google write.
- `ShopeeAdsAutopilot-YesterdayRecheck`: daily recheck.
- `ShopeeAdsAutopilot-Report-0900/1100/1300/1500/1700/1900`: weekday Beijing-time rolling HTML+Excel reports.

Manual report commands:

```powershell
npm.cmd run ads:report
npm.cmd run ads:report -- --skip-collect --no-export
npm.cmd run ads:report:generate -- --date 2026-07-20
```

Report outputs:

- `exports\ads-autopilot\reports\latest-report.html`: main report with offline SVG charts.
- `exports\ads-autopilot\reports\latest-report.xlsx`: workbook with Summary, Hourly, Product Detail, Recommendations, and Shop Level sheets.
- `exports\ads-autopilot\reports\product-recommendations.csv`: Product ID action table.
- `exports\ads-autopilot\logs\hidden-runner_*.log`: background task logs.

Product ID diagnostics read the official Shopee Ads combined workbook from `D:\Shopee Export\Combined\Shopee Ads`. If today's workbook is missing or older than 90 minutes, `ads:report` triggers the official Shopee Ads export through the already-open AdsPower profiles. The tool only generates recommendations; it does not change ad budgets, bids, or statuses.
If today's official Product ID workbook is unavailable after export, the report falls back to the latest available Shopee Ads combined workbook and clearly shows the Product data date in latest-report.html and the run log.

## Product Performance Backup and Impact Diagnosis

`ads:report` now follows a backup-first flow:

1. Run hourly Ads backfill unless `--skip-collect` is used.
2. Ensure the official Shopee Ads combined workbook for the report date is fresh.
3. Ensure the official Product Performance combined workbook for the report date is fresh.
4. Parse Product Performance link-level rows where `Variation ID = "-"` and aggregate by `country + Item ID`.
5. Write a timestamped backup snapshot under `exports\ads-autopilot\backups\YYYY-MM-DD\HHMM\`.
6. Build Product Impact diagnostics by joining Shopee Ads `Product ID` with Product Performance `Item ID`.

New report CSV outputs:

- `exports\ads-autopilot\reports\product-performance.csv`: link-level Product Performance baseline data.
- `exports\ads-autopilot\reports\product-impact.csv`: Ads + link performance comparison table.
- `exports\ads-autopilot\reports\backup-manifest.csv`: latest backup snapshot manifest in CSV form.

New Excel sheets:

- `Product Performance`
- `Product Impact`
- `Impact Recommendations`
- `Backup Manifest`

HTML now shows report generation time, hourly data update time, Shopee Ads detail update time, Product Performance update time, Product Performance data date, comparison base date, and source status. If no historical backup is available, the report marks the run as `baseline_today`; after the next backup exists, it compares against yesterday by default and falls back to the latest earlier backup when yesterday is unavailable.

Product Impact action codes:

- `positive_scale`: ad spend/clicks increased and link sales/orders improved without material CVR decline.
- `effective_maintain`: ad ROAS is acceptable and link traffic or orders stayed stable.
- `traffic_without_conversion`: ad clicks increased but link orders or conversion rate did not improve.
- `efficiency_squeeze`: ad spend increased while link sales, ROAS, or conversion rate declined.
- `link_issue_first`: link-side engagement or conversion metrics are weak.
- `pause_diagnose`: ad ROAS is below threshold or ad clicks are high while the link has no orders.
- `baseline_today`: backup is captured, but comparison is not available yet.
