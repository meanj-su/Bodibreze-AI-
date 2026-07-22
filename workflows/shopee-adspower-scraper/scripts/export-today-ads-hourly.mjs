#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const COUNTRY_BY_HOST = {
  "seller.shopee.co.id": { code: "ID", name: "Indonesia", zh: "印尼", timezone: "Asia/Jakarta", currency: "IDR" },
  "seller.shopee.com.my": { code: "MY", name: "Malaysia", zh: "马来", timezone: "Asia/Kuala_Lumpur", currency: "MYR" },
  "seller.shopee.co.th": { code: "TH", name: "Thailand", zh: "泰国", timezone: "Asia/Bangkok", currency: "THB" },
};

function parseArgs(argv) {
  const today = localDateKey(new Date(), "Asia/Bangkok");
  const options = {
    adsBase: "http://local.adspower.net:50325",
    outDir: path.join(process.cwd(), "exports"),
    date: today,
    timeoutMs: 30000,
    intervalMs: 60000,
    watch: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ads-base") options.adsBase = argv[++i];
    else if (arg === "--out-dir") options.outDir = argv[++i];
    else if (arg === "--date") options.date = argv[++i];
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (arg === "--interval-ms") options.intervalMs = Number(argv[++i]);
    else if (arg === "--watch") options.watch = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run export:ads-hourly
  node scripts/export-today-ads-hourly.mjs [options]

Options:
  --date <YYYY-MM-DD>     Local date to export. Default: today in Asia/Bangkok.
  --out-dir <path>        Export directory. Default: ./exports
  --ads-base <url>        AdsPower Local API base. Default: http://local.adspower.net:50325
  --timeout-ms <number>   CDP connection timeout. Default: 30000
  --interval-ms <number>  Watch interval. Default: 60000
  --watch                 Keep exporting on an interval.
  --json                  Also print JSON summary.

This script only reads already-open AdsPower tabs. It does not open browsers,
navigate, click, type, hover, screenshot, or modify page content.
`);
}

function loadPlaywright() {
  for (const packageName of ["playwright", "playwright-core"]) {
    try {
      const mod = require(packageName);
      if (mod.chromium) return mod;
    } catch {
      // Try next option.
    }
  }

  const cached = findCachedPlaywrightCore();
  if (cached) {
    const mod = require(cached);
    if (mod.chromium) return mod;
  }

  throw new Error("Playwright is not available. Run npm install or use an npx cache that contains playwright-core.");
}

function findCachedPlaywrightCore() {
  const cacheRoot = process.env.npm_config_cache ||
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm-cache") : "") ||
    path.join(os.homedir(), "AppData", "Local", "npm-cache");
  const npxRoot = path.join(cacheRoot, "_npx");
  if (!fs.existsSync(npxRoot)) return "";

  const candidates = [];
  for (const dirent of fs.readdirSync(npxRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const packageJson = path.join(npxRoot, dirent.name, "node_modules", "playwright-core", "package.json");
    if (!fs.existsSync(packageJson)) continue;
    candidates.push({
      packagePath: path.join(npxRoot, dirent.name, "node_modules", "playwright-core"),
      mtimeMs: fs.statSync(packageJson).mtimeMs,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.packagePath || "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function getOpenedBrowsers(adsBase) {
  const result = await requestJson(`${trimSlash(adsBase)}/api/v1/browser/local-active`);
  if (result.code !== 0) throw new Error(`AdsPower local-active failed: ${result.msg || result.code}`);
  return result.data?.list || [];
}

async function getProfileMap(adsBase, ids) {
  if (!ids.length) return new Map();
  const result = await requestJson(`${trimSlash(adsBase)}/api/v2/browser-profile/list`, {
    method: "POST",
    body: JSON.stringify({ page: 1, limit: 200, profile_id: ids }),
  });
  const profiles = result.data?.list || [];
  return new Map(profiles.map((profile) => [profile.profile_id, profile]));
}

function trimSlash(value) {
  return value.replace(/\/$/, "");
}

function countryFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return COUNTRY_BY_HOST[host] || null;
  } catch {
    return null;
  }
}

function isAdsPerformancePage(url) {
  try {
    const parsed = new URL(url);
    return Boolean(COUNTRY_BY_HOST[parsed.hostname.toLowerCase()]) &&
      parsed.pathname.includes("/portal/marketing/pas/index");
  } catch {
    return false;
  }
}

async function connectToProfile(chromium, opened, timeoutMs) {
  const endpoint = opened.ws?.puppeteer || `http://127.0.0.1:${opened.debug_port}`;
  return chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
}

function flattenPages(browser) {
  return browser.contexts().flatMap((context) => context.pages()).filter(Boolean);
}

function isTimeGraphUrl(url) {
  return String(url || '').includes('/api/pas/v1/report/get_time_graph') || String(url || '').includes('report/get_time_graph');
}

async function captureAdsTimeGraphData(page, options, country) {
  const captured = [];
  const bodyPromises = [];
  const onResponse = (response) => {
    if (!isTimeGraphUrl(response.url())) return;
    const bodyPromise = response.text()
      .then((body) => {
        const parsed = parseJsonSafe(body);
        const reportRows = findArraysByKey(parsed, 'report_by_time').flat().filter((row) => row && typeof row === 'object');
        if (!reportRows.length) return;
        captured.push({ url: response.url(), status: response.status(), capturedAt: new Date().toISOString(), reportRows });
      })
      .catch((error) => {
        captured.push({ url: response.url(), status: response.status(), capturedAt: new Date().toISOString(), error: error.message, reportRows: [] });
      });
    bodyPromises.push(bodyPromise);
  };

  page.on('response', onResponse);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: options.timeoutMs }).catch(() => {});
    await page.waitForTimeout(options.networkWaitMs || 15000);
    await Promise.allSettled(bodyPromises);
  } finally {
    page.off('response', onResponse);
  }

  captured.sort((a, b) => b.reportRows.length - a.reportRows.length);
  const best = captured[0];
  if (!best || !best.reportRows.length) return null;

  return {
    title: await page.title().catch(() => ''),
    url: page.url(),
    timezone: country.timezone,
    source: 'PAS report/get_time_graph',
    sourceType: 'pas-api',
    apiUrl: best.url,
    apiStatus: best.status,
    capturedAt: best.capturedAt,
    data: best.reportRows.map(normalizeTimeGraphRow).filter(Boolean),
    metrics: [],
  };
}
function normalizeTimeGraphRow(row) {
  if (!row || typeof row !== 'object') return null;
  const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : row;
  const timestamp = Number(row.key ?? row.timestamp ?? metrics.key ?? metrics.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  return {
    timestamp,
    cost: numeric(metrics.cost ?? metrics.spend ?? metrics.expense),
    impression: numeric(metrics.impression ?? metrics.impressions),
    click: numeric(metrics.click ?? metrics.clicks),
    broadOrder: numeric(metrics.broad_order ?? metrics.broadOrder),
    directOrder: numeric(metrics.direct_order ?? metrics.directOrder ?? metrics.order ?? metrics.orders),
    checkout: numeric(metrics.checkout),
    broadGmv: numeric(metrics.broad_gmv ?? metrics.broadGmv),
    directGmv: numeric(metrics.direct_gmv ?? metrics.directGmv ?? metrics.gmv),
    productImpression: numeric(metrics.product_impression ?? metrics.productImpression),
    productClick: numeric(metrics.product_click ?? metrics.productClick),
    atc: numeric(metrics.atc),
  };
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function findArraysByKey(root, targetKey) {
  const out = [];
  const seen = new WeakSet();
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 50)) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === targetKey && Array.isArray(value)) out.push(value);
      else if (value && typeof value === 'object') walk(value, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function extractAdsSourceData(page) {
  return page.evaluate(() => {
    function findAdsData() {
      const roots = [
        ".line-chart-container",
        ".metric-for-chart",
        "#metric-line-chart",
        "#app",
        "body",
      ].flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 20));

      const seen = new WeakSet();
      const candidates = [];

      function isSourceData(arr) {
        if (!Array.isArray(arr) || !arr.length) return false;
        const row = arr.find((item) => item && typeof item === "object" && !Array.isArray(item));
        if (!row) return false;
        return typeof row.timestamp === "number" && Object.prototype.hasOwnProperty.call(row, "cost");
      }

      function pickMetrics(obj) {
        if (!obj || typeof obj !== "object") return [];
        const values = [];
        for (const key of ["metrics", "chartMetrics"]) {
          if (Array.isArray(obj[key])) values.push(obj[key]);
        }
        if (obj.props && Array.isArray(obj.props.metrics)) values.push(obj.props.metrics);
        if (obj.setupState && Array.isArray(obj.setupState.chartMetrics)) values.push(obj.setupState.chartMetrics);
        return values[0] || [];
      }

      function walk(obj, depth, source) {
        if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 8) return;
        seen.add(obj);

        try {
          if (isSourceData(obj.sourceData)) candidates.push({ source: `${source}.sourceData`, data: obj.sourceData, metrics: pickMetrics(obj) });
          if (obj.props && isSourceData(obj.props.sourceData)) candidates.push({ source: `${source}.props.sourceData`, data: obj.props.sourceData, metrics: pickMetrics(obj) });
        } catch {
          return;
        }

        let keys = [];
        try {
          keys = Object.keys(obj).slice(0, 120);
        } catch {
          return;
        }

        for (const key of keys) {
          if (/parent|root|appContext|vnode|subTree|components|provides|proxy|ctx|_children|effects|__ec_inner|_chartsViews/i.test(key)) continue;
          let value;
          try {
            value = obj[key];
          } catch {
            continue;
          }
          if (value && typeof value === "object") walk(value, depth + 1, `${source}.${key}`);
        }
      }

      roots.forEach((el, index) => {
        const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).split(/\s+/).slice(0, 2).join(".")}` : ""}[${index}]`;
        for (const candidate of [el.__vueParentComponent, el.__vue_app__, el._vnode]) {
          walk(candidate, 0, label);
        }
      });

      candidates.sort((a, b) => b.data.length - a.data.length);
      return candidates[0] || { source: "", data: [], metrics: [] };
    }

    const result = findAdsData();
    return {
      title: document.title,
      url: location.href,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: result.source,
      data: result.data,
      metrics: (result.metrics || []).map((metric) => ({
        key: metric.key,
        name: metric.name,
        valueType: metric.valueType,
        selected: metric.selected,
        serverSidePrice: metric.serverSidePrice,
      })),
    };
  });
}

function aggregateHourly(data, dateKey, timezone) {
  const buckets = new Map();
  for (let hour = 0; hour < 24; hour += 1) {
    const hourText = `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`;
    buckets.set(hour, {
      date: dateKey,
      hour,
      hourText,
      points: 0,
      cost: 0,
      expense: 0,
      impression: 0,
      click: 0,
      ctrNumeratorClick: 0,
      ctrDenominatorImpression: 0,
      broadOrder: 0,
      directOrder: 0,
      checkout: 0,
      broadGmv: 0,
      directGmv: 0,
      productImpression: 0,
      productClick: 0,
      atc: 0,
    });
  }

  for (const row of data) {
    if (typeof row.timestamp !== "number") continue;
    const date = new Date(row.timestamp * 1000);
    if (localDateKey(date, timezone) !== dateKey) continue;
    const hour = localHour(date, timezone);
    const bucket = buckets.get(hour);
    if (!bucket) continue;
    bucket.points += 1;
    addNumber(bucket, row, "cost");
    addNumber(bucket, row, "impression");
    addNumber(bucket, row, "click");
    addNumber(bucket, row, "broadOrder");
    addNumber(bucket, row, "directOrder");
    addNumber(bucket, row, "checkout");
    addNumber(bucket, row, "broadGmv");
    addNumber(bucket, row, "directGmv");
    addNumber(bucket, row, "productImpression");
    addNumber(bucket, row, "productClick");
    addNumber(bucket, row, "atc");
    bucket.ctrNumeratorClick += Number(row.click || 0);
    bucket.ctrDenominatorImpression += Number(row.impression || 0);
  }

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    expense: bucket.cost / 100000,
    ctr: bucket.ctrDenominatorImpression ? bucket.ctrNumeratorClick / bucket.ctrDenominatorImpression : 0,
  }));
}

function addNumber(bucket, row, key) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) bucket[key] += value;
}

function localDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pageDateKey(pageUrl, timezone) {
  try {
    const parsed = new URL(pageUrl);
    const from = Number(parsed.searchParams.get('from'));
    if (Number.isFinite(from)) return localDateKey(new Date(from * 1000), timezone);
  } catch {}
  return '';
}

function localHour(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value || 0);
}

function toCsv(rows) {
  const headers = [
    "country",
    "profile_id",
    "profile_name",
    "date",
    "timezone",
    "hour",
    "hour_text",
    "points",
    "expense",
    "cost_raw",
    "impression",
    "click",
    "ctr",
    "broad_order",
    "direct_order",
    "checkout",
    "broad_gmv",
    "direct_gmv",
    "product_impression",
    "product_click",
    "atc",
    "source_url",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

async function inspectProfile(chromium, opened, profile, options) {
  let browser;
  try {
    browser = await connectToProfile(chromium, opened, options.timeoutMs);
    const pages = flattenPages(browser);
    const adsPages = pages.filter((page) => isAdsPerformancePage(page.url()));
    const results = [];

    for (const page of adsPages) {
      const country = countryFromUrl(page.url());
      const extracted = await captureAdsTimeGraphData(page, options, country) || await extractAdsSourceData(page);
      const timezone = extracted.timezone || country.timezone;
      const dateKey = pageDateKey(page.url(), timezone) || options.date;
      const hourly = aggregateHourly(extracted.data || [], dateKey, timezone);
      results.push({
        country,
        profile,
        pageUrl: page.url(),
        title: extracted.title,
        timezone,
        source: extracted.source,
        rawPoints: extracted.data?.length || 0,
        metrics: extracted.metrics || [],
        hourly,
      });
    }

    return { opened, profile, connected: true, adsPageCount: adsPages.length, results };
  } catch (error) {
    return { opened, profile, connected: false, error: error.message, results: [] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function flattenExportRows(profileResults) {
  const rows = [];
  for (const profileResult of profileResults) {
    for (const result of profileResult.results) {
      for (const hour of result.hourly) {
        rows.push({
          country: result.country.code,
          profile_id: profileResult.opened.user_id,
          profile_name: result.profile?.name || "",
          date: hour.date,
          timezone: result.timezone,
          hour: hour.hour,
          hour_text: hour.hourText,
          points: hour.points,
          expense: round(hour.expense, 6),
          cost_raw: hour.cost,
          impression: hour.impression,
          click: hour.click,
          ctr: round(hour.ctr, 6),
          broad_order: hour.broadOrder,
          direct_order: hour.directOrder,
          checkout: hour.checkout,
          broad_gmv: hour.broadGmv,
          direct_gmv: hour.directGmv,
          product_impression: hour.productImpression,
          product_click: hour.productClick,
          atc: hour.atc,
          source_url: result.pageUrl,
        });
      }
    }
  }
  return rows;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function report(profileResults, exportPath, dateKey) {
  const lines = [];
  lines.push(`Date: ${dateKey}`);
  lines.push(`Export: ${exportPath}`);

  const byCountry = new Map();
  for (const profileResult of profileResults) {
    for (const result of profileResult.results) {
      byCountry.set(result.country.code, result);
    }
  }

  for (const country of Object.values(COUNTRY_BY_HOST)) {
    const result = byCountry.get(country.code);
    if (!result) {
      lines.push(`${country.zh}/${country.code}: no opened Ads page found`);
      continue;
    }
    const nonZeroHours = result.hourly.filter((row) => row.points > 0);
    const totalExpense = result.hourly.reduce((sum, row) => sum + row.expense, 0);
    const totalClick = result.hourly.reduce((sum, row) => sum + row.click, 0);
    const totalImpression = result.hourly.reduce((sum, row) => sum + row.impression, 0);
    const totalOrder = result.hourly.reduce((sum, row) => sum + row.broadOrder + row.directOrder, 0);
    lines.push(`${country.zh}/${country.code}: ${nonZeroHours.length} hours, sourceData=${result.rawPoints}, expense=${round(totalExpense, 2)}, click=${totalClick}, impression=${totalImpression}, orders=${totalOrder}`);
    lines.push(`  ${result.pageUrl}`);
  }

  const failures = profileResults.filter((result) => !result.connected);
  if (failures.length) {
    lines.push("Connection errors:");
    for (const failure of failures) {
      lines.push(`- ${failure.opened.user_id}: ${failure.error}`);
    }
  }

  return lines.join("\n");
}

async function runExportOnce(options) {
  const { chromium } = loadPlaywright();
  const opened = await getOpenedBrowsers(options.adsBase);
  const profileMap = await getProfileMap(options.adsBase, opened.map((item) => item.user_id));

  const profileResults = [];
  for (const browserInfo of opened) {
    profileResults.push(await inspectProfile(chromium, browserInfo, profileMap.get(browserInfo.user_id), options));
  }

  const rows = flattenExportRows(profileResults);
  fs.mkdirSync(options.outDir, { recursive: true });
  const exportPath = path.join(options.outDir, `shopee_ads_hourly_${options.date}.csv`);
  fs.writeFileSync(exportPath, toCsv(rows), "utf8");

  const summary = {
    date: options.date,
    exportPath,
    rows: rows.length,
    countriesFound: [...new Set(rows.map((row) => row.country))],
    profileResults,
  };

  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(report(profileResults, exportPath, options.date));

  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.watch) {
    for (;;) {
      await runExportOnce(options).catch((error) => {
        console.error(error.stack || error.message);
      });
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs || 60000));
    }
  }

  const summary = await runExportOnce(options);
  const countriesFound = new Set(summary.profileResults.flatMap((result) => result.country ? [result.country] : []));
  if (countriesFound.size < 3) process.exitCode = 3;
}main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
