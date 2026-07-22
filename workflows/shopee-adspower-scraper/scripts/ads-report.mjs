#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config", "ads-autopilot.config.json");
const HEADERS = {
  product: ["country", "date", "product_id", "ad_name", "status", "ads_type", "ads_section", "impression", "clicks", "ctr", "conversions", "direct_conversions", "items_sold", "direct_items_sold", "gmv", "direct_gmv", "expense", "roas", "direct_roas", "acos", "direct_acos", "cpc", "keywords", "source_file"],
  rec: ["country", "date", "product_id", "ad_name", "action", "reason", "risk_note", "expense", "gmv", "direct_gmv", "roas", "direct_roas", "clicks", "impression", "ctr", "cpc", "conversions", "direct_conversions", "previous_expense", "previous_roas", "previous_cpc", "cpc_change_pct", "diagnostic_tags"],
  shop: ["country", "date", "ad_name", "ads_section", "expense", "gmv", "direct_gmv", "roas", "direct_roas", "clicks", "impression", "conversions", "source_file"],
  performance: ["country", "date", "item_id", "product", "status", "sales_placed", "sales_confirmed", "product_impression", "product_clicks", "ctr", "placed_order", "confirmed_order", "units_placed", "units_confirmed", "buyers", "conversion_rate_placed", "conversion_rate_confirmed", "visitors", "page_views", "bounce_visitors", "bounce_rate", "search_clicks", "likes", "atc_visitors", "atc_units", "atc_rate", "source_file"],
  impact: ["country", "date", "item_id", "product", "ad_name", "expense", "clicks", "conversions", "gmv", "roas", "direct_roas", "sales_placed", "sales_confirmed", "placed_order", "confirmed_order", "visitors", "page_views", "product_clicks", "product_ctr", "conversion_rate", "bounce_rate", "atc_visitors", "prev_date", "prev_expense", "prev_clicks", "prev_conversions", "prev_roas", "prev_sales_placed", "prev_sales_confirmed", "prev_placed_order", "prev_confirmed_order", "prev_visitors", "prev_page_views", "prev_product_clicks", "prev_conversion_rate", "spend_change_pct", "ad_click_change_pct", "roas_change_pct", "sales_change_pct", "order_change_pct", "visitor_change_pct", "page_view_change_pct", "product_click_change_pct", "conversion_rate_change_pct", "impact_action", "impact_reason", "risk_note", "diagnostic_tags"],
  manifest: ["run_id", "snapshot_dir", "created_at", "requested_date", "ads_data_date", "performance_data_date", "comparison_date", "comparison_status", "file_role", "file_path", "backup_path", "modified_at", "rows", "status", "message"],
  reportLog: ["run_id", "started_at", "finished_at", "date", "product_file", "product_rows", "recommendation_rows", "html", "xlsx", "status", "message"]
};

const DEFAULT_REPORT = {
  outputDir: path.join(ROOT, "exports", "ads-autopilot", "reports"),
  logsDir: path.join(ROOT, "exports", "ads-autopilot", "logs"),
  backupDir: path.join(ROOT, "exports", "ads-autopilot", "backups"),
  combinedAdsDir: "D:\\Shopee Export\\Combined\\Shopee Ads",
  combinedProductPerformanceDir: "D:\\Shopee Export\\Combined\\Product Performance",
  officialExportProject: path.resolve("E:/AI\u9879\u76ee\u6c47\u603b/shopee-official-excel-export"),
  staleMinutes: 90,
  productPerformanceStaleMinutes: 90,
  comparisonBase: "yesterday",
  autoExport: true,
  beijingReportTimes: ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"],
  productThresholds: {
    scaleRoas: 24,
    maintainRoas: 18,
    pauseRoas: 8,
    cpcJumpPct: 30,
    minSpendForPause: { ID: 20000, MY: 20, TH: 100 },
    highClickNoConversion: { ID: 30, MY: 30, TH: 30 },
    lowCtrPct: 1,
    directRiskRatio: 0.7
  },
  impactThresholds: {
    positiveLiftPct: 5,
    stableBandPct: 5,
    conversionDropPct: 10,
    clickLiftPct: 10,
    spendLiftPct: 10,
    highBounceRatePct: 70,
    weakConversionRatePct: 1,
    weakAtcRatePct: 2,
    highPageViews: 100
  }
};

function parseArgs(argv) {
  const o = { command: "run" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") && !o._cmd) { o.command = a; o._cmd = true; }
    else if (a === "--date") o.date = argv[++i];
    else if (a === "--no-export") o.noExport = true;
    else if (a === "--skip-collect") o.skipCollect = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function help() {
  console.log(`Usage:\n  node scripts/ads-report.mjs run [--date YYYY-MM-DD] [--no-export] [--skip-collect]\n  node scripts/ads-report.mjs generate [--date YYYY-MM-DD]`);
}

function loadConfig() {
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {};
  cfg.outDir ||= path.join(ROOT, "exports", "ads-autopilot");
  cfg.report = { ...DEFAULT_REPORT, ...(cfg.report || {}) };
  cfg.report.productThresholds = { ...DEFAULT_REPORT.productThresholds, ...(cfg.report.productThresholds || {}) };
  cfg.report.productThresholds.minSpendForPause = { ...DEFAULT_REPORT.productThresholds.minSpendForPause, ...(cfg.report.productThresholds.minSpendForPause || {}) };
  cfg.report.productThresholds.highClickNoConversion = { ...DEFAULT_REPORT.productThresholds.highClickNoConversion, ...(cfg.report.productThresholds.highClickNoConversion || {}) };
  cfg.report.impactThresholds = { ...DEFAULT_REPORT.impactThresholds, ...(cfg.report.impactThresholds || {}) };
  cfg.countries ||= [
    { code: "ID", label: "Indonesia", currency: "IDR" },
    { code: "MY", label: "Malaysia", currency: "MYR" },
    { code: "TH", label: "Thailand", currency: "THB" }
  ];
  return cfg;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) return help();
  const cfg = loadConfig();
  const date = normalizeDate(opt.date || localDate(new Date(), "Asia/Shanghai"));
  if (opt.command === "run") await runAll(cfg, opt, date);
  else if (opt.command === "generate") await generateOnly(cfg, date, []);
  else throw new Error(`Unknown command: ${opt.command}`);
}

async function runAll(cfg, opt, date) {
  const started = new Date().toISOString();
  const runId = started.replace(/[:.]/g, "-");
  const notes = [];
  mkdirs(cfg);
  if (!opt.skipCollect) {
    const r = runNode(path.join(ROOT, "scripts", "ads-autopilot.mjs"), ["collect", "--days", "2", "--no-google"], ROOT);
    notes.push(`hourly collect exit=${r.status}`);
    if (r.status !== 0) notes.push(trim(r.stderr || r.stdout));
  }
  let adsExportStatus = "skipped";
  let perfExportStatus = "skipped";
  if (!opt.noExport && cfg.report.autoExport !== false) {
    adsExportStatus = ensureOfficialAdsExport(cfg, date, notes, opt.dryRun);
    perfExportStatus = ensureOfficialProductPerformanceExport(cfg, date, notes, opt.dryRun);
  } else {
    notes.push("official export skipped");
  }
  const result = await generateOnly(cfg, date, notes, { runId, startedAt: started });
  appendCsv(path.join(cfg.report.logsDir, "report-runlog.csv"), HEADERS.reportLog, {
    run_id: runId,
    started_at: started,
    finished_at: new Date().toISOString(),
    date,
    product_file: result.productFile || "",
    product_rows: result.products.length,
    recommendation_rows: result.recommendations.length,
    html: result.html,
    xlsx: result.xlsx,
    status: result.recommendations.length || result.impactRows.length ? "ok" : "partial",
    message: [`ads_export=${adsExportStatus}`, `performance_export=${perfExportStatus}`, ...notes].filter(Boolean).join(" | ")
  });
  console.log(`Report generated: ${result.html}`);
  console.log(`Workbook generated: ${result.xlsx}`);
}

async function generateOnly(cfg, date, notes = [], runtime = {}) {
  mkdirs(cfg);
  const runId = runtime.runId || new Date().toISOString().replace(/[:.]/g, "-");
  let productDate = date;
  let rows = loadProductRows(cfg, productDate, notes);
  if (!rows.products.length) {
    const fallbackDate = findLatestProductDate(cfg, notes);
    if (fallbackDate && fallbackDate !== productDate) {
      notes.push(`Product ID data for ${productDate} is missing; using latest available official Shopee Ads date ${fallbackDate}.`);
      productDate = fallbackDate;
      rows = loadProductRows(cfg, productDate, notes);
    }
  }
  let performanceDate = date;
  let performance = loadProductPerformanceRows(cfg, performanceDate, notes);
  if (!performance.rows.length) {
    const fallbackDate = findLatestPerformanceDate(cfg, notes);
    if (fallbackDate && fallbackDate !== performanceDate) {
      notes.push(`Product Performance data for ${performanceDate} is missing; using latest available date ${fallbackDate}.`);
      performanceDate = fallbackDate;
      performance = loadProductPerformanceRows(cfg, performanceDate, notes);
    }
  }
  const prevRows = loadProductRows(cfg, addDays(productDate, -1), notes, { quiet: true }).products;
  const hourlyAll = readCsv(path.join(cfg.outDir, "hourly.csv"));
  const dailyAll = readCsv(path.join(cfg.outDir, "daily.csv"));
  const hourly = hourlyAll.filter((r) => r.date === date);
  const daily = dailyAll.filter((r) => r.date === date);
  const recommendations = diagnoseProducts(rows.products, prevRows, cfg);
  const baseline = loadComparisonBaseline(cfg, date, notes);
  const impactRows = buildProductImpactRows(rows.products, performance.rows, baseline, cfg, date);
  writeCsv(path.join(cfg.report.outputDir, "product-detail.csv"), HEADERS.product, rows.products);
  writeCsv(path.join(cfg.report.outputDir, "product-recommendations.csv"), HEADERS.rec, recommendations);
  writeCsv(path.join(cfg.report.outputDir, "product-performance.csv"), HEADERS.performance, performance.rows);
  writeCsv(path.join(cfg.report.outputDir, "product-impact.csv"), HEADERS.impact, impactRows);
  const sourceStatus = buildSourceStatus(cfg, {
    date,
    productDate,
    performanceDate,
    productFile: rows.productFile,
    performanceFile: performance.productPerformanceFile,
    hourlyAll,
    dailyAll,
    baseline
  });
  const manifestRows = writeBackupSnapshot(cfg, date, runId, {
    productDate,
    performanceDate,
    comparisonDate: baseline.date || "",
    comparisonStatus: baseline.status,
    productFile: rows.productFile,
    performanceFile: performance.productPerformanceFile,
    products: rows.products,
    recommendations,
    performanceRows: performance.rows,
    impactRows,
    hourly,
    daily,
    sourceStatus
  });
  writeCsv(path.join(cfg.report.outputDir, "backup-manifest.csv"), HEADERS.manifest, manifestRows);
  const stamp = stampForFile(new Date());
  const html = path.join(cfg.report.outputDir, `ShopeeAds_Report_${stamp}.html`);
  const xlsx = path.join(cfg.report.outputDir, `ShopeeAds_Report_${stamp}.xlsx`);
  const reportData = { date, productDate, performanceDate, daily, hourly, products: rows.products, shopRows: rows.shopRows, recommendations, performanceRows: performance.rows, impactRows, manifestRows, notes, sourceStatus, baseline };
  fs.writeFileSync(html, renderHtml(reportData), "utf8");
  writeWorkbook(cfg, xlsx, reportData);
  fs.copyFileSync(html, path.join(cfg.report.outputDir, "latest-report.html"));
  fs.copyFileSync(xlsx, path.join(cfg.report.outputDir, "latest-report.xlsx"));
  return { html, xlsx, productFile: rows.productFile, products: rows.products, recommendations, impactRows };
}

function ensureOfficialAdsExport(cfg, date, notes, dryRun = false) {
  const latest = findAdsWorkbookForDate(cfg, date, { requireFresh: true });
  if (latest) { notes.push(`official workbook fresh: ${latest.file}`); return "fresh"; }
  if (dryRun) { notes.push("dry-run: would trigger official Shopee Ads export"); return "dry-run"; }
  const project = cfg.report.officialExportProject;
  const script = path.join(project, "scripts", "shopee-export.mjs");
  if (!fs.existsSync(script)) { notes.push(`official exporter missing: ${script}`); return "missing-exporter"; }
  const slashDate = date.replaceAll("-", "/");
  const command = `Indonesia Malaysia Thailand Shopee Ads: ${slashDate}~${slashDate}`;
  const r = runNode(script, ["--approved-real-export", command], project, 30 * 60 * 1000);
  notes.push(`official Shopee Ads export exit=${r.status}`);
  if (r.stdout) notes.push(trim(r.stdout));
  if (r.stderr) notes.push(trim(r.stderr));
  return r.status === 0 ? "exported" : "failed";
}

function findAdsWorkbookForDate(cfg, date, { requireFresh = false } = {}) {
  return findWorkbookForDate(cfg.report.combinedAdsDir, date, { requireFresh, staleMinutes: cfg.report.staleMinutes || 90 });
}

function ensureOfficialProductPerformanceExport(cfg, date, notes, dryRun = false) {
  const latest = findWorkbookForDate(cfg.report.combinedProductPerformanceDir, date, { requireFresh: true, staleMinutes: cfg.report.productPerformanceStaleMinutes || 90 });
  if (latest) { notes.push(`official Product Performance workbook fresh: ${latest.file}`); return "fresh"; }
  if (dryRun) { notes.push("dry-run: would trigger official Product Performance export"); return "dry-run"; }
  const project = cfg.report.officialExportProject;
  const script = path.join(project, "scripts", "shopee-export.mjs");
  if (!fs.existsSync(script)) { notes.push(`official exporter missing: ${script}`); return "missing-exporter"; }
  const slashDate = date.replaceAll("-", "/");
  const command = `Indonesia Malaysia Thailand Product Performance: ${slashDate}~${slashDate}`;
  const r = runNode(script, ["--approved-real-export", command], project, 30 * 60 * 1000);
  notes.push(`official Product Performance export exit=${r.status}`);
  if (r.stdout) notes.push(trim(r.stdout));
  if (r.stderr) notes.push(trim(r.stderr));
  return r.status === 0 ? "exported" : "failed";
}

function findWorkbookForDate(dir, date, { requireFresh = false, staleMinutes = 90 } = {}) {
  if (!dir || !fs.existsSync(dir)) return null;
  const cutoff = Date.now() - Number(staleMinutes || 90) * 60 * 1000;
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .map((name) => {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      return { file, mtimeMs: st.mtimeMs, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files) {
    if (requireFresh && f.mtimeMs < cutoff) continue;
    if (workbookNameCoversDate(path.basename(f.file), date)) return f;
  }
  return requireFresh ? null : files[0] || null;
}

function datesFromWorkbookName(name) {
  const out = [];
  const addCompact = (d) => {
    if (!/^\d{6}$/.test(d)) return;
    out.push(`20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}`);
  };
  for (const m of name.matchAll(/(\d{6})-(\d{6})/g)) {
    addCompact(m[1]);
    addCompact(m[2]);
  }
  for (const m of name.matchAll(/(\d{8})[_-](\d{8})/g)) {
    out.push(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`);
    out.push(`${m[2].slice(0,4)}-${m[2].slice(4,6)}-${m[2].slice(6,8)}`);
  }
  return out;
}
function workbookNameCoversDate(name, date) {
  const compact = date.slice(2).replaceAll("-", "");
  if (name.includes(compact)) return true;
  const ranges = [...name.matchAll(/(\d{6})-(\d{6})/g)];
  for (const m of ranges) {
    if (compact >= m[1] && compact <= m[2]) return true;
  }
  const longCompact = date.replaceAll("-", "");
  const longRanges = [...name.matchAll(/(\d{8})_(\d{8})|(\d{8})-(\d{8})/g)];
  for (const m of longRanges) {
    const start = m[1] || m[3], end = m[2] || m[4];
    if (longCompact >= start && longCompact <= end) return true;
  }
  return false;
}

function loadProductRows(cfg, date, notes, { quiet = false } = {}) {
  const X = loadXlsx(cfg);
  const dir = cfg.report.combinedAdsDir;
  const products = [];
  const shopRows = [];
  let productFile = "";
  if (!fs.existsSync(dir)) {
    if (!quiet) notes.push(`combined ads dir missing: ${dir}`);
    return { products, shopRows, productFile };
  }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xlsx")).map((name) => {
    const file = path.join(dir, name);
    return { file, mtimeMs: fs.statSync(file).mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20);
  for (const f of files) {
    let foundForFile = 0;
    try {
      const wb = X.readFile(f.file, { cellDates: false, raw: false });
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const matrix = X.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: false });
        const headerRow = matrix.findIndex((r) => r.some((v) => normHeader(v) === "productid") && r.some((v) => normHeader(v) === "expense"));
        if (headerRow < 0) continue;
        const headers = matrix[headerRow].map((h) => String(h || ""));
        for (const row of matrix.slice(headerRow + 1)) {
          const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
          const rowDate = normalizeDate(dataDate(obj));
          if (rowDate !== date) continue;
          const country = countryFromSheet(sheetName, obj);
          const base = toProductRow(obj, country, rowDate, f.file);
          if (!base.ad_name && !base.product_id) continue;
          foundForFile += 1;
          if (base.product_id && base.product_id !== "-") products.push(base);
          else shopRows.push(pick(base, HEADERS.shop));
        }
      }
    } catch (e) {
      if (!quiet) notes.push(`read workbook failed: ${f.file}: ${e.message}`);
    }
    if (foundForFile && !productFile) productFile = f.file;
    if (products.length && foundForFile) {
      const countries = new Set(products.map((r) => r.country));
      if (countries.has("ID") && countries.has("MY") && countries.has("TH")) break;
    }
  }
  if (!products.length && !quiet) notes.push(`no Product ID rows found for ${date}`);
  return { products, shopRows, productFile };
}

function findLatestProductDate(cfg, notes) {
  const X = loadXlsx(cfg);
  const dir = cfg.report.combinedAdsDir;
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xlsx")).map((name) => {
    const file = path.join(dir, name);
    return { file, mtimeMs: fs.statSync(file).mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20);
  const dates = new Set();
  for (const f of files) {
    try {
      const wb = X.readFile(f.file, { cellDates: false, raw: false });
      for (const sheetName of wb.SheetNames) {
        const matrix = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
        const headerRow = matrix.findIndex((r) => r.some((v) => normHeader(v) === "productid") && r.some((v) => normHeader(v) === "expense"));
        if (headerRow < 0) continue;
        const headers = matrix[headerRow].map((h) => String(h || ""));
        const dateIndex = headers.findIndex((h) => ["\u6570\u636e\u65e5\u671f", "Data Date", "Date"].some((n) => normHeader(n) === normHeader(h)));
        const productIndex = headers.findIndex((h) => normHeader(h) === "productid");
        if (dateIndex < 0 || productIndex < 0) continue;
        for (const row of matrix.slice(headerRow + 1, headerRow + 300)) {
          const d = normalizeDate(row[dateIndex]);
          const pid = cleanId(row[productIndex]);
          if (d && pid && pid !== "-") dates.add(d);
        }
      }
    } catch (e) {
      notes.push(`latest product date scan failed: ${f.file}: ${e.message}`);
    }
  }
  return [...dates].sort().pop() || "";
}

function toProductRow(obj, country, date, sourceFile) {
  const impression = num(val(obj, ["Impression", "Impressions"]));
  const clicks = num(val(obj, ["Clicks", "Click"]));
  const expense = num(val(obj, ["Expense", "Cost"]));
  const gmv = num(val(obj, ["GMV"]));
  const directGmv = num(val(obj, ["Direct GMV"]));
  const conversions = num(val(obj, ["Conversions", "Orders"]));
  const directConversions = num(val(obj, ["Direct Conversions"]));
  const ctrRaw = val(obj, ["CTR"]);
  const ctr = rate(ctrRaw) || div(clicks, impression);
  const roas = num(val(obj, ["ROAS", "Broad ROAS"])) || div(gmv, expense);
  const directRoas = num(val(obj, ["Direct ROAS"])) || div(directGmv, expense);
  return {
    country,
    date,
    product_id: cleanId(val(obj, ["Product ID", "Item ID"])),
    ad_name: String(val(obj, ["Ad Name", "Product Name", "Name"]) || ""),
    status: String(val(obj, ["Status"]) || ""),
    ads_type: String(val(obj, ["Ads Type", "Ad Type"]) || ""),
    ads_section: String(val(obj, ["Ads Section"]) || ""),
    impression,
    clicks,
    ctr: round(ctr, 6),
    conversions,
    direct_conversions: directConversions,
    items_sold: num(val(obj, ["Items Sold"])),
    direct_items_sold: num(val(obj, ["Direct Items Sold"])),
    gmv,
    direct_gmv: directGmv,
    expense,
    roas: round(roas, 6),
    direct_roas: round(directRoas, 6),
    acos: rate(val(obj, ["ACOS"])),
    direct_acos: rate(val(obj, ["Direct ACOS"])),
    cpc: round(div(expense, clicks), 6),
    keywords: String(val(obj, ["Keywords"]) || ""),
    source_file: sourceFile
  };
}

function diagnoseProducts(products, prevRows, cfg) {
  const t = cfg.report.productThresholds;
  const prev = new Map(prevRows.map((r) => [`${r.country}|${r.product_id}`, r]));
  return products.map((r) => {
    const p = prev.get(`${r.country}|${r.product_id}`);
    const cpcChange = p && p.cpc ? ((r.cpc - p.cpc) / p.cpc) * 100 : 0;
    const tags = diagnosticTags(r, p, cpcChange, t);
    const decision = productDecision(r, p, cpcChange, t);
    return {
      country: r.country,
      date: r.date,
      product_id: r.product_id,
      ad_name: r.ad_name,
      action: decision.action,
      reason: decision.reason,
      risk_note: decision.risk,
      expense: r.expense,
      gmv: r.gmv,
      direct_gmv: r.direct_gmv,
      roas: r.roas,
      direct_roas: r.direct_roas,
      clicks: r.clicks,
      impression: r.impression,
      ctr: r.ctr,
      cpc: r.cpc,
      conversions: r.conversions,
      direct_conversions: r.direct_conversions,
      previous_expense: p?.expense || 0,
      previous_roas: p?.roas || 0,
      previous_cpc: p?.cpc || 0,
      cpc_change_pct: round(cpcChange, 2),
      diagnostic_tags: tags.join("; ")
    };
  }).sort((a, b) => actionRank(a.action) - actionRank(b.action) || b.expense - a.expense);
}

function productDecision(r, p, cpcChange, t) {
  const pauseSpend = num(t.minSpendForPause?.[r.country] ?? 20);
  const highClicks = num(t.highClickNoConversion?.[r.country] ?? 30);
  const risk = r.direct_roas > 0 && r.direct_roas < r.roas * num(t.directRiskRatio ?? 0.7) ? "Direct ROAS is materially lower than ROAS; scale conservatively." : "";
  if ((r.expense >= pauseSpend && r.roas < t.pauseRoas) || (r.clicks >= highClicks && r.conversions <= 0)) return { action: "\u6682\u505c/\u8bca\u65ad", reason: "ROAS below threshold or high clicks without conversion.", risk };
  if ((p && cpcChange >= t.cpcJumpPct) || (r.roas >= t.pauseRoas && r.roas < t.maintainRoas)) return { action: "\u63a7\u8d39", reason: p && cpcChange >= t.cpcJumpPct ? `CPC increased ${round(cpcChange, 1)}% versus previous day.` : "ROAS is weak; control spend.", risk };
  if (r.roas >= t.scaleRoas && r.clicks > 0 && r.conversions > 0) return { action: "\u653e\u91cf", reason: "ROAS, clicks, and conversions are healthy.", risk };
  if (r.roas >= t.maintainRoas) return { action: "\u7ef4\u6301", reason: "ROAS is in maintain range.", risk };
  return { action: "\u89c2\u5bdf", reason: "Traffic or spend is too low for a strong decision.", risk };
}

function diagnosticTags(r, p, cpcChange, t) {
  const tags = [];
  if (r.impression >= 1000 && r.ctr > 0 && r.ctr < num(t.lowCtrPct ?? 1) / 100) tags.push("\u9ad8\u5c55\u73b0\u4f4eCTR");
  if (r.clicks >= num(t.highClickNoConversion?.[r.country] ?? 30) && r.conversions <= 0) tags.push("\u9ad8\u70b9\u51fb\u4f4e\u8f6c\u5316");
  if (r.expense >= num(t.minSpendForPause?.[r.country] ?? 20) && r.gmv <= 0) tags.push("\u9ad8\u82b1\u8d39\u4f4eGMV");
  if (r.direct_roas > 0 && r.direct_roas < r.roas * num(t.directRiskRatio ?? 0.7)) tags.push("Direct ROAS\u663e\u8457\u4f4e\u4e8eROAS");
  if (p && r.expense > p.expense && r.roas < p.roas) tags.push("\u82b1\u8d39\u4e0a\u6da8ROAS\u4e0b\u6ed1");
  if (p && cpcChange >= t.cpcJumpPct) tags.push("CPC\u4e0a\u6da8");
  return tags;
}

function loadProductPerformanceRows(cfg, date, notes, { quiet = false } = {}) {
  const X = loadXlsx(cfg);
  const dir = cfg.report.combinedProductPerformanceDir;
  const rows = [];
  const byKey = new Map();
  let productPerformanceFile = "";
  if (!fs.existsSync(dir)) {
    if (!quiet) notes.push(`combined product performance dir missing: ${dir}`);
    return { rows, productPerformanceFile };
  }
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xlsx"))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 30);
  for (const f of files) {
    if (!workbookNameCoversDate(path.basename(f.file), date)) continue;
    let foundForFile = 0;
    try {
      const wb = X.readFile(f.file, { cellDates: false, raw: false });
      for (const sheetName of wb.SheetNames) {
        const matrix = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
        const headerRow = matrix.findIndex((r) => r.some((v) => normHeader(v) === "itemid") && r.some((v) => normHeader(v) === "variationid"));
        if (headerRow < 0) continue;
        const headers = matrix[headerRow].map((h) => String(h || ""));
        for (const row of matrix.slice(headerRow + 1)) {
          const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
          const rowDate = normalizeDate(dataDate(obj) || date);
          if (rowDate !== date) continue;
          const variationId = cleanId(val(obj, ["Variation ID"]));
          if (variationId !== "-") continue;
          const country = countryFromSheet(sheetName, obj);
          const item = toPerformanceRow(obj, country, rowDate, f.file);
          if (!item.item_id || item.item_id === "-") continue;
          foundForFile += 1;
          const key = `${item.country}|${item.item_id}`;
          if (!byKey.has(key)) byKey.set(key, item);
          else byKey.set(key, mergePerformanceRows(byKey.get(key), item));
        }
      }
    } catch (e) {
      if (!quiet) notes.push(`read Product Performance workbook failed: ${f.file}: ${e.message}`);
    }
    if (foundForFile && !productPerformanceFile) productPerformanceFile = f.file;
  }
  rows.push(...[...byKey.values()].sort((a, b) => a.country.localeCompare(b.country) || String(a.item_id).localeCompare(String(b.item_id))));
  if (!rows.length && !quiet) notes.push(`no Product Performance item rows found for ${date}`);
  return { rows, productPerformanceFile };
}

function toPerformanceRow(obj, country, date, sourceFile) {
  const productImpression = num(valLoose(obj, ["Product Impression"]));
  const productClicks = num(valLoose(obj, ["Product Clicks"]));
  const visitors = num(valLoose(obj, ["Product Visitors (Visit)", "Product Visitors"]));
  const placedOrder = num(valLoose(obj, ["Placed Order"]));
  const confirmedOrder = num(valLoose(obj, ["Confirmed Order"]));
  const atcVisitors = num(valLoose(obj, ["Product Visitors (Add to Cart)"]));
  return {
    country,
    date,
    item_id: cleanId(valLoose(obj, ["Item ID"])),
    product: String(valLoose(obj, ["Product", "Product Name"]) || ""),
    status: String(valLoose(obj, ["Current Item Status", "Status"]) || ""),
    sales_placed: num(valLoose(obj, ["Sales (Placed Order)", "Sales Placed Order"])),
    sales_confirmed: num(valLoose(obj, ["Sales (Confirmed Order)", "Sales Confirmed Order"])),
    product_impression: productImpression,
    product_clicks: productClicks,
    ctr: round(rate(valLoose(obj, ["CTR"])) || div(productClicks, productImpression), 6),
    placed_order: placedOrder,
    confirmed_order: confirmedOrder,
    units_placed: num(valLoose(obj, ["Units (Placed Order)", "Units Placed Order"])),
    units_confirmed: num(valLoose(obj, ["Units (Confirmed Order)", "Units Confirmed Order"])),
    buyers: num(valLoose(obj, ["Buyers"])),
    conversion_rate_placed: round(rate(valLoose(obj, ["Order Conversion Rate (Placed Order)"])) || div(placedOrder, visitors), 6),
    conversion_rate_confirmed: round(rate(valLoose(obj, ["Order Conversion Rate (Confirmed Order)", "Conversion Rate"])) || div(confirmedOrder, visitors), 6),
    visitors,
    page_views: num(valLoose(obj, ["Product Page Views", "Page Views"])),
    bounce_visitors: num(valLoose(obj, ["Product Bounce Visitors"])),
    bounce_rate: round(rate(valLoose(obj, ["Product Bounce Rate", "Bounce Rate"])), 6),
    search_clicks: num(valLoose(obj, ["Search Clicks"])),
    likes: num(valLoose(obj, ["Likes"])),
    atc_visitors: atcVisitors,
    atc_units: num(valLoose(obj, ["Units (Add to Cart)"])),
    atc_rate: round(rate(valLoose(obj, ["Conversion Rate (Add to Cart)"])) || div(atcVisitors, visitors), 6),
    source_file: sourceFile
  };
}

function mergePerformanceRows(a, b) {
  const out = { ...a };
  for (const k of HEADERS.performance) {
    if (["country", "date", "item_id", "product", "status", "source_file"].includes(k)) continue;
    out[k] = num(a[k]) + num(b[k]);
  }
  out.ctr = round(div(out.product_clicks, out.product_impression), 6);
  out.conversion_rate_placed = round(div(out.placed_order, out.visitors), 6);
  out.conversion_rate_confirmed = round(div(out.confirmed_order, out.visitors), 6);
  out.atc_rate = round(div(out.atc_visitors, out.visitors), 6);
  out.bounce_rate = round(div(out.bounce_visitors, out.visitors), 6);
  out.source_file = [a.source_file, b.source_file].filter(Boolean).join(";");
  return out;
}

function findLatestPerformanceDate(cfg, notes) {
  const X = loadXlsx(cfg);
  const dir = cfg.report.combinedProductPerformanceDir;
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xlsx")).map((name) => {
    const file = path.join(dir, name);
    return { name, file, mtimeMs: fs.statSync(file).mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 30);
  const dates = new Set();
  for (const f of files) {
    for (const d of datesFromWorkbookName(f.name)) dates.add(d);
    try {
      const wb = X.readFile(f.file, { cellDates: false, raw: false });
      for (const sheetName of wb.SheetNames) {
        const matrix = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
        const headerRow = matrix.findIndex((r) => r.some((v) => normHeader(v) === "itemid") && r.some((v) => normHeader(v) === "variationid"));
        if (headerRow < 0) continue;
        const headers = matrix[headerRow].map((h) => String(h || ""));
        const itemIndex = headers.findIndex((h) => normHeader(h) === "itemid");
        const varIndex = headers.findIndex((h) => normHeader(h) === "variationid");
        if (itemIndex < 0 || varIndex < 0) continue;
        for (const row of matrix.slice(headerRow + 1, headerRow + 500)) {
          const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
          const d = normalizeDate(dataDate(obj));
          const item = cleanId(row[itemIndex]);
          const variation = cleanId(row[varIndex]);
          if (d && item && item !== "-" && variation === "-") dates.add(d);
        }
      }
    } catch (e) {
      notes.push(`latest Product Performance date scan failed: ${f.file}: ${e.message}`);
    }
  }
  return [...dates].sort().pop() || "";
}
function loadComparisonBaseline(cfg, date, notes) {
  const yesterday = addDays(date, -1);
  const dirs = backupDateDirs(cfg.report.backupDir).filter((d) => d.date < date);
  const preferred = dirs.find((d) => d.date === yesterday);
  const selected = preferred || dirs.sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!selected) {
    notes.push("Today baseline backup captured; comparison will start after a historical backup exists.");
    return { status: "baseline", message: "Today is the baseline backup. Day-over-day comparison starts after the next backup.", date: "", adsRows: [], performanceRows: [], dir: "" };
  }
  const snapshots = fs.readdirSync(selected.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(selected.dir, d.name)).sort().reverse();
  for (const dir of snapshots) {
    const adsFile = path.join(dir, "product-detail.csv");
    const perfFile = path.join(dir, "product-performance.csv");
    if (fs.existsSync(adsFile) || fs.existsSync(perfFile)) {
      const status = selected.date === yesterday ? "available" : "fallback";
      if (status === "fallback") notes.push(`Yesterday baseline is missing; comparing with latest backup ${selected.date}.`);
      return { status, message: status === "available" ? "Day-over-day comparison available." : `Fallback baseline: ${selected.date}`, date: selected.date, dir, adsRows: readCsv(adsFile), performanceRows: readCsv(perfFile) };
    }
  }
  notes.push("Today baseline backup captured; comparison will start after a historical backup exists.");
  return { status: "baseline", message: "No usable historical backup found.", date: "", adsRows: [], performanceRows: [], dir: "" };
}

function backupDateDirs(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => ({ date: d.name, dir: path.join(backupDir, d.name) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function buildProductImpactRows(adsRows, performanceRows, baseline, cfg, date) {
  const ads = aggregateAdsByProduct(adsRows);
  const perf = new Map(performanceRows.map((r) => [`${r.country}|${r.item_id}`, r]));
  const prevAds = aggregateAdsByProduct(baseline.adsRows || []);
  const prevPerf = new Map((baseline.performanceRows || []).map((r) => [`${r.country}|${r.item_id}`, r]));
  const keys = new Set([...ads.keys(), ...perf.keys()]);
  const rows = [];
  for (const key of keys) {
    const a = ads.get(key) || {};
    const p = perf.get(key) || {};
    const pa = prevAds.get(key) || {};
    const pp = prevPerf.get(key) || {};
    const country = a.country || p.country || key.split("|")[0];
    const itemId = a.product_id || p.item_id || key.split("|")[1];
    const conversionRate = num(p.conversion_rate_confirmed || p.conversion_rate_placed);
    const prevConversionRate = num(pp.conversion_rate_confirmed || pp.conversion_rate_placed);
    const row = {
      country,
      date,
      item_id: itemId,
      product: p.product || "",
      ad_name: a.ad_name || "",
      expense: num(a.expense),
      clicks: num(a.clicks),
      conversions: num(a.conversions),
      gmv: num(a.gmv),
      roas: num(a.roas),
      direct_roas: num(a.direct_roas),
      sales_placed: num(p.sales_placed),
      sales_confirmed: num(p.sales_confirmed),
      placed_order: num(p.placed_order),
      confirmed_order: num(p.confirmed_order),
      visitors: num(p.visitors),
      page_views: num(p.page_views),
      product_clicks: num(p.product_clicks),
      product_ctr: num(p.ctr),
      conversion_rate: conversionRate,
      bounce_rate: num(p.bounce_rate),
      atc_visitors: num(p.atc_visitors),
      prev_date: baseline.date || "",
      prev_expense: num(pa.expense),
      prev_clicks: num(pa.clicks),
      prev_conversions: num(pa.conversions),
      prev_roas: num(pa.roas),
      prev_sales_placed: num(pp.sales_placed),
      prev_sales_confirmed: num(pp.sales_confirmed),
      prev_placed_order: num(pp.placed_order),
      prev_confirmed_order: num(pp.confirmed_order),
      prev_visitors: num(pp.visitors),
      prev_page_views: num(pp.page_views),
      prev_product_clicks: num(pp.product_clicks),
      prev_conversion_rate: prevConversionRate,
      spend_change_pct: changePct(num(a.expense), num(pa.expense)),
      ad_click_change_pct: changePct(num(a.clicks), num(pa.clicks)),
      roas_change_pct: changePct(num(a.roas), num(pa.roas)),
      sales_change_pct: changePct(num(p.sales_confirmed || p.sales_placed), num(pp.sales_confirmed || pp.sales_placed)),
      order_change_pct: changePct(num(p.confirmed_order || p.placed_order), num(pp.confirmed_order || pp.placed_order)),
      visitor_change_pct: changePct(num(p.visitors), num(pp.visitors)),
      page_view_change_pct: changePct(num(p.page_views), num(pp.page_views)),
      product_click_change_pct: changePct(num(p.product_clicks), num(pp.product_clicks)),
      conversion_rate_change_pct: changePct(conversionRate, prevConversionRate)
    };
    const decision = impactDecision(row, baseline, cfg);
    rows.push({ ...row, ...decision });
  }
  return rows.sort((a, b) => impactRank(a.impact_action) - impactRank(b.impact_action) || b.expense - a.expense || b.page_views - a.page_views);
}

function aggregateAdsByProduct(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const pid = cleanId(r.product_id);
    if (!pid || pid === "-") continue;
    const key = `${r.country}|${pid}`;
    const cur = m.get(key) || { country: r.country, product_id: pid, ad_name: "", expense: 0, clicks: 0, conversions: 0, direct_conversions: 0, gmv: 0, direct_gmv: 0, impression: 0 };
    cur.ad_name ||= r.ad_name || "";
    cur.expense += num(r.expense);
    cur.clicks += num(r.clicks);
    cur.conversions += num(r.conversions);
    cur.direct_conversions += num(r.direct_conversions);
    cur.gmv += num(r.gmv);
    cur.direct_gmv += num(r.direct_gmv);
    cur.impression += num(r.impression);
    m.set(key, cur);
  }
  for (const cur of m.values()) {
    cur.roas = round(div(cur.gmv, cur.expense), 6);
    cur.direct_roas = round(div(cur.direct_gmv, cur.expense), 6);
  }
  return m;
}

function impactDecision(r, baseline, cfg) {
  const t = cfg.report.impactThresholds || DEFAULT_REPORT.impactThresholds;
  const pt = cfg.report.productThresholds || DEFAULT_REPORT.productThresholds;
  const pauseSpend = num(pt.minSpendForPause?.[r.country] ?? 20);
  const highClicks = num(pt.highClickNoConversion?.[r.country] ?? 30);
  const tags = [];
  if (!baseline.date) return { impact_action: "baseline_today", impact_reason: "Today backup is captured; day-over-day comparison starts after a historical backup exists.", risk_note: "", diagnostic_tags: "" };
  if (r.page_views >= num(t.highPageViews) && r.conversion_rate > 0 && r.conversion_rate < num(t.weakConversionRatePct) / 100) tags.push("high_views_low_cvr");
  if (r.bounce_rate >= num(t.highBounceRatePct) / 100) tags.push("high_bounce_rate");
  if (r.visitors > 0 && div(r.atc_visitors, r.visitors) < num(t.weakAtcRatePct) / 100) tags.push("weak_add_to_cart");
  if (r.product_click_change_pct <= -num(t.stableBandPct)) tags.push("product_clicks_down");
  if (r.direct_roas > 0 && r.roas > 0 && r.direct_roas < r.roas * num(pt.directRiskRatio ?? 0.7)) tags.push("direct_roas_risk");
  const orders = r.confirmed_order || r.placed_order;
  const sales = r.sales_confirmed || r.sales_placed;
  const orderUp = r.order_change_pct >= num(t.positiveLiftPct);
  const salesUp = r.sales_change_pct >= num(t.positiveLiftPct);
  const crDown = r.conversion_rate_change_pct <= -num(t.conversionDropPct);
  const adClicksUp = r.ad_click_change_pct >= num(t.clickLiftPct);
  const spendUp = r.spend_change_pct >= num(t.spendLiftPct);
  if ((r.expense >= pauseSpend && r.roas < num(pt.pauseRoas)) || (r.clicks >= highClicks && orders <= 0)) return { impact_action: "pause_diagnose", impact_reason: "Ad ROAS is below the pause threshold, or ad clicks are high while the link has no orders.", risk_note: tags.join("; "), diagnostic_tags: tags.join("; ") };
  if ((spendUp || adClicksUp) && (salesUp || orderUp) && !crDown) return { impact_action: "positive_scale", impact_reason: "Ad spend/clicks increased and link sales/orders improved without a material CVR drop.", risk_note: "", diagnostic_tags: tags.join("; ") };
  if (r.roas >= num(pt.maintainRoas) && (r.sales_change_pct >= -num(t.stableBandPct) || r.order_change_pct >= -num(t.stableBandPct) || r.visitor_change_pct >= -num(t.stableBandPct))) return { impact_action: "effective_maintain", impact_reason: "Ad ROAS is acceptable and link traffic or orders stayed stable.", risk_note: "", diagnostic_tags: tags.join("; ") };
  if (adClicksUp && !orderUp && r.conversion_rate_change_pct <= 0) return { impact_action: "traffic_without_conversion", impact_reason: "Ad clicks increased, but link orders or conversion rate did not improve.", risk_note: tags.join("; "), diagnostic_tags: tags.join("; ") };
  if (spendUp && (r.sales_change_pct < 0 || r.roas_change_pct < 0 || crDown)) return { impact_action: "efficiency_squeeze", impact_reason: "Ad spend increased while link sales, ROAS, or conversion rate declined.", risk_note: tags.join("; "), diagnostic_tags: tags.join("; ") };
  if (tags.some((x) => ["high_views_low_cvr", "high_bounce_rate", "weak_add_to_cart", "product_clicks_down"].includes(x))) return { impact_action: "link_issue_first", impact_reason: "Link-side engagement or conversion metrics are weak; fix listing traffic conversion before scaling ads.", risk_note: tags.join("; "), diagnostic_tags: tags.join("; ") };
  return { impact_action: "observe", impact_reason: sales || orders || r.expense ? "Change is below the action threshold; keep tracking next run." : "Low ad and link volume; keep as monitoring only.", risk_note: tags.join("; "), diagnostic_tags: tags.join("; ") };
}
function writeBackupSnapshot(cfg, date, runId, data) {
  const createdAt = new Date().toISOString();
  const minute = localTimeParts(new Date(), "Asia/Shanghai");
  const snapshotDir = path.join(cfg.report.backupDir, date, `${minute.hour}${minute.minute}`);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const rows = [];
  const add = (role, src, rowCount, status = "ok", message = "") => {
    let backupPath = "";
    let modifiedAt = "";
    try {
      if (src && fs.existsSync(src)) {
        const name = path.basename(src);
        backupPath = path.join(snapshotDir, name);
        if (path.resolve(src) !== path.resolve(backupPath)) fs.copyFileSync(src, backupPath);
        modifiedAt = fs.statSync(src).mtime.toISOString();
      } else if (src) {
        status = "missing";
        message ||= "source file missing";
      }
    } catch (e) {
      status = "failed";
      message = e.message;
    }
    rows.push({ run_id: runId, snapshot_dir: snapshotDir, created_at: createdAt, requested_date: date, ads_data_date: data.productDate || "", performance_data_date: data.performanceDate || "", comparison_date: data.comparisonDate || "", comparison_status: data.comparisonStatus || "", file_role: role, file_path: src || "", backup_path: backupPath, modified_at: modifiedAt, rows: rowCount ?? "", status, message });
  };
  const reportDir = cfg.report.outputDir;
  add("hourly.csv", path.join(cfg.outDir, "hourly.csv"), data.hourly?.length ?? "", fs.existsSync(path.join(cfg.outDir, "hourly.csv")) ? "ok" : "missing");
  add("daily.csv", path.join(cfg.outDir, "daily.csv"), data.daily?.length ?? "", fs.existsSync(path.join(cfg.outDir, "daily.csv")) ? "ok" : "missing");
  add("product-detail.csv", path.join(reportDir, "product-detail.csv"), data.products?.length ?? "");
  add("product-recommendations.csv", path.join(reportDir, "product-recommendations.csv"), data.recommendations?.length ?? "");
  add("product-performance.csv", path.join(reportDir, "product-performance.csv"), data.performanceRows?.length ?? "");
  add("product-impact.csv", path.join(reportDir, "product-impact.csv"), data.impactRows?.length ?? "");
  add("official-shopee-ads.xlsx", data.productFile || "", data.products?.length ?? "", data.productFile ? "ok" : "missing", data.productFile ? "" : "official Shopee Ads workbook unavailable");
  add("official-product-performance.xlsx", data.performanceFile || "", data.performanceRows?.length ?? "", data.performanceFile ? "ok" : "missing", data.performanceFile ? "" : "official Product Performance workbook unavailable");
  const manifest = {
    run_id: runId,
    created_at: createdAt,
    requested_date: date,
    ads_data_date: data.productDate || "",
    performance_data_date: data.performanceDate || "",
    comparison_date: data.comparisonDate || "",
    comparison_status: data.comparisonStatus || "",
    source_status: data.sourceStatus || {},
    files: rows
  };
  fs.writeFileSync(path.join(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  rows.push({ run_id: runId, snapshot_dir: snapshotDir, created_at: createdAt, requested_date: date, ads_data_date: data.productDate || "", performance_data_date: data.performanceDate || "", comparison_date: data.comparisonDate || "", comparison_status: data.comparisonStatus || "", file_role: "manifest.json", file_path: path.join(snapshotDir, "manifest.json"), backup_path: path.join(snapshotDir, "manifest.json"), modified_at: createdAt, rows: rows.length, status: "ok", message: "" });
  return rows;
}

function buildSourceStatus(cfg, data) {
  const hourlyFile = path.join(cfg.outDir, "hourly.csv");
  const dailyFile = path.join(cfg.outDir, "daily.csv");
  return {
    generated_at: new Date().toISOString(),
    hourly_updated_at: fileMtime(hourlyFile),
    daily_updated_at: fileMtime(dailyFile),
    ads_detail_updated_at: fileMtime(data.productFile),
    product_performance_updated_at: fileMtime(data.performanceFile),
    product_performance_date: data.performanceDate || "",
    ads_detail_date: data.productDate || "",
    comparison_date: data.baseline?.date || "",
    comparison_status: data.baseline?.status || "baseline",
    comparison_message: data.baseline?.message || "",
    hourly_rows_for_date: data.hourlyAll.filter((r) => r.date === data.date).length,
    daily_rows_for_date: data.dailyAll.filter((r) => r.date === data.date).length
  };
}

function renderHtml(data) {
  const byCountry = group(data.products, (r) => r.country);
  const kpiRows = ["ID", "MY", "TH"].map((c) => productKpi(c, byCountry.get(c) || []));
  const topSpend = [...data.products].sort((a, b) => b.expense - a.expense).slice(0, 15);
  const lowEff = data.recommendations.filter((r) => r.action === "\u6682\u505c/\u8bca\u65ad" || r.action === "\u63a7\u8d39").slice(0, 20);
  const scale = data.recommendations.filter((r) => r.action === "\u653e\u91cf").slice(0, 20);
  const impactPriority = data.impactRows.filter((r) => ["pause_diagnose", "traffic_without_conversion", "efficiency_squeeze", "link_issue_first"].includes(r.impact_action)).slice(0, 30);
  const statusText = data.baseline.date ? (data.baseline.status === "available" ? "comparison_available" : "comparison_fallback") : "baseline_today";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Shopee Ads Report ${esc(data.date)}</title><style>
  body{font-family:Segoe UI,Arial,"Microsoft YaHei",sans-serif;margin:0;background:#f6f7f9;color:#1f2933}header{background:#111827;color:#fff;padding:20px 28px}main{padding:20px 28px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.card{background:white;border:1px solid #dde2e8;border-radius:8px;padding:14px}.kpi{font-size:24px;font-weight:700}table{width:100%;border-collapse:collapse;background:white;margin-top:12px;font-size:12px}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eef2f7}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.bad{color:#b91c1c}.good{color:#047857}.muted{color:#6b7280}.pill{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:2px 8px;background:#fff;color:#374151}h2{margin-top:22px}.notes li{margin:4px 0}@media(max-width:1100px){.grid,.charts,.meta{grid-template-columns:1fr}}
  </style></head><body><header><h1>Shopee Ads Product Impact Report</h1><div>Report date ${esc(data.date)} | Ads data date ${esc(data.productDate || data.date)} | Product Performance date ${esc(data.performanceDate || "")} | <span class="pill">${esc(statusText)}</span></div></header><main>
  <section class="meta">
    <div class="card"><b>Generated At</b><br>${esc(formatTime(data.sourceStatus.generated_at))}</div>
    <div class="card"><b>Hourly Updated At</b><br>${esc(formatTime(data.sourceStatus.hourly_updated_at))}</div>
    <div class="card"><b>Shopee Ads Detail Updated At</b><br>${esc(formatTime(data.sourceStatus.ads_detail_updated_at))}</div>
    <div class="card"><b>Product Performance Updated At</b><br>${esc(formatTime(data.sourceStatus.product_performance_updated_at))}</div>
    <div class="card"><b>Comparison Base Date</b><br>${esc(data.baseline.date || "none")}</div>
    <div class="card"><b>Product Impact Rows</b><br>${data.impactRows.length}</div>
    <div class="card"><b>Hourly Rows</b><br>${data.sourceStatus.hourly_rows_for_date}</div>
    <div class="card"><b>Status</b><br>${esc(data.baseline.message || statusText)}</div>
  </section>
  ${data.notes.length ? `<div class="card"><b>Run Notes</b><ul class="notes">${data.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
  <section class="grid">${kpiRows.map((k) => `<div class="card"><div>${k.country}</div><div class="kpi">ROAS ${fmt(k.roas,2)}</div><div>Spend ${fmt(k.expense,0)} | GMV ${fmt(k.gmv,0)} | Product ${k.count}</div></div>`).join("")}</section>
  <h2>Hourly Trend</h2><section class="charts">${["ID", "MY", "TH"].map((c) => `<div class="card"><h3>${c} Spend / ROAS</h3>${hourSvg(data.hourly.filter((r) => r.country === c))}</div>`).join("")}</section>
  <h2>Product Impact Comparison</h2>${impactTable(data.impactRows.slice(0, 40))}
  <h2>Abnormal Links</h2>${impactTable(impactPriority)}
  <h2>Action Summary</h2>${summaryTable(data.recommendations)}
  <h2>Scale Product ID</h2>${productTable(scale)}
  <h2>Control / Pause Product ID</h2>${productTable(lowEff)}
  <h2>Top Spend Product ID</h2>${productTable(topSpend.map((r) => ({...r, action:"", reason:"", risk_note:"", diagnostic_tags:""})))}
  <h2>Shop / GMV Max Level</h2>${shopTable(data.shopRows)}
  </main></body></html>`;
}
function productKpi(country, rows) {
  const expense = sum(rows, "expense"), gmv = sum(rows, "gmv"), clicks = sum(rows, "clicks"), imp = sum(rows, "impression");
  return { country, count: rows.length, expense, gmv, roas: div(gmv, expense), clicks, imp };
}

function summaryTable(recs) {
  const actions = ["\u653e\u91cf", "\u7ef4\u6301", "\u63a7\u8d39", "\u6682\u505c/\u8bca\u65ad", "\u89c2\u5bdf"];
  const rows = [];
  for (const c of ["ID", "MY", "TH"]) for (const a of actions) rows.push({ country: c, action: a, count: recs.filter((r) => r.country === c && r.action === a).length, spend: sum(recs.filter((r) => r.country === c && r.action === a), "expense") });
  return `<table><tr><th>Country</th><th>Action</th><th>Count</th><th>Spend</th></tr>${rows.map((r) => `<tr><td>${r.country}</td><td>${esc(r.action)}</td><td>${r.count}</td><td>${fmt(r.spend,0)}</td></tr>`).join("")}</table>`;
}

function impactTable(rows) {
  if (!rows.length) return `<p class="muted">No impact rows.</p>`;
  return `<table><tr><th>Country</th><th>Item ID</th><th>Product</th><th>Impact Action</th><th>Spend</th><th>Spend WoW</th><th>Ad Click WoW</th><th>ROAS</th><th>ROAS WoW</th><th>Sales</th><th>Sales WoW</th><th>Orders</th><th>Order WoW</th><th>Visitors</th><th>CVR</th><th>CVR WoW</th><th>Reason</th><th>Tags</th></tr>${rows.map((r) => `<tr><td>${r.country}</td><td>${esc(r.item_id)}</td><td>${esc(short(r.product || r.ad_name,70))}</td><td>${esc(r.impact_action)}</td><td>${fmt(r.expense,0)}</td><td>${fmtPct(r.spend_change_pct)}</td><td>${fmtPct(r.ad_click_change_pct)}</td><td>${fmt(r.roas,2)}</td><td>${fmtPct(r.roas_change_pct)}</td><td>${fmt(r.sales_confirmed || r.sales_placed,0)}</td><td>${fmtPct(r.sales_change_pct)}</td><td>${fmt(r.confirmed_order || r.placed_order,0)}</td><td>${fmtPct(r.order_change_pct)}</td><td>${fmt(r.visitors,0)}</td><td>${fmtRate(r.conversion_rate)}</td><td>${fmtPct(r.conversion_rate_change_pct)}</td><td>${esc(r.impact_reason || "")}</td><td>${esc(r.diagnostic_tags || r.risk_note || "")}</td></tr>`).join("")}</table>`;
}

function productTable(rows) {
  if (!rows.length) return `<p class="muted">No Product ID rows.</p>`;
  return `<table><tr><th>Country</th><th>Product ID</th><th>Ad Name</th><th>Action</th><th>Spend</th><th>ROAS</th><th>Direct ROAS</th><th>Clicks</th><th>Conv.</th><th>Reason</th><th>Tags</th></tr>${rows.map((r) => `<tr><td>${r.country}</td><td>${esc(r.product_id)}</td><td>${esc(short(r.ad_name,80))}</td><td>${esc(r.action||"")}</td><td>${fmt(r.expense,0)}</td><td>${fmt(r.roas,2)}</td><td>${fmt(r.direct_roas,2)}</td><td>${r.clicks}</td><td>${r.conversions}</td><td>${esc(r.reason||"")}${r.risk_note ? `<div class="bad">${esc(r.risk_note)}</div>` : ""}</td><td>${esc(r.diagnostic_tags||"")}</td></tr>`).join("")}</table>`;
}

function shopTable(rows) {
  if (!rows.length) return `<p class="muted">No Product ID = '-' shop-level rows.</p>`;
  return `<table><tr><th>Country</th><th>Ad Name</th><th>Section</th><th>Spend</th><th>GMV</th><th>ROAS</th><th>Direct ROAS</th><th>Clicks</th><th>Conv.</th></tr>${rows.slice(0,50).map((r) => `<tr><td>${r.country}</td><td>${esc(short(r.ad_name,80))}</td><td>${esc(r.ads_section)}</td><td>${fmt(r.expense,0)}</td><td>${fmt(r.gmv,0)}</td><td>${fmt(r.roas,2)}</td><td>${fmt(r.direct_roas,2)}</td><td>${r.clicks}</td><td>${r.conversions}</td></tr>`).join("")}</table>`;
}

function hourSvg(rows) {
  const w = 620, h = 240, pad = 34;
  const sorted = [...rows].sort((a, b) => num(a.hour) - num(b.hour));
  if (!sorted.length) return `<p class="muted">No hourly data for this country/date.</p>`;
  const maxSpend = Math.max(1, ...sorted.map((r) => num(r.expense)));
  const maxRoas = Math.max(1, ...sorted.map((r) => num(r.broad_roi)));
  const sx = (hour) => pad + (Number(hour) / 23) * (w - pad * 2);
  const sySpend = (v) => h - pad - (num(v) / maxSpend) * (h - pad * 2);
  const syRoas = (v) => h - pad - (num(v) / maxRoas) * (h - pad * 2);
  const spendPts = sorted.map((r) => `${sx(r.hour)},${sySpend(r.expense)}`).join(" ");
  const roasPts = sorted.map((r) => `${sx(r.hour)},${syRoas(r.broad_roi)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="240" role="img"><rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#cbd5e1"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#cbd5e1"/><polyline points="${spendPts}" fill="none" stroke="#2563eb" stroke-width="3"/><polyline points="${roasPts}" fill="none" stroke="#16a34a" stroke-width="3"/><text x="${pad}" y="20" fill="#2563eb">Spend</text><text x="110" y="20" fill="#16a34a">Broad ROAS</text><text x="${w-pad-30}" y="${h-10}" fill="#64748b">23h</text></svg>`;
}

function writeWorkbook(cfg, file, data) {
  const X = loadXlsx(cfg);
  const wb = X.utils.book_new();
  const summary = [
    ["Shopee Ads Product Impact Report", data.date],
    ["Ads Product Data Date", data.productDate || data.date],
    ["Product Performance Date", data.performanceDate || ""],
    ["Generated At", data.sourceStatus.generated_at],
    ["Hourly Updated At", data.sourceStatus.hourly_updated_at],
    ["Shopee Ads Detail Updated At", data.sourceStatus.ads_detail_updated_at],
    ["Product Performance Updated At", data.sourceStatus.product_performance_updated_at],
    ["Comparison Date", data.baseline.date || ""],
    ["Comparison Status", data.baseline.status || ""],
    ["Comparison Message", data.baseline.message || ""],
    [],
    ["Country", "Product Count", "Expense", "GMV", "ROAS", "Clicks", "Impression"],
    ...["ID", "MY", "TH"].map((c) => {
      const k = productKpi(c, data.products.filter((r) => r.country === c));
      return [c, k.count, k.expense, k.gmv, round(k.roas, 4), k.clicks, k.imp];
    }),
    [],
    ["Impact Action", "Count", "Spend"],
    ...impactSummaryRows(data.impactRows),
    [],
    ["Notes"],
    ...data.notes.map((n) => [n])
  ];
  addSheet(X, wb, "Summary", summary);
  addSheet(X, wb, "Hourly", [Object.keys(data.hourly[0] || { country:"", date:"", hour:"", expense:"", broad_roi:"" }), ...data.hourly.map((r) => Object.values(r))]);
  addSheet(X, wb, "Product Detail", [HEADERS.product, ...data.products.map((r) => HEADERS.product.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Recommendations", [HEADERS.rec, ...data.recommendations.map((r) => HEADERS.rec.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Shop Level", [HEADERS.shop, ...data.shopRows.map((r) => HEADERS.shop.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Product Performance", [HEADERS.performance, ...data.performanceRows.map((r) => HEADERS.performance.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Product Impact", [HEADERS.impact, ...data.impactRows.map((r) => HEADERS.impact.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Impact Recommendations", [HEADERS.impact, ...data.impactRows.filter((r) => r.impact_action !== "observe" && r.impact_action !== "baseline_today").map((r) => HEADERS.impact.map((h) => r[h] ?? ""))]);
  addSheet(X, wb, "Backup Manifest", [HEADERS.manifest, ...data.manifestRows.map((r) => HEADERS.manifest.map((h) => r[h] ?? ""))]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  X.writeFile(wb, file);
}

function addSheet(X, wb, name, rows) {
  const ws = X.utils.aoa_to_sheet(rows.length ? rows : [["No data"]]);
  ws["!cols"] = (rows[0] || []).map((_, i) => ({ wch: i < 2 ? 18 : 14 }));
  X.utils.book_append_sheet(wb, ws, name);
}

function loadXlsx(cfg) {
  const project = cfg.report.officialExportProject;
  const req = createRequire(path.join(project, "package.json"));
  return req("xlsx");
}

function runNode(script, args, cwd, timeout = 15 * 60 * 1000) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout, windowsHide: true });
  return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || (r.error ? r.error.message : "") };
}

function mkdirs(cfg) {
  fs.mkdirSync(cfg.report.outputDir, { recursive: true });
  fs.mkdirSync(cfg.report.logsDir, { recursive: true });
  fs.mkdirSync(cfg.report.backupDir, { recursive: true });
}

function countryFromSheet(sheetName, obj) {
  const raw = String(val(obj, ["Country", "country"]) || sheetName || "").toLowerCase();
  if (raw.includes("indonesia") || raw === "id") return "ID";
  if (raw.includes("malaysia") || raw === "my") return "MY";
  if (raw.includes("thailand") || raw === "th") return "TH";
  return String(sheetName || "").slice(0, 2).toUpperCase();
}


function valLoose(obj, names) {
  const keys = Object.keys(obj);
  const exact = new Map(keys.map((k) => [normHeader(k), k]));
  for (const n of names) {
    const wanted = normHeader(n);
    const key = exact.get(wanted);
    if (key != null) return obj[key];
  }
  for (const n of names) {
    const wanted = normHeader(n);
    const key = keys.find((k) => {
      const h = normHeader(k);
      return h === wanted || h.startsWith(wanted) || h.includes(wanted);
    });
    if (key != null) return obj[key];
  }
  return "";
}
function changePct(current, previous) {
  const c = num(current), p = num(previous);
  if (!p) return c ? 100 : 0;
  return round(((c - p) / Math.abs(p)) * 100, 2);
}
function impactRank(a) { return { "pause_diagnose": 0, "efficiency_squeeze": 1, "traffic_without_conversion": 2, "link_issue_first": 3, "positive_scale": 4, "effective_maintain": 5, "baseline_today": 6, "observe": 7 }[a] ?? 9; }
function impactSummaryRows(rows) {
  const byAction = group(rows, (r) => r.impact_action || "observe");
  return [...byAction.entries()].sort((a, b) => impactRank(a[0]) - impactRank(b[0])).map(([action, rs]) => [action, rs.length, sum(rs, "expense")]);
}
function fileMtime(file) { try { return file && fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : ""; } catch { return ""; } }
function formatTime(v) { if (!v) return "missing"; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }
function fmtPct(v) { return `${num(v) >= 0 ? "+" : ""}${fmt(v, 1)}%`; }
function fmtRate(v) { return `${fmt(num(v) * 100, 2)}%`; }
function localTimeParts(date, tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  return Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
}
function val(obj, names) {
  const map = new Map(Object.keys(obj).map((k) => [normHeader(k), k]));
  for (const n of names) {
    const key = map.get(normHeader(n));
    if (key != null) return obj[key];
  }
  return "";
}

function dataDate(obj) {
  const wanted = new Set([normHeader("\u6570\u636e\u65e5\u671f"), "datadate", "date"]);
  for (const k of Object.keys(obj)) if (wanted.has(normHeader(k))) return obj[k];
  return "";
}

function normHeader(v) { return String(v || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ""); }
function cleanId(v) { const s = String(v ?? "").trim(); return s ? s.replace(/\.0$/, "") : ""; }
function pick(obj, headers) { return Object.fromEntries(headers.map((h) => [h, obj[h] ?? ""])); }
function group(rows, fn) { const m = new Map(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
function sum(rows, key) { return rows.reduce((a, r) => a + num(r[key]), 0); }
function num(v) { if (v == null || v === "" || v === "-") return 0; const s = String(v).replace(/,/g, "").replace(/%$/, "").trim(); const n = Number(s); return Number.isFinite(n) ? n : 0; }
function rate(v) { if (v == null || v === "" || v === "-") return 0; const s = String(v).trim(); const n = num(s); return s.endsWith("%") ? n / 100 : (n > 1 ? n / 100 : n); }
function div(a, b) { const d = num(b); return d ? num(a) / d : 0; }
function round(v, d = 2) { return Number(num(v).toFixed(d)); }
function fmt(v, d = 2) { return num(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function trim(s) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, 1200); }
function short(s, n) { s = String(s || ""); return s.length > n ? `${s.slice(0, n - 1)}...` : s; }
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function actionRank(a) { return { "\u6682\u505c/\u8bca\u65ad": 0, "\u63a7\u8d39": 1, "\u653e\u91cf": 2, "\u7ef4\u6301": 3, "\u89c2\u5bdf": 4 }[a] ?? 9; }
function stampForFile(d) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(/[-: ]/g, ""); }
function localDate(date, tz) { const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const v = Object.fromEntries(p.filter((x) => x.type !== "literal").map((x) => [x.type, x.value])); return `${v.year}-${v.month}-${v.day}`; }
function normalizeDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return s;
}
function addDays(date, n) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const headers = rows.shift() || [];
  return rows.filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}
function writeCsv(file, headers, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n", "utf8"); }
function appendCsv(file, headers, row) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, (!fs.existsSync(file) ? headers.join(",") + "\r\n" : "") + headers.map((h) => csvCell(row[h])).join(",") + "\r\n", "utf8"); }
function csvCell(v) { if (v == null) return ""; const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsv(text) { const out = []; let row = [], cell = "", q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; } if (cell || row.length) { row.push(cell); out.push(row); } return out; }

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });

