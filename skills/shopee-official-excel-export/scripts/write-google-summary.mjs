#!/usr/bin/env node
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const args = parseArgs(process.argv.slice(2));
const spreadsheetId = process.env.SHOPEE_GOOGLE_SHEET_ID || args.spreadsheet || "1bLwa2kh5K__Jo52SP5Ju7Bu80YQviM6MRB6Kzm8N1Y8";
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || args.credentials || "E:/AI项目汇总/全站数据分析/credentials/advance-rush-406115-7f33ce3cdf8b.json";
const outputRoot = process.env.SHOPEE_EXPORT_ROOT || args.root || "D:/Shopee Export";
const dryRun = Boolean(args["dry-run"]);
const requestTimeoutMs = Number(process.env.SHOPEE_GOOGLE_TIMEOUT_MS || args.timeoutMs || args.timeout || 30000);
const skipExisting = Boolean(args["skip-existing"]);
const requestedRange = parseRange(args.range || args.date);

if (!requestedRange) {
  console.log("Usage: node scripts/write-google-summary.mjs --date=YYYY/MM/DD | --range=YYYY/MM/DD~YYYY/MM/DD [--modules=product performance,voucher,shopee ads] [--dry-run]");
  process.exit(2);
}

const countries = [
  {
    name: "Indonesia",
    code: "ID",
    cn: "印尼",
    adsSheet: "印尼每日广告",
    productSheet: "印尼byday链接-新版",
    voucherSheet: "印尼优惠券数据",
    linkInfo: "ID BB链接信息",
    adsLookup1: "B:F",
    adsLookup2: "B:G",
    productLookup: "B:T",
    voucherRate: "/2416",
    productFormula: "ID"
  },
  {
    name: "Malaysia",
    code: "MY",
    cn: "马来",
    adsSheet: "马来每日广告",
    productSheet: "马来byday链接-新版",
    voucherSheet: "马来优惠券数据",
    linkInfo: "MY BB链接信息",
    adsLookup1: "B:L",
    adsLookup2: "B:L",
    productLookup: "B:O",
    voucherRate: "*1.7",
    productFormula: "MY"
  },
  {
    name: "Thailand",
    code: "TH",
    cn: "泰国",
    adsSheet: "泰国每日广告",
    productSheet: "泰国byday链接-新版",
    voucherSheet: "泰国优惠券数据",
    linkInfo: "TH BB链接信息",
    adsLookup1: "B:H",
    adsLookup2: "B:H",
    productLookup: "B:M",
    voucherRate: "/4.85",
    productFormula: "TH"
  }
];

const productHeaders = [
  "Item ID",
  "Product",
  "Current Item Status",
  "Variation ID",
  "Variation Name",
  "Current Variation Status",
  "SKU",
  "Parent SKU",
  "Sales (Placed Order)",
  "Sales (Confirmed Order)",
  "Product Impression",
  "Product Clicks",
  "CTR",
  "Order Conversion Rate (Placed Order)",
  "Order Conversion Rate (Confirmed Order)",
  "Placed Order",
  "Confirmed Order",
  "Units (Placed Order)",
  "Units (Confirmed Order)",
  "Buyers (Placed Order)",
  "Buyers (Confirmed Order)",
  "Conversion Rate (Placed Order)",
  "Conversion Rate (Confirmed Order)",
  "Sales per Order (Placed Order)",
  "Sales per Order (Confirmed Order)",
  "Unique Product Impressions",
  "Unique Product Clicks",
  "Product Visitors (Visit)",
  "Product Page Views",
  "Product Bounce Visitors",
  "Product Bounce Rate",
  "Search Clicks",
  "Likes",
  "Product Visitors (Add to Cart)",
  "Units (Add to Cart)",
  "Conversion Rate (Add to Cart)"
];

const adsHeaders = [
  "Sequence",
  "Ad Name",
  "Status",
  "Ads Type",
  "Product ID",
  "Creative",
  "Bidding Method",
  "Placement",
  "Start Date",
  "End Date",
  "Impression",
  "Clicks",
  "CTR",
  "Add to Cart",
  "Add to Cart Rate",
  "Conversions",
  "Direct Conversions",
  "Conversion Rate",
  "Direct Conversion Rate",
  "Cost per Conversion",
  "Cost per Direct Conversion",
  "Items Sold",
  "Direct Items Sold",
  "GMV",
  "Direct GMV",
  "Expense",
  "ROAS",
  "Direct ROAS",
  "ACOS",
  "Direct ACOS",
  "Product Impressions",
  "Product Clicks",
  "Product CTR",
  "Voucher Amount",
  "Vouchered Sales"
];

const voucherHeaders = [
  "Voucher Name",
  "Voucher Code",
  "Claim Period",
  "Status",
  "Creator",
  "Voucher Type",
  "Reward Type",
  "Claims",
  "Orders (Placed Order)",
  "Orders (Confirmed Order)",
  "Usage Rate (Placed Order)",
  "Usage Rate (Confirmed Order)",
  "Sales (Placed Order)",
  "Sales (Confirmed Order)",
  "Cost (Placed Order)",
  "Cost (Confirmed Order)",
  "Units Sold (Placed Order)",
  "Units Sold (Confirmed Order)",
  "Buyers (Placed Order)",
  "Buyers (Confirmed Order)",
  "Sales Per Buyer (Placed Order)",
  "Sales Per Buyer (Confirmed Order)",
  "Pop-up Viewers",
  "Claim Rate",
  "New Followers",
  "Follower Contribution"
];

const modules = [
  {
    key: "ads",
    name: "shopee ads",
    display: "Shopee Ads",
    dir: "Shopee Ads",
    fileToken: "shopee ads",
    fileArg: "ads-file",
    sheetFor: (country) => country.adsSheet,
    dateCol: 2,
    buildRows: buildAdsRows
  },
  {
    key: "product",
    name: "product performance",
    display: "Product Performance",
    dir: "Product Performance",
    fileToken: "product performance",
    fileArg: "product-file",
    sheetFor: (country) => country.productSheet,
    dateCol: 5,
    buildRows: buildProductRows
  },
  {
    key: "voucher",
    name: "voucher",
    display: "Voucher",
    dir: "Voucher",
    fileToken: "voucher",
    fileArg: "voucher-file",
    sheetFor: (country) => country.voucherSheet,
    dateCol: 6,
    buildRows: buildVoucherRows
  }
];

const selectedModules = selectModules(args.modules || args.module);
const selectedCountries = selectCountries(args.countries || args.country);

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function selectModules(value) {
  if (!value) return modules;
  const requested = splitList(value).map(moduleKey).filter(Boolean);
  return modules.filter((item) => requested.includes(item.key));
}

function selectCountries(value) {
  if (!value) return countries;
  const requested = splitList(value).map((item) => normalize(item));
  return countries.filter((country) => requested.includes(normalize(country.code)) || requested.includes(normalize(country.name)) || requested.includes(normalize(country.cn)));
}

function splitList(value) {
  return String(value || "").split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean);
}

function moduleKey(value) {
  const key = normalize(value);
  if (["ads", "shopee ads", "shoppe ads", "cpc ads", "all cpc ads"].includes(key)) return "ads";
  if (["product", "product performance", "byday", "byday link"].includes(key)) return "product";
  if (["voucher", "vouchers", "marketing voucher"].includes(key)) return "voucher";
  return "";
}

function parseRange(value) {
  if (!value) return null;
  const parts = String(value).split(/~|至|到/).map((item) => item.trim()).filter(Boolean);
  const start = normalizeDate(parts[0]);
  const end = normalizeDate(parts[1] || parts[0]);
  if (!start || !end) return null;
  if (start > end) throw new Error(`Bad date range: ${value}`);
  return { start, end };
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  let m = raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) return `${m[1]}/${String(Number(m[2])).padStart(2, "0")}/${String(Number(m[3])).padStart(2, "0")}`;
  m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}/${String(Number(m[1])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}`;
  }
  if (/^\d+(\.\d+)?$/.test(raw)) return dateFromExcelSerial(Number(raw));
  return null;
}

function dateFromExcelSerial(value) {
  if (!Number.isFinite(value) || value < 20000) return null;
  const date = new Date(Math.round((value - 25569) * 86400000));
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function excelSerial(date) {
  const [y, m, d] = date.split("/").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000 + 25569);
}

function compactDateSlug(date) {
  return date.slice(2).replaceAll("/", "");
}

function rangeSlug(range) {
  return `${compactDateSlug(range.start)}-${compactDateSlug(range.end)}`;
}

function dateInRange(date, range) {
  return date >= range.start && date <= range.end;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[()（）]/g, "").replace(/\s+/g, " ");
}

function get(obj, aliases) {
  const keys = Object.keys(obj);
  for (const alias of aliases) {
    const key = keys.find((candidate) => normalize(candidate) === normalize(alias));
    if (key) return obj[key];
  }
  return "";
}

function sourceDate(obj) {
  return normalizeDate(get(obj, ["数据日期", "鏁版嵁鏃ユ湡", "Data Date", "Date", "日期"])) || requestedRange.start;
}

function b64(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function proxy(parsed) {
  const raw = args.proxy || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || "http://127.0.0.1:7890";
  return raw && parsed.protocol === "https:" ? new URL(raw.includes("://") ? raw : `http://${raw}`) : null;
}

function tunnel(parsed, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: p.hostname,
      port: p.port || 80,
      method: "CONNECT",
      path: `${parsed.hostname}:${parsed.port || 443}`
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`Proxy CONNECT ${res.statusCode}`));
      const secureSocket = tls.connect({ socket, servername: parsed.hostname });
      secureSocket.on("secureConnect", () => resolve(secureSocket));
      secureSocket.on("error", reject);
    });
    req.setTimeout(requestTimeoutMs, () => req.destroy(new Error(`Proxy CONNECT timeout after ${requestTimeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

function request(method, href, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(href);
    const p = proxy(parsed);
    const start = (socket) => {
      const opts = p
        ? { protocol: "https:", hostname: parsed.hostname, port: parsed.port || 443, method, path: parsed.pathname + parsed.search, headers, socket, createConnection: () => socket }
        : { method, headers };
      const req = p ? https.request(opts, done) : https.request(href, opts, done);
      function done(res) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 1000)}`));
        });
      }
      req.setTimeout(requestTimeoutMs, () => req.destroy(new Error(`HTTP request timeout after ${requestTimeoutMs}ms: ${method} ${href}`)));
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    };
    p ? tunnel(parsed, p).then(start, reject) : start();
  });
}

async function token() {
  const credential = JSON.parse(await fs.readFile(credentialPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: credential.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(JSON.stringify(claim))}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credential.private_key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${b64(sig)}`
  }).toString();
  const response = await request("POST", "https://oauth2.googleapis.com/token", {
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) },
    body
  });
  return response.access_token;
}

function quote(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function apiGet(pathPart, access) {
  return request("GET", `https://sheets.googleapis.com/v4/spreadsheets/${pathPart}`, {
    headers: { authorization: `Bearer ${access}` }
  });
}

async function apiPut(pathPart, access, body) {
  return request("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${pathPart}`, {
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function apiPost(pathPart, access, body) {
  return request("POST", `https://sheets.googleapis.com/v4/spreadsheets/${pathPart}`, {
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function values(access, title, endCol = "AZ", valueRenderOption = "FORMULA") {
  const range = `${quote(title)}!A1:${endCol}`;
  const data = await apiGet(`${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=${valueRenderOption}`, access);
  return data.values || [];
}

async function meta(access) {
  const fields = encodeURIComponent("sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))");
  const data = await apiGet(`${spreadsheetId}?fields=${fields}`, access);
  return new Map((data.sheets || []).map((sheet) => [sheet.properties.title, sheet.properties]));
}

async function sheetProps(access, title) {
  const props = (await meta(access)).get(title);
  if (!props) throw new Error(`Sheet not found: ${title}`);
  return props;
}

function col(n) {
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function lastRow(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i] || []).some((value) => String(value || "").trim())) return i + 1;
  }
  return 1;
}

function matchingDateRows(rows, dateCol1, date) {
  const serial = String(excelSerial(date));
  const positions = [];
  rows.slice(1).forEach((row, index) => {
    const value = String(row[dateCol1 - 1] || "").trim();
    if (value === serial || normalizeDate(value) === date) positions.push(index + 2);
  });
  return positions;
}

async function ensureRows(access, title, neededRows) {
  const props = await sheetProps(access, title);
  const current = props.gridProperties?.rowCount || 0;
  if (current >= neededRows || dryRun) return;
  await apiPost(`${spreadsheetId}:batchUpdate`, access, {
    requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "ROWS", length: neededRows - current } }]
  });
}

async function copyFormat(access, title, templateRow, startRow, endRow) {
  if (dryRun || endRow < startRow || templateRow < 1) return;
  const props = await sheetProps(access, title);
  await apiPost(`${spreadsheetId}:batchUpdate`, access, {
    requests: [
      {
        copyPaste: {
          source: {
            sheetId: props.sheetId,
            startRowIndex: templateRow - 1,
            endRowIndex: templateRow,
            startColumnIndex: 0,
            endColumnIndex: props.gridProperties?.columnCount || 60
          },
          destination: {
            sheetId: props.sheetId,
            startRowIndex: startRow - 1,
            endRowIndex: endRow,
            startColumnIndex: 0,
            endColumnIndex: props.gridProperties?.columnCount || 60
          },
          pasteType: "PASTE_FORMAT"
        }
      }
    ]
  });
}

async function insertBlankRows(access, title, startRow, count) {
  if (dryRun || count <= 0) return;
  const props = await sheetProps(access, title);
  await apiPost(`${spreadsheetId}:batchUpdate`, access, {
    requests: [
      {
        insertDimension: {
          range: {
            sheetId: props.sheetId,
            dimension: "ROWS",
            startIndex: startRow - 1,
            endIndex: startRow - 1 + count
          },
          inheritFromBefore: startRow > 1
        }
      }
    ]
  });
}

async function deleteRows(access, title, rows) {
  if (dryRun || !rows.length) return;
  const props = await sheetProps(access, title);
  const requests = [...rows].sort((a, b) => b - a).map((row) => ({
    deleteDimension: {
      range: {
        sheetId: props.sheetId,
        dimension: "ROWS",
        startIndex: row - 1,
        endIndex: row
      }
    }
  }));
  await apiPost(`${spreadsheetId}:batchUpdate`, access, { requests });
}

async function putRows(access, title, rows, startRow) {
  if (dryRun || !rows.length) return;
  const endRow = startRow + rows.length - 1;
  const range = `${quote(title)}!A${startRow}:${col(rows[0].length)}${endRow}`;
  await apiPut(`${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, access, {
    range,
    majorDimension: "ROWS",
    values: rows
  });
}

async function upsertDateBlock(access, title, dateCol, date, sourceRows, buildRows) {
  const existing = await values(access, title);
  return await upsertDateBlockWithExisting(access, title, existing, dateCol, date, sourceRows, buildRows);
}

async function upsertDateBlockWithExisting(access, title, existing, dateCol, date, sourceRows, buildRows) {
  if (!sourceRows.length) return { title, date, rows: 0, skipped: "no source rows" };
  const existingDateRows = matchingDateRows(existing, dateCol, date);
  if (skipExisting && existingDateRows.length) return { title, date, rows: 0, skipped: "date exists" };

  const startRow = existingDateRows.length ? Math.min(...existingDateRows) : lastRow(existing) + 1;
  const rows = buildRows(sourceRows, startRow, date);
  if (!rows.length) return { title, date, rows: 0, skipped: "no output rows" };
  const endRow = startRow + rows.length - 1;
  const contiguousExisting = existingDateRows.every((row, index) => index === 0 || row === existingDateRows[index - 1] + 1);
  let mode = existingDateRows.length ? "replace" : "append";

  if (existingDateRows.length && existingDateRows.length === rows.length && contiguousExisting) {
    mode = "update";
  } else if (existingDateRows.length) {
    await deleteRows(access, title, existingDateRows);
    await insertBlankRows(access, title, startRow, rows.length);
  } else {
    await ensureRows(access, title, endRow);
  }

  const templateRow = startRow > 2 ? startRow - 1 : startRow + rows.length;
  await copyFormat(access, title, templateRow, startRow, endRow);
  await putRows(access, title, rows, startRow);

  return { title, date, startRow, endRow, rows: rows.length, cols: rows[0].length, mode, replacedRows: existingDateRows.length };
}

function readObjects(file, sheet) {
  const wb = XLSX.readFile(file, { raw: false });
  const sheetName = wb.SheetNames.find((name) => normalize(name) === normalize(sheet));
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false
  });
  if (!rows.length) return [];
  const header = rows[0].map((value) => String(value || "").trim());
  return rows.slice(1).filter((row) => row.some((value) => String(value || "").trim())).map((row) => {
    const obj = {};
    header.forEach((h, index) => {
      obj[h] = row[index] ?? "";
    });
    return obj;
  });
}

async function locateCombinedFile(spec) {
  const explicit = args[spec.fileArg];
  if (explicit) return existsSync(explicit) ? explicit : null;
  const dir = path.join(outputRoot, "Combined", spec.dir);
  if (!existsSync(dir)) return null;
  const suffix = `_${spec.fileToken}_${rangeSlug(requestedRange)}.xlsx`.toLowerCase();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith("~$")) continue;
    if (!entry.name.toLowerCase().endsWith(suffix)) continue;
    const fullPath = path.join(dir, entry.name);
    matches.push({ path: fullPath, mtimeMs: (await fs.stat(fullPath)).mtimeMs });
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.path || null;
}

function groupByDate(rows) {
  const out = new Map();
  for (const row of rows) {
    const date = sourceDate(row);
    if (!dateInRange(date, requestedRange)) continue;
    if (!out.has(date)) out.set(date, []);
    out.get(date).push(row);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function dedupeRows(rows, keys) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keys.map((item) => get(row, [item])).join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function productFormulaA(country, row) {
  return country.productFormula === "ID"
    ? `=IFERROR(VLOOKUP(G${row},'${country.linkInfo}'!${country.productLookup},5,0), "已下架")`
    : `=iferror(VLOOKUP(G${row},'${country.linkInfo}'!${country.productLookup},5,0),"已下架")`;
}

function productFormulaB(country, row) {
  return country.productFormula === "ID"
    ? `=IFERROR(VLOOKUP(G${row}, '${country.linkInfo}'!${country.productLookup}, 4, FALSE), "已下架")`
    : `=iferror(VLOOKUP(G${row},'${country.linkInfo}'!${country.productLookup},4,0),"已下架")`;
}

function buildAdsRows(rows, start, country, date) {
  const filtered = dedupeRows(rows, ["Ads Section", "Sequence", "Ad Name", "Ads Type", "Product ID"]);
  return filtered.map((obj, index) => {
    const row = start + index;
    return [
      `=TEXT(B${row}, "Y年M月")`,
      excelSerial(date),
      `=VLOOKUP(I${row},'${country.linkInfo}'!${country.adsLookup1},${country.name === "Thailand" ? 4 : 5},0)`,
      `=VLOOKUP(I${row},'${country.linkInfo}'!${country.adsLookup2},${country.name === "Thailand" ? 5 : 4},0)`,
      ...adsHeaders.map((header) => get(obj, [header]))
    ];
  });
}

function buildProductRows(rows, start, country, date) {
  return rows.map((obj, index) => {
    const row = start + index;
    return [
      productFormulaA(country, row),
      productFormulaB(country, row),
      country.name === "Indonesia" ? `=P${row}/2580` : country.name === "Malaysia" ? `=P${row}*1.7` : "",
      country.cn,
      excelSerial(date),
      `=TEXT(E${row},"m""月""")`,
      ...productHeaders.map((header) => get(obj, [header, `${header} (IDR)`, `${header} (MYR)`, `${header} (THB)`]))
    ];
  });
}

function buildVoucherRows(rows, start, country, date) {
  return rows.map((obj, index) => {
    const row = start + index;
    const ratio = country.name === "Thailand"
      ? `=IF(ISNUMBER(SEARCH("Ads Smart Voucher", G${row})), 0%, 100%)`
      : country.name === "Indonesia"
      ? `=IF(ISNUMBER(SEARCH("35%", G${row})), 35%,\n IF(ISNUMBER(SEARCH("Ads Smart Voucher", G${row})), 0%,\n 100%))`
      : `=IF(ISNUMBER(SEARCH("Ads Smart Voucher", G${row})), 0%, IF(AND(ISNUMBER(SEARCH("cofund", G${row})), ISNUMBER(SEARCH("33%", G${row}))), 33%, IF(OR(ISNUMBER(SEARCH("cofund", G${row})), ISNUMBER(SEARCH("MS", G${row}))), 50%, 100%)))`;
    return [
      `=B${row}*V${row}${country.voucherRate}`,
      ratio,
      `=1-B${row}`,
      `=C${row}*V${row}${country.voucherRate}`,
      `=MONTH(F${row})`,
      excelSerial(date),
      ...voucherHeaders.map((header) => get(obj, [header, `${header} (IDR)`, `${header} (MYR)`, `${header} (THB)`, header.replace(/\)$/, ""), `${header})`]))
    ];
  });
}

async function main() {
  const summary = [];
  const files = {};
  if (!selectedModules.length) {
    console.log(JSON.stringify({
      dryRun,
      skipExisting,
      range: requestedRange,
      spreadsheetId,
      files,
      summary,
      skipped: "no supported modules selected"
    }, null, 2));
    return;
  }

  const access = await token();

  for (const spec of selectedModules) {
    const file = await locateCombinedFile(spec);
    files[spec.key] = file || null;
    if (!file) {
      summary.push({ module: spec.display, rows: 0, skipped: "combined file not found" });
      continue;
    }

    for (const country of selectedCountries) {
      const sourceRows = readObjects(file, country.name);
      if (!sourceRows.length) {
        summary.push({ module: spec.display, country: country.name, rows: 0, skipped: "country sheet not found or empty" });
        continue;
      }

      const title = spec.sheetFor(country);
      for (const [date, rowsForDate] of groupByDate(sourceRows)) {
        summary.push(await upsertDateBlock(access, title, spec.dateCol, date, rowsForDate, (rows, startRow, rowDate) => spec.buildRows(rows, startRow, country, rowDate)));
      }
    }
  }

  console.log(JSON.stringify({
    dryRun,
    skipExisting,
    range: requestedRange,
    spreadsheetId,
    files,
    summary
  }, null, 2));
}
