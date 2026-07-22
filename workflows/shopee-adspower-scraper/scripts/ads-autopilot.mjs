#!/usr/bin/env node

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config", "ads-autopilot.config.json");
const AMOUNT_SCALE = 100000;

const DEFAULT_CONFIG = {
  adsBase: "http://local.adspower.net:50325",
  outDir: path.join(ROOT, "exports", "ads-autopilot"),
  historyDays: 7,
  networkWaitMs: 15000,
  timeoutMs: 30000,
  google: {
    enabled: true,
    spreadsheetId: "1bLwa2kh5K__Jo52SP5Ju7Bu80YQviM6MRB6Kzm8N1Y8",
    credentialPath: "",
    proxy: "http://127.0.0.1:7890",
    sheets: {
      hourly: "ShopeeAds_Hourly",
      daily: "ShopeeAds_Daily",
      recommendations: "ShopeeAds_Recommendations",
      runLog: "ShopeeAds_RunLog",
    },
  },
  thresholds: {
    scaleRoas: 24,
    maintainRoas: 18,
    pauseRoas: 8,
    cpcJumpPct: 30,
    minSpendForPause: { ID: 20000, MY: 20, TH: 100 },
  },
  countries: [
    { code: "ID", label: "Indonesia", profileId: "kyme0da", timezone: "Asia/Jakarta", currency: "IDR", host: "seller.shopee.co.id", targetPath: "/portal/marketing/pas/index" },
    { code: "MY", label: "Malaysia", profileId: "k14di2tc", timezone: "Asia/Kuala_Lumpur", currency: "MYR", host: "seller.shopee.com.my", targetPath: "/portal/marketing/pas/index" },
    { code: "TH", label: "Thailand", profileId: "k16ggegy", timezone: "Asia/Bangkok", currency: "THB", host: "seller.shopee.co.th", targetPath: "/portal/marketing/pas/index" },
  ],
};

const HOURLY = ["country", "profile_id", "profile_name", "date", "timezone", "hour", "hour_text", "points", "expense", "impression", "click", "ctr", "cpc", "broad_order", "direct_order", "checkout", "broad_gmv", "direct_gmv", "broad_roi", "direct_roi", "product_impression", "product_click", "atc", "source", "source_url", "collected_at", "missing_reason"];
const DAILY = ["country", "date", "timezone", "currency", "expense", "impression", "click", "ctr", "cpc", "broad_order", "direct_order", "checkout", "broad_gmv", "direct_gmv", "broad_roi", "direct_roi", "active_hours", "missing_hours", "collected_at"];
const RECS = ["country", "date", "hour", "hour_text", "action", "reason", "expense", "broad_gmv", "direct_gmv", "broad_roi", "direct_roi", "click", "impression", "ctr", "cpc", "broad_order", "direct_order", "previous_expense", "previous_broad_roi", "previous_cpc", "cpc_change_pct", "risk_note", "generated_at"];
const RUNLOG = ["run_id", "started_at", "finished_at", "mode", "dates", "countries", "hourly_rows", "daily_rows", "recommendation_rows", "google_status", "status", "message"];

function args(argv) {
  const o = { command: "collect", config: CONFIG_PATH, dryRunGoogle: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--") && !o._cmd) { o.command = a; o._cmd = true; }
    else if (a === "--config") o.config = argv[++i];
    else if (a === "--date") o.date = argv[++i];
    else if (a === "--days") o.days = Number(argv[++i]);
    else if (a === "--country") o.country = argv[++i];
    else if (a === "--legacy") o.legacy = argv[++i];
    else if (a === "--no-google") o.google = false;
    else if (a === "--google") o.google = true;
    else if (a === "--dry-run-google") o.dryRunGoogle = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function help() {
  console.log(`Usage:
  node scripts/ads-autopilot.mjs collect [--days 7] [--date YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD] [--no-google]
  node scripts/ads-autopilot.mjs analyze [--legacy exports/shopee_ads_hourly_YYYY-MM-DD.csv] [--no-google]
  node scripts/ads-autopilot.mjs google [--dry-run-google]`);
}

function config(file) {
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...p,
    google: { ...DEFAULT_CONFIG.google, ...(p.google || {}), sheets: { ...DEFAULT_CONFIG.google.sheets, ...(p.google?.sheets || {}) } },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(p.thresholds || {}) },
    countries: p.countries?.length ? p.countries : DEFAULT_CONFIG.countries,
  };
}

async function collect(cfg, opt) {
  const run = runInfo("collect", opt);
  const store = loadStore(cfg);
  if (opt.legacy) importLegacy(store, opt.legacy, cfg);
  const countries = pickCountries(cfg, opt.country);
  const datesByCountry = new Map(countries.map((country) => [country.code, planDates(cfg, opt, store.hourly, [country])]));
  const { chromium } = loadPlaywright();
  const opened = await openedBrowsers(cfg.adsBase);
  const profiles = await profileMap(cfg.adsBase, opened.map((x) => x.user_id));
  const byProfile = new Map(opened.map((x) => [String(x.user_id), x]));
  const errors = [];
  const done = [];
  for (const country of countries) {
    const openedProfile = byProfile.get(String(country.profileId));
    if (!openedProfile) {
      errors.push({ country: country.code, message: `No opened AdsPower profile ${country.profileId}` });
      continue;
    }
    for (const date of datesByCountry.get(country.code) || []) {
      try {
        const rows = await collectOne({ chromium, openedProfile, profile: profiles.get(openedProfile.user_id), country, date, cfg });
        mergeRows(store.hourly, rows);
        done.push({ country: country.code, date, rows: rows.length, source: rows.find((r) => r.points > 0)?.source || "none" });
      } catch (e) {
        errors.push({ country: country.code, date, message: e.message });
      }
    }
  }
  await finish(cfg, opt, run, store, errors);
  printSummary(run, done, errors);
}

async function analyze(cfg, opt) {
  const run = runInfo("analyze", opt);
  const store = loadStore(cfg);
  if (opt.legacy) importLegacy(store, opt.legacy, cfg);
  await finish(cfg, opt, run, store, []);
  printSummary(run, [], []);
}

async function googleOnly(cfg, opt) {
  const store = loadStore(cfg);
  store.daily = makeDaily(store.hourly, cfg);
  store.recommendations = makeRecs(store.hourly, cfg);
  const status = await syncGoogle(cfg, store, { dryRun: opt.dryRunGoogle });
  console.log(`Google: ${status.status} ${status.message || ""}`);
}

function runInfo(mode, opt) {
  return { id: `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`, mode, opt, start: new Date().toISOString(), end: "" };
}

async function finish(cfg, opt, run, store, errors) {
  store.hourly = normalizeHourly(store.hourly);
  store.daily = makeDaily(store.hourly, cfg);
  store.recommendations = makeRecs(store.hourly, cfg);
  writeStore(cfg, store, errors);
  const google = await maybeGoogle(cfg, opt, store);
  run.end = new Date().toISOString();
  appendCsv(files(cfg).runLog, RUNLOG, {
    run_id: run.id,
    started_at: run.start,
    finished_at: run.end,
    mode: run.mode,
    dates: opt.date || `recent:${opt.days || cfg.historyDays || 7}`,
    countries: opt.country || "ALL",
    hourly_rows: store.hourly.length,
    daily_rows: store.daily.length,
    recommendation_rows: store.recommendations.length,
    google_status: google.status,
    status: errors.length ? "partial" : "ok",
    message: errors.map((e) => `${e.country || ""} ${e.date || ""} ${e.message}`).join(" | ") || google.message || "",
  });
}

function pickCountries(cfg, value) {
  const set = value ? new Set(String(value).split(",").map((x) => x.trim().toUpperCase())) : null;
  return cfg.countries.filter((c) => !set || set.has(c.code));
}

function planDates(cfg, opt, hourly, countries) {
  if (opt.date) return expandDates(opt.date);
  const out = new Set();
  for (const country of countries) {
    const today = localDate(new Date(), country.timezone || "Asia/Bangkok");
    const yesterday = addDays(today, -1);
    for (let i = 0; i < Number(opt.days || cfg.historyDays || 7); i += 1) {
      const date = addDays(today, -i);
      if (date === today || date === yesterday || !completeDay(hourly, country.code, date)) out.add(date);
    }
  }
  return [...out].sort();
}

function expandDates(text) {
  if (text.includes("..")) {
    const [start, end] = text.split("..").map((x) => x.trim());
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }
  return text.split(",").map((x) => x.trim()).filter(Boolean).sort();
}

function completeDay(rows, country, date) {
  return rows.filter((r) => r.country === country && r.date === date && Number(r.points || 0) > 0).length >= 24;
}

async function collectOne({ chromium, openedProfile, profile, country, date, cfg }) {
  let browser;
  try {
    browser = await chromium.connectOverCDP(openedProfile.ws?.puppeteer || `http://127.0.0.1:${openedProfile.debug_port}`, { timeout: cfg.timeoutMs });
    const page = await getPage(browser, country);
    const target = pasUrl(country, date);
    const extracted = await captureApi(page, target, cfg) || await sourceData(page);
    const rows = aggregate(extracted.data || [], date, country.timezone);
    const at = new Date().toISOString();
    return rows.map((h) => ({
      country: country.code,
      profile_id: country.profileId,
      profile_name: profile?.name || "",
      date: h.date,
      timezone: country.timezone,
      hour: String(h.hour),
      hour_text: h.hourText,
      points: h.points,
      expense: round(h.expense, 6),
      impression: h.impression,
      click: h.click,
      ctr: round(safeDiv(h.click, h.impression), 6),
      cpc: round(safeDiv(h.expense, h.click), 6),
      broad_order: h.broadOrder,
      direct_order: h.directOrder,
      checkout: h.checkout,
      broad_gmv: round(h.broadGmv, 6),
      direct_gmv: round(h.directGmv, 6),
      broad_roi: round(safeDiv(h.broadGmv, h.expense), 6),
      direct_roi: round(safeDiv(h.directGmv, h.expense), 6),
      product_impression: h.productImpression,
      product_click: h.productClick,
      atc: h.atc,
      source: extracted.source,
      source_url: extracted.sourceUrl || page.url(),
      collected_at: at,
      missing_reason: h.points ? "" : "no_points",
    }));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function getPage(browser, country) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const existing = pages.find((p) => {
    try {
      const u = new URL(p.url());
      return u.hostname === country.host && u.pathname.includes(country.targetPath);
    } catch { return false; }
  });
  if (existing) return existing;
  const context = browser.contexts()[0] || await browser.newContext();
  return context.newPage();
}

function pasUrl(country, date) {
  const from = Math.floor(zonedMs(date, 0, country.timezone) / 1000);
  const to = Math.floor(zonedMs(addDays(date, 1), 0, country.timezone) / 1000) - 1;
  return `https://${country.host}${country.targetPath}?from=${from}&to=${to}&type=new_cpc_homepage&group=custom`;
}

async function captureApi(page, target, cfg) {
  const captures = [];
  const promises = [];
  const onResponse = (res) => {
    if (!String(res.url()).includes("report/get_time_graph")) return;
    const p = res.text().then((body) => {
      const json = tryJson(body);
      const rows = arraysByKey(json, "report_by_time").flat();
      if (rows.length) captures.push({ url: res.url(), rows });
    }).catch(() => {});
    promises.push(p);
  };
  page.on("response", onResponse);
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: cfg.timeoutMs }).catch(() => {});
    await page.waitForTimeout(cfg.networkWaitMs || 15000);
    await Promise.allSettled(promises);
  } finally {
    page.off("response", onResponse);
  }
  captures.sort((a, b) => b.rows.length - a.rows.length);
  const best = captures[0];
  if (!best) return null;
  return { source: "pas-api", sourceUrl: best.url, data: best.rows.map(apiRow).filter(Boolean) };
}

function apiRow(row) {
  const m = row?.metrics || row;
  const timestamp = Number(row?.key ?? row?.timestamp ?? m?.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  return {
    timestamp,
    cost: num(m.cost ?? m.spend ?? m.expense),
    impression: num(m.impression ?? m.impressions),
    click: num(m.click ?? m.clicks),
    broadOrder: num(m.broad_order ?? m.broadOrder),
    directOrder: num(m.direct_order ?? m.directOrder ?? m.order ?? m.orders),
    checkout: num(m.checkout),
    broadGmv: num(m.broad_gmv ?? m.broadGmv),
    directGmv: num(m.direct_gmv ?? m.directGmv ?? m.gmv),
    productImpression: num(m.product_impression ?? m.productImpression),
    productClick: num(m.product_click ?? m.productClick),
    atc: num(m.atc),
  };
}

async function sourceData(page) {
  return page.evaluate(() => {
    const roots = ["#app", ".line-chart-container", ".metric-for-chart", "#metric-line-chart", "body"].flatMap((s) => Array.from(document.querySelectorAll(s)).slice(0, 20));
    const seen = new WeakSet();
    const found = [];
    function ok(a) { return Array.isArray(a) && a.some((r) => r && typeof r.timestamp === "number" && Object.prototype.hasOwnProperty.call(r, "cost")); }
    function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 8 || seen.has(o)) return;
      seen.add(o);
      try {
        if (ok(o.sourceData)) found.push(o.sourceData);
        if (o.props && ok(o.props.sourceData)) found.push(o.props.sourceData);
      } catch {}
      let keys = [];
      try { keys = Object.keys(o).slice(0, 120); } catch { return; }
      for (const k of keys) {
        if (/parent|root|appContext|vnode|subTree|components|provides|proxy|ctx|_children|effects|__ec_inner|_chartsViews/i.test(k)) continue;
        try { if (o[k] && typeof o[k] === "object") walk(o[k], depth + 1); } catch {}
      }
    }
    for (const el of roots) for (const c of [el.__vueParentComponent, el.__vue_app__, el._vnode]) walk(c, 0);
    found.sort((a, b) => b.length - a.length);
    return { source: "sourceData", sourceUrl: location.href, data: found[0] || [] };
  });
}

function aggregate(rows, date, timezone) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    date, hour, hourText: `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`,
    points: 0, expense: 0, impression: 0, click: 0, broadOrder: 0, directOrder: 0, checkout: 0,
    broadGmv: 0, directGmv: 0, productImpression: 0, productClick: 0, atc: 0,
  }));
  for (const r of rows || []) {
    if (!Number.isFinite(Number(r.timestamp))) continue;
    const d = new Date(Number(r.timestamp) * 1000);
    if (localDate(d, timezone) !== date) continue;
    const h = localHour(d, timezone);
    const b = buckets[h];
    b.points += 1;
    b.expense += money(r.cost ?? r.expense);
    b.impression += num(r.impression);
    b.click += num(r.click);
    b.broadOrder += num(r.broadOrder);
    b.directOrder += num(r.directOrder);
    b.checkout += num(r.checkout);
    b.broadGmv += money(r.broadGmv ?? r.broad_gmv);
    b.directGmv += money(r.directGmv ?? r.direct_gmv);
    b.productImpression += num(r.productImpression);
    b.productClick += num(r.productClick);
    b.atc += num(r.atc);
  }
  return buckets;
}

function makeDaily(rows, cfg) {
  const by = new Map();
  for (const r of normalizeHourly(rows)) {
    const key = `${r.country}|${r.date}`;
    const c = cfg.countries.find((x) => x.code === r.country) || {};
    if (!by.has(key)) by.set(key, { country: r.country, date: r.date, timezone: r.timezone, currency: c.currency || "", expense: 0, impression: 0, click: 0, broad_order: 0, direct_order: 0, checkout: 0, broad_gmv: 0, direct_gmv: 0, active_hours: 0, missing_hours: 0, collected_at: "" });
    const d = by.get(key);
    d.expense += num(r.expense); d.impression += num(r.impression); d.click += num(r.click);
    d.broad_order += num(r.broad_order); d.direct_order += num(r.direct_order); d.checkout += num(r.checkout);
    d.broad_gmv += num(r.broad_gmv); d.direct_gmv += num(r.direct_gmv);
    if (num(r.points) > 0) d.active_hours += 1; else d.missing_hours += 1;
    if (String(r.collected_at) > d.collected_at) d.collected_at = r.collected_at;
  }
  return [...by.values()].map((d) => ({ ...d, expense: round(d.expense, 6), ctr: round(div(d.click, d.impression), 6), cpc: round(div(d.expense, d.click), 6), broad_gmv: round(d.broad_gmv, 6), direct_gmv: round(d.direct_gmv, 6), broad_roi: round(div(d.broad_gmv, d.expense), 6), direct_roi: round(div(d.direct_gmv, d.expense), 6) })).sort((a, b) => `${a.country}|${a.date}`.localeCompare(`${b.country}|${b.date}`));
}

function makeRecs(rows, cfg) {
  const h = normalizeHourly(rows);
  const map = new Map(h.map((r) => [`${r.country}|${r.date}|${r.hour}`, r]));
  const out = [];
  const generated = new Date().toISOString();
  for (const r of h) {
    if (num(r.points) <= 0) continue;
    const p = map.get(`${r.country}|${addDays(r.date, -1)}|${r.hour}`);
    const cpcChange = p && num(p.cpc) ? ((num(r.cpc) - num(p.cpc)) / num(p.cpc)) * 100 : 0;
    const d = decision(r, p, cpcChange, cfg);
    out.push({ country: r.country, date: r.date, hour: r.hour, hour_text: r.hour_text, action: d.action, reason: d.reason, expense: r.expense, broad_gmv: r.broad_gmv, direct_gmv: r.direct_gmv, broad_roi: r.broad_roi, direct_roi: r.direct_roi, click: r.click, impression: r.impression, ctr: r.ctr, cpc: r.cpc, broad_order: r.broad_order, direct_order: r.direct_order, previous_expense: p?.expense || 0, previous_broad_roi: p?.broad_roi || 0, previous_cpc: p?.cpc || 0, cpc_change_pct: round(cpcChange, 2), risk_note: d.risk, generated_at: generated });
  }
  return out.sort((a, b) => `${a.country}|${a.date}|${String(a.hour).padStart(2, "0")}`.localeCompare(`${b.country}|${b.date}|${String(b.hour).padStart(2, "0")}`));
}

function decision(r, p, cpcChange, cfg) {
  const t = cfg.thresholds;
  const roi = num(r.broad_roi), direct = num(r.direct_roi), spend = num(r.expense), orders = num(r.broad_order) + num(r.direct_order);
  const minSpend = num(t.minSpendForPause?.[r.country] ?? 20);
  const risk = direct > 0 && direct < t.pauseRoas ? "Direct ROI low; verify attribution quality before scaling." : "";
  if (spend >= minSpend && roi < t.pauseRoas) return { action: "\u6682\u505c/\u8bca\u65ad", reason: "Broad ROI below pause threshold with meaningful spend.", risk };
  if (p && cpcChange >= t.cpcJumpPct) return { action: "\u63a7\u8d39", reason: "CPC increased " + round(cpcChange, 1) + "% versus previous same hour.", risk };
  if (roi >= t.scaleRoas && num(r.click) > 0 && orders > 0) return { action: "\u653e\u91cf", reason: "Broad ROI, clicks, and orders are healthy.", risk };
  if (roi >= t.maintainRoas) return { action: "\u7ef4\u6301", reason: "Broad ROI is in maintain range.", risk };
  if (roi >= t.pauseRoas) return { action: "\u63a7\u8d39", reason: "Broad ROI is weak; keep budget controlled.", risk };
  return { action: "\u89c2\u5bdf", reason: "Spend or conversion volume is too low for a strong decision.", risk };
}

function loadStore(cfg) {
  fs.mkdirSync(files(cfg).out, { recursive: true }); fs.mkdirSync(files(cfg).state, { recursive: true });
  return { hourly: readCsv(files(cfg).hourly), daily: readCsv(files(cfg).daily), recommendations: readCsv(files(cfg).recs) };
}

function writeStore(cfg, store, errors) {
  store.hourly = normalizeHourly(store.hourly);
  store.daily = makeDaily(store.hourly, cfg);
  store.recommendations = makeRecs(store.hourly, cfg);
  writeCsv(files(cfg).hourly, HOURLY, store.hourly);
  writeCsv(files(cfg).daily, DAILY, store.daily);
  writeCsv(files(cfg).recs, RECS, store.recommendations);
  fs.writeFileSync(files(cfg).latestJson, JSON.stringify({ errors, daily: store.daily, recommendations: store.recommendations.slice(-200) }, null, 2), "utf8");
  fs.writeFileSync(files(cfg).latestMd, latestMd(store, errors), "utf8");
}

function latestMd(store, errors) {
  const lines = ["# Shopee Ads Autopilot Latest", "", `Updated: ${new Date().toISOString()}`, "", "## Daily"];
  for (const d of store.daily.slice(-30)) lines.push(`- ${d.country} ${d.date}: spend=${fmt(d.expense)}, broadROI=${fmt(d.broad_roi, 2)}, directROI=${fmt(d.direct_roi, 2)}, click=${d.click}, impression=${d.impression}, missing=${d.missing_hours}`);
  lines.push("", "## Recommendations");
  for (const r of store.recommendations.slice(-100).filter((x) => ["\u653e\u91cf", "\u63a7\u8d39", "\u6682\u505c/\u8bca\u65ad"].includes(x.action))) lines.push(`- ${r.country} ${r.date} ${r.hour_text}: ${r.action} - ${r.reason} broadROI=${fmt(r.broad_roi, 2)} directROI=${fmt(r.direct_roi, 2)}`);
  if (errors.length) { lines.push("", "## Errors"); for (const e of errors) lines.push(`- ${e.country || ""} ${e.date || ""}: ${e.message}`); }
  return lines.join("\n");
}

function files(cfg) {
  const out = path.resolve(cfg.outDir);
  return { out, state: path.join(out, "state"), hourly: path.join(out, "hourly.csv"), daily: path.join(out, "daily.csv"), recs: path.join(out, "recommendations.csv"), runLog: path.join(out, "state", "runlog.csv"), latestJson: path.join(out, "latest.json"), latestMd: path.join(out, "latest.md") };
}

function normalizeHourly(rows) {
  return rows.map((r) => {
    const expense = num(r.expense), broad = num(r.broad_gmv), direct = num(r.direct_gmv);
    return { ...r, hour: String(Number(r.hour)), points: num(r.points), expense: round(expense, 6), impression: num(r.impression), click: num(r.click), ctr: round(num(r.ctr) || div(r.click, r.impression), 6), cpc: round(num(r.cpc) || div(expense, r.click), 6), broad_order: num(r.broad_order), direct_order: num(r.direct_order), checkout: num(r.checkout), broad_gmv: round(broad, 6), direct_gmv: round(direct, 6), broad_roi: round(num(r.broad_roi) || div(broad, expense), 6), direct_roi: round(num(r.direct_roi) || div(direct, expense), 6), product_impression: num(r.product_impression), product_click: num(r.product_click), atc: num(r.atc) };
  }).sort((a, b) => key(a).localeCompare(key(b)));
}

function mergeRows(existing, incoming) {
  const m = new Map(existing.map((r) => [key(r), r]));
  for (const r of incoming) m.set(key(r), r);
  existing.splice(0, existing.length, ...[...m.values()].sort((a, b) => key(a).localeCompare(key(b))));
}

function importLegacy(store, file, cfg) {
  const rows = readCsv(path.resolve(file));
  const converted = rows.map((r) => {
    const c = cfg.countries.find((x) => x.code === r.country) || {};
    const expense = num(r.expense), broad = money(r.broad_gmv), direct = money(r.direct_gmv);
    return { country: r.country, profile_id: r.profile_id || c.profileId || "", profile_name: r.profile_name || "", date: r.date, timezone: r.timezone || c.timezone || "", hour: String(Number(r.hour)), hour_text: r.hour_text, points: num(r.points), expense, impression: num(r.impression), click: num(r.click), ctr: round(num(r.ctr) || div(r.click, r.impression), 6), cpc: round(num(r.cpc) || div(expense, r.click), 6), broad_order: num(r.broad_order), direct_order: num(r.direct_order), checkout: num(r.checkout), broad_gmv: round(broad, 6), direct_gmv: round(direct, 6), broad_roi: round(div(broad, expense), 6), direct_roi: round(div(direct, expense), 6), product_impression: num(r.product_impression), product_click: num(r.product_click), atc: num(r.atc), source: r.source || "legacy-hourly-csv", source_url: r.source_url || "", collected_at: r.collected_at || new Date().toISOString(), missing_reason: num(r.points) ? "" : "no_points" };
  });
  mergeRows(store.hourly, converted);
}

async function maybeGoogle(cfg, opt, store) {
  if (opt.google === false) return { status: "skipped", message: "--no-google" };
  if (opt.google === undefined && cfg.google?.enabled === false) return { status: "skipped", message: "disabled" };
  return syncGoogle(cfg, store, { dryRun: opt.dryRunGoogle });
}

async function syncGoogle(cfg, store, { dryRun = false } = {}) {
  const g = cfg.google || {};
  if (!g.spreadsheetId || !g.credentialPath) return { status: "skipped", message: "missing config" };
  const payloads = {
    [g.sheets.hourly]: [HOURLY, ...store.hourly.map((r) => HOURLY.map((h) => r[h] ?? ""))],
    [g.sheets.daily]: [DAILY, ...store.daily.map((r) => DAILY.map((h) => r[h] ?? ""))],
    [g.sheets.recommendations]: [RECS, ...store.recommendations.map((r) => RECS.map((h) => r[h] ?? ""))],
    [g.sheets.runLog]: [RUNLOG, ...readCsv(files(cfg).runLog).map((r) => RUNLOG.map((h) => r[h] ?? ""))],
  };
  if (dryRun) return { status: "dry-run", message: Object.entries(payloads).map(([k, v]) => `${k}:${v.length}`).join(", ") };
  try {
    const oldProxy = process.env.HTTPS_PROXY;
    if (g.proxy) process.env.HTTPS_PROXY = g.proxy;
    const creds = JSON.parse(fs.readFileSync(g.credentialPath, "utf8"));
    const token = await tokenFor(creds);
    await ensureSheets(g.spreadsheetId, Object.keys(payloads), token);
    for (const [sheet, rows] of Object.entries(payloads)) await updateValues(g.spreadsheetId, sheet, rows, token);
    if (oldProxy == null) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = oldProxy;
    return { status: "ok", message: "synced" };
  } catch (e) {
    return { status: "failed", message: e.message };
  }
}

async function tokenFor(creds) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: creds.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify(claim))}`;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64(crypto.sign("RSA-SHA256", Buffer.from(unsigned), creds.private_key))}` }).toString();
  return (await gReq("POST", "https://oauth2.googleapis.com/token", { headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) }, body })).access_token;
}

async function ensureSheets(id, titles, token) {
  const meta = await gReq("GET", `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`, { headers: { authorization: `Bearer ${token}` } });
  const existing = new Set((meta.sheets || []).map((s) => s.properties?.title));
  const missing = titles.filter((t) => !existing.has(t));
  if (missing.length) await gReq("POST", `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }) });
}

async function updateValues(id, title, values, token) {
  const range = `'${String(title).replace(/'/g, "''")}'!A1`;
  await gReq("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ majorDimension: "ROWS", values }) });
}

function gReq(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), proxy = proxyFor(u);
    const go = (socket) => {
      const opts = proxy ? { protocol: "https:", hostname: u.hostname, port: u.port || 443, method, path: `${u.pathname}${u.search}`, headers, socket, createConnection: () => socket } : { method, headers };
      const req = proxy ? https.request(opts, handle) : https.request(url, opts, handle);
      function handle(res) {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = text; try { data = text ? JSON.parse(text) : null; } catch {}
          res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 1000)}`));
        });
      }
      req.on("error", reject); if (body) req.write(body); req.end();
    };
    proxy ? tunnel(u, proxy).then(go, reject) : go();
  });
}

function proxyFor(u) {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  return raw && u.protocol === "https:" ? new URL(raw.includes("://") ? raw : `http://${raw}`) : null;
}

function tunnel(u, proxy) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: `${u.hostname}:443`, headers: { host: `${u.hostname}:443` } });
    req.on("connect", (res, socket) => res.statusCode === 200 ? tls.connect({ socket, servername: u.hostname }).once("secureConnect", function () { resolve(this); }).once("error", reject) : reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`)));
    req.on("error", reject); req.end();
  });
}

function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) { try { const m = require(name); if (m.chromium) return m; } catch {} }
  const cached = cachedPlaywright();
  if (cached) return require(cached);
  throw new Error("Playwright is not available.");
}

function cachedPlaywright() {
  const root = path.join(process.env.npm_config_cache || path.join(os.homedir(), "AppData", "Local", "npm-cache"), "_npx");
  if (!fs.existsSync(root)) return "";
  const c = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const p = path.join(root, d.name, "node_modules", "playwright-core");
    return fs.existsSync(path.join(p, "package.json")) ? { p, t: fs.statSync(path.join(p, "package.json")).mtimeMs } : null;
  }).filter(Boolean).sort((a, b) => b.t - a.t);
  return c[0]?.p || "";
}

async function openedBrowsers(base) {
  const j = await fetchJson(`${base.replace(/\/$/, "")}/api/v1/browser/local-active`);
  if (j.code !== 0) throw new Error(`AdsPower local-active failed: ${j.msg || j.code}`);
  return j.data?.list || [];
}

async function profileMap(base, ids) {
  if (!ids.length) return new Map();
  const j = await fetchJson(`${base.replace(/\/$/, "")}/api/v2/browser-profile/list`, { method: "POST", body: JSON.stringify({ page: 1, limit: 200, profile_id: ids }), headers: { "content-type": "application/json" } });
  return new Map((j.data?.list || []).map((p) => [p.profile_id, p]));
}

async function fetchJson(url, opt = {}) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

function readCsv(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const headers = rows.shift() || [];
  return rows.filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function writeCsv(file, headers, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n", "utf8");
}

function appendCsv(file, headers, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, (!fs.existsSync(file) ? headers.join(",") + "\r\n" : "") + headers.map((h) => cell(row[h])).join(",") + "\r\n", "utf8");
}

function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

function cell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function key(r) { return `${r.country}|${r.date}|${String(r.hour).padStart(2, "0")}`; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { const n = num(v); return Math.abs(n) >= AMOUNT_SCALE ? n / AMOUNT_SCALE : n; }
function div(a, b) { const d = num(b); return d ? num(a) / d : 0; }
function safeDiv(a, b) { return div(a, b); }
function round(v, d = 2) { return Number(num(v).toFixed(d)); }
function fmt(v, d = 2) { return num(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function tryJson(t) { try { return JSON.parse(t); } catch { return null; } }
function arraysByKey(root, k) { const out = [], seen = new WeakSet(); (function walk(n, d) { if (!n || typeof n !== "object" || d > 8 || seen.has(n)) return; seen.add(n); if (Array.isArray(n)) return n.slice(0, 50).forEach((x) => walk(x, d + 1)); for (const [key, v] of Object.entries(n)) key === k && Array.isArray(v) ? out.push(v) : walk(v, d + 1); })(root, 0); return out; }
function b64(x) { return Buffer.from(x).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function addDays(date, n) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function localDate(date, tz) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const v = Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value])); return `${v.year}-${v.month}-${v.day}`; }
function localHour(date, tz) { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).formatToParts(date).find((p) => p.type === "hour")?.value || 0); }
function zonedMs(date, hour, tz) { const [y, m, d] = date.split("-").map(Number); let g = Date.UTC(y, m - 1, d, hour); for (let i = 0; i < 4; i++) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date(g)); const v = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)])); g += Date.UTC(y, m - 1, d, hour) - Date.UTC(v.year, v.month - 1, v.day, v.hour); } return g; }

function printSummary(run, done, errors) {
  console.log(`Run: ${run.id}`);
  for (const d of done) console.log(`${d.country} ${d.date}: rows=${d.rows} source=${d.source}`);
  if (errors.length) { console.log("Errors:"); for (const e of errors) console.log(`- ${e.country || ""} ${e.date || ""}: ${e.message}`); }
}

async function main() {
  const opt = args(process.argv.slice(2));
  if (opt.help) return help();
  const cfg = config(opt.config);
  if (opt.command === "collect") await collect(cfg, opt);
  else if (opt.command === "analyze") await analyze(cfg, opt);
  else if (opt.command === "google") await googleOnly(cfg, opt);
  else throw new Error(`Unknown command: ${opt.command}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

