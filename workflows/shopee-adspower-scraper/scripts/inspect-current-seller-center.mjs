#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    adsBase: "http://local.adspower.net:50325",
    profileId: "",
    timeoutMs: 30000,
    json: false,
    maxRows: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--ads-base") {
      options.adsBase = argv[++i];
    } else if (arg === "--profile-id") {
      options.profileId = argv[++i];
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === "--max-rows") {
      options.maxRows = Number(argv[++i]);
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/inspect-current-seller-center.mjs [options]

Options:
  --profile-id <id>       Only inspect one opened AdsPower profile.
  --ads-base <url>        AdsPower Local API base URL. Default: http://local.adspower.net:50325
  --timeout-ms <number>   Per-browser CDP timeout. Default: 30000
  --max-rows <number>     Max visible table rows to include. Default: 20
  --json                  Print raw JSON instead of a concise report.
  -h, --help              Show this help.

This script only connects to already-open AdsPower browsers. It does not open Chrome,
navigate pages, click elements, fill forms, inject scripts, or modify page content.
`);
}

function loadPlaywright() {
  for (const packageName of ["playwright", "playwright-core"]) {
    try {
      const mod = require(packageName);
      if (mod.chromium) return mod;
    } catch {
      // Try the next package name.
    }
  }

  const cachedPlaywright = findCachedPlaywrightCore();
  if (cachedPlaywright) {
    const mod = require(cachedPlaywright);
    if (mod.chromium) return mod;
  }

  throw new Error(
    "Playwright is not available. Run `npm install` in this project, or set NODE_PATH to a node_modules folder that contains playwright-core."
  );
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
    const stat = fs.statSync(packageJson);
    candidates.push({
      packagePath: path.join(npxRoot, dirent.name, "node_modules", "playwright-core"),
      mtimeMs: stat.mtimeMs,
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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

async function getOpenedBrowsers(adsBase) {
  const result = await requestJson(`${adsBase.replace(/\/$/, "")}/api/v1/browser/local-active`);
  if (result.code !== 0) {
    throw new Error(`AdsPower returned error: ${result.msg || result.code}`);
  }
  return result.data?.list || [];
}

function isSellerCenterUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase().startsWith("seller.shopee.") ||
      parsed.hostname.toLowerCase().includes("seller.shopee.")
    );
  } catch {
    return false;
  }
}

function safePrimitiveRecord(value, maxKeys = 30) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).slice(0, maxKeys)) {
    const item = value[key];
    if (item == null || ["string", "number", "boolean"].includes(typeof item)) {
      out[key] = item;
    }
  }
  return out;
}

function isInternalDatasetSource(source) {
  if (/sourceData/i.test(source)) return false;
  return /(\.effects|scope\.|_chartsViews|_graphicEls|__ec_inner|_children|_store\._chunks|_schema|animators|propsOptions|chartMetrics|_instance\.scope|sidebarConfig)/i.test(source);
}

async function connectToProfile(chromium, opened, timeoutMs) {
  const endpoint = opened.ws?.puppeteer || `http://127.0.0.1:${opened.debug_port}`;
  const browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
  return browser;
}

function flattenPages(browser) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter(Boolean);
}

async function analyzeSellerPage(page, maxRows) {
  return page.evaluate((maxVisibleRows) => {
    const now = new Date().toISOString();

    function visibleText(el) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return "";
      return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    }

    function pickPrimitives(obj, maxKeys = 30) {
      if (!obj || typeof obj !== "object") return obj;
      const out = {};
      for (const key of Object.keys(obj).slice(0, maxKeys)) {
        const value = obj[key];
        if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
          out[key] = value;
        }
      }
      return out;
    }

    function looksLikeMetricArray(arr) {
      if (!Array.isArray(arr) || !arr.length || arr.length > 20000) return false;
      const firstObject = arr.find((item) => item && typeof item === "object" && !Array.isArray(item));
      if (!firstObject) return false;
      const keys = Object.keys(firstObject);
      const internalKeys = ["fn", "trigger", "scheduler", "deps", "animators", "__dirty", "__zr", "shape", "style", "coordDim"];
      if (internalKeys.some((key) => keys.includes(key))) return false;
      const hasTime = keys.some((key) => /time|date|timestamp|hour|day/i.test(key));
      const numericCount = keys.filter((key) => typeof firstObject[key] === "number").length;
      const businessKeys = keys.filter((key) => /cost|expense|sales|gmv|order|click|impression|ctr|cr|roi|roas|budget|stock|price|voucher|item|product|campaign|flash|sale|buyer|visitor|conversion|units|amount|status|name/i.test(key));
      return hasTime || businessKeys.length >= 2 || numericCount >= 3;
    }

    function summarizeArray(arr, source) {
      const firstObject = arr.find((item) => item && typeof item === "object" && !Array.isArray(item));
      const fields = firstObject ? Object.keys(firstObject).slice(0, 40) : [];
      const numericFields = fields.filter((field) => arr.some((row) => typeof row?.[field] === "number"));
      const timeFields = fields.filter((field) => /time|date|timestamp|hour|day/i.test(field));

      return {
        source,
        length: arr.length,
        fields,
        timeFields,
        numericFields,
        hourly: buildHourlySummary(arr, fields, source),
        sample: arr.slice(0, 5).map((row) => pickPrimitives(row)),
      };
    }

    function buildHourlySummary(arr, fields, source) {
      if (!/sourceData/i.test(source)) return [];
      const timestampField = fields.find((field) => /^timestamp$/i.test(field));
      if (!timestampField) return [];

      const priority = [
        "cost",
        "click",
        "impression",
        "broadOrder",
        "directOrder",
        "checkout",
        "broadGmv",
        "directGmv",
        "productClick",
        "productImpression",
        "atc",
        "voucherSales",
      ];
      const metricFields = priority.filter((field) => fields.includes(field));
      if (!metricFields.length) return [];

      const hourly = new Map();
      for (const row of arr) {
        const rawTimestamp = row?.[timestampField];
        if (typeof rawTimestamp !== "number") continue;
        const ms = rawTimestamp > 100000000000 ? rawTimestamp : rawTimestamp * 1000;
        const date = new Date(ms);
        const hour = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(date).replace(":00", ":00");
        const bucket = hourly.get(hour) || {};
        for (const field of metricFields.slice(0, 12)) {
          if (typeof row[field] === "number") bucket[field] = (bucket[field] || 0) + row[field];
        }
        if (typeof bucket.cost === "number") bucket.costDisplay = bucket.cost / 100000;
        hourly.set(hour, bucket);
      }

      return Array.from(hourly.entries()).slice(0, 24).map(([hour, values]) => ({ hour, ...values }));
    }

    function findVueDatasets() {
      const roots = [
        ".metric-for-chart",
        ".line-chart-container",
        "#metric-line-chart",
        "[class*=chart]",
        "canvas",
        "#app",
        "body",
      ]
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)).slice(0, 20))
        .filter(Boolean);

      const datasets = [];
      const seenObjects = new WeakSet();
      const seenArrays = new WeakSet();
      let inspected = 0;
      const maxObjects = 12000;

      function addDataset(arr, source) {
        if (isInternalDatasetSourceInPage(source)) return;
        if (!looksLikeMetricArray(arr) || seenArrays.has(arr)) return;
        seenArrays.add(arr);
        datasets.push(summarizeArray(arr, source));
      }

      function isInternalDatasetSourceInPage(source) {
        if (/sourceData/i.test(source)) return false;
        return /(\.effects|scope\.|_chartsViews|_graphicEls|__ec_inner|_children|_store\._chunks|_schema|animators|propsOptions|chartMetrics|_instance\.scope|sidebarConfig)/i.test(source);
      }

      function walk(obj, depth, source) {
        if (!obj || typeof obj !== "object" || seenObjects.has(obj) || depth > 8 || inspected > maxObjects) return;
        seenObjects.add(obj);
        inspected += 1;

        try {
          if (Array.isArray(obj.sourceData)) addDataset(obj.sourceData, `${source}.sourceData`);
          if (obj.props && Array.isArray(obj.props.sourceData)) addDataset(obj.props.sourceData, `${source}.props.sourceData`);
          if (obj.data && Array.isArray(obj.data)) addDataset(obj.data, `${source}.data`);
          if (obj.series && Array.isArray(obj.series)) addDataset(obj.series, `${source}.series`);
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
          if (/parent|root|appContext|vnode|subTree|components|provides|proxy|ctx/i.test(key)) continue;
          let value;
          try {
            value = obj[key];
          } catch {
            continue;
          }
          if (Array.isArray(value)) addDataset(value, `${source}.${key}`);
          if (value && typeof value === "object") walk(value, depth + 1, `${source}.${key}`);
        }
      }

      roots.forEach((el, index) => {
        const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${String(el.className).split(/\s+/).slice(0, 2).join(".")}` : ""}[${index}]`;
        for (const candidate of [el.__vueParentComponent, el.__vue_app__, el._vnode]) {
          walk(candidate, 0, label);
        }
      });

      return datasets
        .sort((a, b) => {
          const aSourceData = /sourceData/i.test(a.source) ? 1 : 0;
          const bSourceData = /sourceData/i.test(b.source) ? 1 : 0;
          return bSourceData - aSourceData || b.length - a.length;
        })
        .slice(0, 20);
    }

    function findEcharts() {
      const datasets = [];
      const echarts = window.echarts;
      if (!echarts || typeof echarts.getInstanceByDom !== "function") return datasets;

      for (const el of Array.from(document.querySelectorAll("div, canvas")).slice(0, 2000)) {
        let instance;
        try {
          instance = echarts.getInstanceByDom(el);
        } catch {
          instance = null;
        }
        if (!instance || typeof instance.getOption !== "function") continue;

        try {
          const option = instance.getOption();
          datasets.push({
            source: "echarts.getOption",
            title: option.title?.[0]?.text || "",
            legend: option.legend?.[0]?.data || [],
            xAxis: option.xAxis?.[0]?.data?.slice?.(0, 20) || [],
            series: (option.series || []).slice(0, 10).map((series) => ({
              name: series.name || "",
              type: series.type || "",
              length: Array.isArray(series.data) ? series.data.length : 0,
              sample: Array.isArray(series.data) ? series.data.slice(0, 5).map((row) => pickPrimitives(row)) : [],
            })),
          });
        } catch {
          // Ignore unreadable chart instances.
        }
      }

      return datasets;
    }

    function readTables() {
      return Array.from(document.querySelectorAll("table")).slice(0, 10).map((table, tableIndex) => {
        const rows = Array.from(table.querySelectorAll("tr")).slice(0, maxVisibleRows);
        return {
          index: tableIndex,
          rowCount: table.querySelectorAll("tr").length,
          headers: Array.from(table.querySelectorAll("th")).slice(0, 30).map(visibleText).filter(Boolean),
          rows: rows.map((row) => Array.from(row.querySelectorAll("th,td")).slice(0, 30).map(visibleText)),
        };
      }).filter((table) => table.rows.length);
    }

    function readSummaryCards() {
      const candidates = Array.from(document.querySelectorAll("[class*=card], [class*=summary], [class*=metric], [class*=stat]")).slice(0, 120);
      return candidates
        .map((el) => visibleText(el))
        .filter((text) => text && /\d/.test(text) && text.length <= 200)
        .slice(0, 30);
    }

    return {
      inspectedAt: now,
      url: location.href,
      title: document.title,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: document.documentElement.lang || navigator.language,
      vueDatasets: findVueDatasets(),
      echarts: findEcharts(),
      tables: readTables(),
      summaryCards: readSummaryCards(),
    };
  }, maxRows);
}

async function inspectOpenedBrowser(chromium, opened, options) {
  let browser;
  try {
    browser = await connectToProfile(chromium, opened, options.timeoutMs);
    const pages = flattenPages(browser);
    const pageSummaries = [];
    for (const page of pages) {
      pageSummaries.push({
        url: page.url(),
        title: await page.title().catch(() => ""),
        isSellerCenter: isSellerCenterUrl(page.url()),
      });
    }

    const sellerPages = pages.filter((page) => isSellerCenterUrl(page.url()));
    const analyses = [];
    const analysisErrors = [];
    for (const page of sellerPages) {
      try {
        analyses.push(await analyzeSellerPage(page, options.maxRows));
      } catch (error) {
        analysisErrors.push({
          url: page.url(),
          error: error.message,
        });
      }
    }

    return {
      profileId: opened.user_id,
      debugPort: opened.debug_port,
      connected: true,
      pageCount: pages.length,
      pages: pageSummaries,
      sellerCenterFound: analyses.length > 0 || sellerPages.length > 0,
      analyses,
      analysisErrors,
    };
  } catch (error) {
    return {
      profileId: opened.user_id,
      debugPort: opened.debug_port,
      connected: false,
      error: error.message,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function formatReport(results) {
  const lines = [];
  const connected = results.filter((result) => result.connected);
  const sellerResults = results.filter((result) => result.sellerCenterFound);

  lines.push(`AdsPower opened browsers: ${results.length}`);
  lines.push(`Connected with Playwright: ${connected.length}`);

  if (!sellerResults.length) {
    lines.push("");
    lines.push("No Shopee Seller Center page is currently open in the connected AdsPower browsers.");
    lines.push("Please open Seller Center in one of the existing AdsPower browser windows, then run this command again.");
    lines.push("");
    lines.push("Open tabs found:");
    for (const result of connected) {
      lines.push(`- ${result.profileId} / debug ${result.debugPort}`);
      for (const page of result.pages || []) {
        lines.push(`  - ${page.title || "(no title)"} :: ${page.url}`);
      }
    }
    return lines.join("\n");
  }

  for (const result of sellerResults) {
    lines.push("");
    lines.push(`Profile: ${result.profileId} / debug ${result.debugPort}`);
    for (const analysis of result.analyses) {
      lines.push(`Seller Center: ${analysis.title || "(no title)"}`);
      lines.push(`URL: ${analysis.url}`);
      lines.push(`Timezone: ${analysis.timezone}`);
      lines.push(`Vue/chart datasets: ${analysis.vueDatasets.length}`);
      for (const dataset of analysis.vueDatasets.slice(0, 8)) {
        lines.push(
          `- ${dataset.source}: ${dataset.length} rows; fields=${dataset.fields.join(", ")}`
        );
        if (dataset.hourly?.length) {
          const firstHour = dataset.hourly[0];
          const priority = ["costDisplay", "cost", "click", "impression", "broadOrder", "directOrder", "checkout", "broadGmv"];
          const keys = priority.filter((key) => Object.hasOwn(firstHour, key)).slice(0, 5);
          lines.push(`  hourly sample ${firstHour.hour}: ${keys.map((key) => `${key}=${firstHour[key]}`).join(", ")}`);
        }
      }
      lines.push(`ECharts instances: ${analysis.echarts.length}`);
      lines.push(`Tables: ${analysis.tables.length}`);
      for (const table of analysis.tables.slice(0, 3)) {
        const header = table.headers.length ? table.headers.join(" | ") : "(no header)";
        lines.push(`- table ${table.index}: ${table.rowCount} rows; ${header}`);
      }
      if (analysis.summaryCards.length) {
        lines.push(`Summary cards: ${analysis.summaryCards.length}`);
        for (const card of analysis.summaryCards.slice(0, 5)) {
          lines.push(`- ${card}`);
        }
      }
    }
    for (const error of result.analysisErrors || []) {
      lines.push(`Analysis skipped for tab: ${error.url}`);
      lines.push(`- ${error.error}`);
    }
  }

  const failed = results.filter((result) => !result.connected || result.error);
  if (failed.length) {
    lines.push("");
    lines.push("Connection errors:");
    for (const result of failed) {
      lines.push(`- ${result.profileId} / debug ${result.debugPort}: ${result.error}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const { chromium } = loadPlaywright();
  const opened = await getOpenedBrowsers(options.adsBase);
  const filtered = options.profileId ? opened.filter((item) => item.user_id === options.profileId) : opened;

  if (!filtered.length) {
    const message = options.profileId
      ? `No opened AdsPower browser matched profile_id=${options.profileId}.`
      : "No opened AdsPower browsers were returned by AdsPower Local API.";
    if (options.json) {
      console.log(JSON.stringify({ ok: false, reason: message, openedCount: opened.length }, null, 2));
    } else {
      console.log(message);
    }
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const browserInfo of filtered) {
    results.push(await inspectOpenedBrowser(chromium, browserInfo, options));
  }

  const hasSellerCenter = results.some((result) => result.sellerCenterFound);
  if (options.json) {
    console.log(JSON.stringify({ ok: hasSellerCenter, results }, null, 2));
  } else {
    console.log(formatReport(results));
  }

  if (!hasSellerCenter) process.exitCode = 3;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
