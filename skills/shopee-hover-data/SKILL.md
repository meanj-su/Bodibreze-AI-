---
name: shopee-hover-data
description: Extract Shopee Seller Center data that normally requires hovering over charts or reading tooltips, especially Shopee Ads Performance by-hour Expense/Spend from Seller Center pages. Use when Codex needs to open seller.shopee.co.id, use a dedicated Chrome debugging window, wait for user login, read Vue/canvas chart sourceData, aggregate 15-minute/hourly points, or fall back to hover screenshots for Shopee backend charts.
---

# Shopee Hover Data

Use this skill for Shopee Seller Center chart data that is visible only through hover tooltips or canvas charts, especially Shopee Ads Performance by-hour Expense.

## Preferred Workflow

1. Start or reuse a dedicated Chrome debugging window so the user's main browser remains usable.
2. Navigate the debug Chrome to the Shopee Seller Center page.
3. If the page is not logged in, tell the user to log in in that dedicated window and wait.
4. Prefer reading chart data from the page's Vue component state instead of hovering.
5. Fall back to controlled hover screenshots only when component state is unavailable.
6. Report the page date/timezone and whether values came from sourceData, API, or tooltip.

## Dedicated Chrome

Start a separate Chrome profile with remote debugging:

```powershell
$chrome = (Get-Command chrome.exe -ErrorAction SilentlyContinue).Source
if (-not $chrome) { $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
$profile = Join-Path $env:TEMP 'codex-shopee-chrome'
New-Item -ItemType Directory -Force -Path $profile | Out-Null
Start-Process -FilePath $chrome -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$profile",
  '--no-first-run',
  '--no-default-browser-check',
  '<SHOPEE_URL>'
)
```

Confirm CDP is available:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9222/json/version -TimeoutSec 5
```

If login is required, stop and ask the user to log in in the dedicated Chrome window. Do not ask for credentials.

## Scripted Extraction

Use `scripts/extract_shopee_chart_data.mjs` when possible. It connects to `http://127.0.0.1:9222`, opens the URL, finds chart `sourceData`, and aggregates by hour when the page returns 15-minute points.

Run with the bundled Node.js and Playwright module path from `load_workspace_dependencies`:

```powershell
$env:NODE_PATH = '<node_modules>'
node scripts/extract_shopee_chart_data.mjs --url '<SHOPEE_URL>' --date 2026-07-07 --metric cost
```

Use `--keep-zero` only when the user wants future/empty hours shown. Use `--raw` when debugging returned chart points.

For Shopee Ads Performance, the displayed currency value is usually `cost / 100000`. The script applies this scale by default.

## Manual Playwright Pattern

If using `node_repl`, add the bundled node modules directory first, then:

```js
var { chromium } = await import("playwright");
var browserCDP = await chromium.connectOverCDP("http://127.0.0.1:9222");
var contextCDP = browserCDP.contexts()[0];
var pageCDP = contextCDP.pages().find(p => p.url().includes("seller.shopee.co.id")) || contextCDP.pages()[0];
await pageCDP.setViewportSize({ width: 1600, height: 1000 });
await pageCDP.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await pageCDP.waitForTimeout(8000);
```

Read chart data from Vue component state:

```js
var data = await pageCDP.evaluate(() => {
  function findChartData() {
    const roots = [".metric-for-chart", ".line-chart-container", "#metric-line-chart", "#app"]
      .map(sel => document.querySelector(sel)).filter(Boolean);
    const seen = new Set();
    function walk(obj, depth) {
      if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 7) return null;
      seen.add(obj);
      try {
        if (Array.isArray(obj.sourceData) && obj.sourceData.length && obj.sourceData[0]?.timestamp != null) return obj.sourceData;
        if (obj.props && Array.isArray(obj.props.sourceData) && obj.props.sourceData.length) return obj.props.sourceData;
      } catch {}
      let keys = [];
      try { keys = Object.keys(obj).slice(0, 100); } catch { return null; }
      for (const k of keys) {
        if (/parent|root|appContext|vnode|subTree|components|provides/.test(k)) continue;
        const res = walk(obj[k], depth + 1);
        if (res) return res;
      }
      return null;
    }
    for (const el of roots) {
      for (const candidate of [el.__vueParentComponent, el.__vue_app__, el._vnode, el]) {
        const res = walk(candidate, 0);
        if (res) return res;
      }
    }
    return [];
  }
  return findChartData();
});
```

## Time Handling

- Shopee Indonesia Seller Center displays dates in `GMT+7`.
- For a local date, build URLs with the GMT+7 day start/end when possible.
- Some URLs normalize `from`/`to`; trust the page's loaded chart sourceData after navigation.
- If the chart returns 15-minute points, group by `new Date(timestamp * 1000)` in `Asia/Jakarta`/GMT+7 hour.
- For custom historical dates, Shopee may return more than 24 points. Filter to the requested local date before aggregating.

## Hover Fallback

Use hover only if `sourceData` cannot be found.

1. Scroll the chart into view.
2. Inspect the canvas rectangle, not the screenshot guess:

```js
await pageCDP.evaluate(() => window.scrollTo(0, 520));
const rect = await pageCDP.locator("#metric-line-chart canvas").boundingBox();
```

3. Move to the calculated point and screenshot:

```js
await pageCDP.mouse.move(x, y);
await pageCDP.waitForTimeout(1000);
await pageCDP.screenshot({ path: "tooltip.png" });
```

If `pageCDP.mouse.move` hangs near edge points, prefer sourceData over more hover attempts.

## Reporting

Use concise tables:

```markdown
| Time | Expense |
|---|---:|
| 21:00-22:00 | Rp284.389 |
```

State:

- Date and timezone, e.g. `2026-07-07 / GMT+7`
- Metric, e.g. `Expense`
- Source, e.g. `Vue chart sourceData` or `tooltip`
- Whether partial-day future hours are omitted or shown as zero
