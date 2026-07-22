#!/usr/bin/env node
if (process.env.SHOPEE_OFFICIAL_EXPORT_LEGACY !== "1") {
  await import("./shopee-export.mjs");
  process.exit(0);
}

import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SITE_HOSTS = {
  ID: ["seller.shopee.co.id"],
  MY: ["seller.shopee.com.my"],
  TH: ["seller.shopee.co.th"],
  VN: ["banhang.shopee.vn", "seller.shopee.vn"],
  PH: ["seller.shopee.ph"],
  SG: ["seller.shopee.sg"],
  TW: ["seller.shopee.tw"],
  BR: ["seller.shopee.com.br"],
  MX: ["seller.shopee.com.mx"]
};

const MODULE_HINTS = {
  "product-performance": ["/datacenter/product/performance", "product performance"],
  "product-ads": ["/pas/assembly/product", "product ads"],
  "shop-ads": ["/pas/assembly/shop", "shop ads"],
  traffic: ["/datacenter/traffic", "traffic"],
  audience: ["/datacenter/audience", "audience"]
};

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: userMessage(error) }, null, 2));
  process.exitCode = 1;
});

async function main() {
  const endpoint = required("endpoint");
  const site = (args.site || "ID").toUpperCase();
  const module = args.module || "product-performance";
  const output = path.resolve(args.output || process.cwd());
  const simulation = args.simulation === true || args["approve-export"] !== true;
  const startDate = required("start-date");
  const endDate = required("end-date");

  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  try {
    const pages = browser.contexts().flatMap((context, contextIndex) =>
      context.pages().map((page, pageIndex) => ({ page, contextIndex, pageIndex }))
    );
    const candidates = [];
    for (const entry of pages) {
      const title = await safeTitle(entry.page);
      const url = entry.page.url();
      const match = matchPage({ url, title, site, module });
      if (match.matched) candidates.push({ ...entry, title, url });
    }
    if (candidates.length === 0) throw new Error(`No matching Shopee page found for ${site} / ${module}.`);
    if (candidates.length > 1 && args["page-index"] === undefined) {
      throw new Error(`Multiple matching pages found. Rerun with --page-index. Candidates: ${candidates.map((item, index) => `${index}:${item.title}:${item.url}`).join(" | ")}`);
    }
    const selectedIndex = args["page-index"] === undefined ? 0 : Number(args["page-index"]);
    const selected = candidates[selectedIndex];
    if (!selected) throw new Error(`Invalid --page-index: ${args["page-index"]}.`);

    const preflight = await readPreflight(selected.page, { site, module, startDate, endDate });
    if (preflight.validationResult === "FAIL") {
      console.log(JSON.stringify({ success: false, simulation, preflight }, null, 2));
      return;
    }
    if (simulation) {
      console.log(JSON.stringify({ success: true, simulation: true, preflight, message: "Ready. Simulation stopped before clicking Export Data." }, null, 2));
      return;
    }

    await mkdir(output, { recursive: true });
    await clickExport(selected.page);
    const download = await waitAndDownload(selected.page);
    const suggested = sanitizeFilename(download.suggestedFilename());
    const savedPath = path.join(output, `${timestamp()}_${suggested}`);
    await download.saveAs(savedPath);
    const failure = await download.failure?.();
    if (failure) throw new Error(`Download failed: ${failure}`);
    const bytes = (await stat(savedPath)).size;
    const sha256 = createHash("sha256").update(await readFile(savedPath)).digest("hex");
    console.log(JSON.stringify({
      success: true,
      simulation: false,
      workbook: {
        path: savedPath,
        suggestedFilename: suggested,
        bytes,
        sha256
      },
      elapsedMs: Date.now() - startedAt
    }, null, 2));
  } finally {
    await disconnectCdpClient(browser);
  }
}

async function disconnectCdpClient(browser) {
  // Playwright uses browser.close() to close this CDP client connection for connected browsers.
  await browser.close();
}

async function readPreflight(page, input) {
  const state = await page.evaluate((parserText) => {
    const parseDateRange = (0, eval)(`(${parserText})`);
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const controlText = Array.from(document.querySelectorAll("input,[class*='date' i],[class*='range' i],[aria-label*='date' i],[placeholder*='date' i]"))
      .map((el) => [el.textContent, el.value, el.getAttribute("value"), el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("title")].filter(Boolean).join(" "))
      .join(" ");
    const interactive = Array.from(document.querySelectorAll("button,[role='button'],a"));
    const exportButton = interactive.find((el) => /export data|export|ekspor data|eksport data/i.test(el.textContent || ""));
    const range = parseDateRange(`${controlText} ${text}`);
    return {
      url: location.href,
      title: document.title,
      pageReady: document.readyState === "complete" && text.length > 80,
      exportButtonDetected: Boolean(exportButton),
      exportButtonEnabled: Boolean(exportButton && !exportButton.disabled && elVisible(exportButton)),
      detectedStartDate: range.detectedStartDate,
      detectedEndDate: range.detectedEndDate
    };
    function elVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }
  }, parseDateRangeFromText.toString());

  const dateMatched = state.detectedStartDate === input.startDate && state.detectedEndDate === input.endDate;
  const failures = [
    !matchPage({ url: state.url, title: state.title, site: input.site, module: input.module }).matched ? "Current page does not match requested site/module." : "",
    !state.pageReady ? "Page does not appear ready." : "",
    !state.exportButtonDetected ? "Export Data button was not detected." : "",
    !state.exportButtonEnabled ? "Export Data button is not enabled." : "",
    !state.detectedStartDate || !state.detectedEndDate ? "Page date range is not readable." : "",
    !dateMatched ? `Requested date ${input.startDate} to ${input.endDate} does not match page date ${state.detectedStartDate || "?"} to ${state.detectedEndDate || "?"}.` : ""
  ].filter(Boolean);
  return {
    ...state,
    requestedStartDate: input.startDate,
    requestedEndDate: input.endDate,
    latestReportsStatus: "POST_EXPORT_ONLY",
    validationResult: failures.length ? "FAIL" : "PASS",
    failureReason: failures.join(" ")
  };
}

async function clickExport(page) {
  const clicked = await page.evaluate(() => {
    const labels = /export data|export|ekspor data|eksport data/i;
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a"));
    const target = candidates.find((el) => labels.test(el.textContent || ""));
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) throw new Error("Export Data button was not found at click time.");
}

async function waitAndDownload(page) {
  await openLatestReports(page);
  const deadline = Date.now() + Number(args.timeoutMs || 180000);
  while (Date.now() < deadline) {
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button,[role='button'],a"));
      const target = candidates.find((el) => /download|unduh/i.test(el.textContent || ""));
      if (!target) return false;
      target.click();
      return true;
    });
    if (clicked) {
      const download = await downloadPromise;
      if (download) return download;
    }
    await page.waitForTimeout(3000);
    await openLatestReports(page);
  }
  throw new Error("Timed out waiting for a ready report download.");
}

async function openLatestReports(page) {
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a"));
    const target = candidates.find((el) => /latest reports|laporan terbaru|report terbaru/i.test(el.textContent || ""));
    if (target) target.click();
  });
}

function matchPage({ url, title, site, module }) {
  let parsed;
  try { parsed = new URL(url); } catch { return { matched: false }; }
  const hostOk = (SITE_HOSTS[site] || []).includes(parsed.hostname);
  const hints = MODULE_HINTS[module] || [];
  const haystack = `${parsed.pathname.toLowerCase()} ${title.toLowerCase()}`;
  return { matched: hostOk && hints.some((hint) => haystack.includes(hint.toLowerCase())) };
}

function parseDateRangeFromText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const dates = [];
  const push = (date) => { if (date && !dates.includes(date)) dates.push(date); };
  for (const match of text.matchAll(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])\b/g)) push(toIsoDate(+match[1], +match[2], +match[3]));
  for (const match of text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})\b/g)) push(toIsoDate(+match[3], +match[2], +match[1]));
  const months = { jan:1,january:1,januari:1,feb:2,february:2,februari:2,mar:3,march:3,maret:3,apr:4,april:4,may:5,mei:5,jun:6,june:6,juni:6,jul:7,july:7,juli:7,aug:8,august:8,agu:8,agustus:8,sep:9,sept:9,september:9,oct:10,october:10,okt:10,oktober:10,nov:11,november:11,dec:12,december:12,des:12,desember:12 };
  const names = Object.keys(months).sort((a,b)=>b.length-a.length).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s+(${names})\\s*,?\\s*(20\\d{2})\\b`, "gi"))) push(toIsoDate(+match[3], months[match[2].toLowerCase()], +match[1]));
  for (const match of text.matchAll(new RegExp(`\\b(${names})\\s+(0?[1-9]|[12]\\d|3[01]),?\\s*(20\\d{2})\\b`, "gi"))) push(toIsoDate(+match[3], months[match[1].toLowerCase()], +match[2]));
  return { detectedStartDate: dates[0], detectedEndDate: dates[1] || dates[0] };
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function safeTitle(page) {
  try { return await page.title(); } catch { return ""; }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function required(name) {
  if (!args[name]) throw new Error(`Missing --${name}.`);
  return String(args[name]);
}

function sanitizeFilename(value) {
  return String(value || "shopee-official-export.xlsx").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function userMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
