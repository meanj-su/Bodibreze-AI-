#!/usr/bin/env node
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function usage() {
  console.error("Usage: node extract_shopee_chart_data.mjs --url <seller-url> --date YYYY-MM-DD [--metric cost] [--cdp http://127.0.0.1:9222] [--scale 100000] [--raw] [--keep-zero]");
}

function localDateParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp * 1000));
  const get = type => parts.find(p => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

function formatRp(value) {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

async function findChartData(page) {
  return await page.evaluate(() => {
    function findChartDataInner() {
      const roots = [".metric-for-chart", ".line-chart-container", "#metric-line-chart", "#app"]
        .map(sel => document.querySelector(sel))
        .filter(Boolean);
      const seen = new Set();
      function walk(obj, depth) {
        if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 7) return null;
        seen.add(obj);
        try {
          if (Array.isArray(obj.sourceData) && obj.sourceData.length && obj.sourceData[0]?.timestamp != null) return obj.sourceData;
          if (obj.props && Array.isArray(obj.props.sourceData) && obj.props.sourceData.length && obj.props.sourceData[0]?.timestamp != null) return obj.props.sourceData;
        } catch {}
        let keys = [];
        try {
          keys = Object.keys(obj).slice(0, 100);
        } catch {
          return null;
        }
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
    return findChartDataInner().map(d => ({ ...d }));
  });
}

const args = parseArgs(process.argv);
if (!args.url || !args.date) {
  usage();
  process.exit(2);
}

const cdp = args.cdp || "http://127.0.0.1:9222";
const metric = args.metric || "cost";
const scale = Number(args.scale || 100000);
const timeZone = args.timezone || "Asia/Jakarta";

const browser = await chromium.connectOverCDP(cdp);
const context = browser.contexts()[0];
const page = context.pages().find(p => p.url().includes("seller.shopee.co.id")) || context.pages()[0] || await context.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(Number(args.wait || 8000));
await page.evaluate(() => window.scrollTo(0, 520)).catch(() => {});
await page.waitForTimeout(1000);

const sourceData = await findChartData(page);
if (!sourceData.length) {
  console.error("No Shopee chart sourceData found. Confirm the page is logged in and the chart is visible.");
  process.exit(1);
}

const hourly = new Map();
for (const row of sourceData) {
  const timestamp = Number(row.timestamp ?? row.key);
  const value = Number(row[metric] ?? row.metrics?.[metric] ?? 0);
  if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
  const parts = localDateParts(timestamp, timeZone);
  if (parts.date !== args.date) continue;
  hourly.set(parts.hour, (hourly.get(parts.hour) || 0) + value);
}

const rows = [];
for (let hour = 0; hour < 24; hour++) {
  const raw = hourly.get(hour) || 0;
  if (!raw && !args["keep-zero"]) continue;
  rows.push({
    hour,
    label: `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`,
    raw,
    value: raw / scale,
    formatted: formatRp(raw / scale),
  });
}

const total = rows.reduce((sum, row) => sum + row.raw, 0) / scale;
const output = {
  url: page.url(),
  date: args.date,
  timezone: timeZone,
  metric,
  scale,
  source: "Vue chart sourceData",
  rows,
  total,
  formattedTotal: formatRp(total),
};

if (args.raw) {
  output.sourceData = sourceData;
}

console.log(JSON.stringify(output, null, 2));
