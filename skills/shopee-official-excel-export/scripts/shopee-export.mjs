#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyProjectDir = "D:\\AI project\\shopee-AI";
const defaultConfigPath = path.join(skillDir, "config", "default.config.json");
const userConfigPath = path.join(os.homedir(), ".codex", "shopee-official-excel-export.config.json");
const startedAt = Date.now();
const skillVersion = "0.4.7";
const skillBuildTime = "2026-07-14 11:35";
const entryFile = path.relative(skillDir, fileURLToPath(import.meta.url)).replaceAll(path.sep, "/");

printStartupBanner();
main().catch((error) => {
  console.error(friendlyError(error));
  process.exitCode = 1;
});

function printStartupBanner() {
  const debugDateMode = process.argv.includes("--debug-date");
  const debugCalendarMode = process.argv.includes("--debug-calendar");
  const debugFunctionLoaded = typeof runDebugDateMode === "function" && typeof printDateDebugProbe === "function" && typeof runDebugCalendarMode === "function";
  console.log("Shopee Official Export Skill");
  console.log(`Version: ${skillVersion}`);
  console.log(`Build: ${skillBuildTime}`);
  console.log(`Entry: ${entryFile}`);
  console.log(`Debug Mode: ${debugDateMode ? "TRUE" : "FALSE"}`);
  console.log(`Calendar Debug Mode: ${debugCalendarMode ? "TRUE" : "FALSE"}`);
  console.log(`Debug Function Loaded: ${debugFunctionLoaded ? "TRUE" : "FALSE"}`);
  console.log("");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const debugDateMode = process.argv.includes("--debug-date");
  const debugCalendarMode = process.argv.includes("--debug-calendar");
  const approvedRealExport = process.argv.includes("--approved-real-export");
  const config = await loadConfig();
  await runStartupSelfCheck(config);
  const pipedInput = await readPipedInputLines();
  const rl = pipedInput
    ? { __inputQueue: pipedInput, close: () => {} }
    : readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const input = await readCommandInput(rl);
    const request = await buildRequest(input, config, rl);
    const activeProfiles = await getActiveProfiles(config);
    await ensureProfileMappings(activeProfiles, config, rl);
    if (request.countries.length === 0) {
      request.countries = await detectCountriesFromOpenPages(activeProfiles, request.modules, config);
      if (request.countries.length === 0) {
        throw new UserFacingError("未找到已打开的目标 Shopee 页面。请先打开对应国家和模块页面后重试，或修改需求内容。");
      }
    }

    console.log("");
    console.log("已识别:");
    console.log("");
    console.log(`站点: ${request.countries.map((country) => country.name).join(", ")}`);
    console.log(`模块: ${request.modules.map((module) => module.name).join(", ")}`);
    console.log(`日期: ${formatDateRange(request.dateRange)}`);
    console.log("");

    const tasks = createTasks(request, activeProfiles, config);

    if (tasks.length === 0) {
      throw new UserFacingError("没有可执行任务。请确认 AdsPower Profile 已打开，并且 Profile Mapping 已配置。");
    }

    if (debugDateMode) {
      await runDebugDateMode(tasks, config, rl);
      return;
    }
    if (debugCalendarMode) {
      await runDebugCalendarMode(tasks, config, rl);
      return;
    }

    const approval = approvedRealExport ? "Y" : await ask(rl, "是否开始官方导出？ (Y/N) ");
    const realExport = /^y(es)?$/i.test(approval.trim());
    if (!realExport) {
      console.log("Simulation Mode: 只执行检测，不点击 Export，不下载文件。");
    }

    const results = await runTaskBatch(tasks, config, realExport, rl);

    const combinedWorkbooks = realExport ? await combineCompletedDailyWorkbooks(results, config) : [];
    const googleSummaryWrites = realExport ? await writeGoogleSummaryAfterExport(results, config) : [];
    printSummary(results, combinedWorkbooks, googleSummaryWrites);
  } finally {
    rl.close();
  }
}

async function readCommandInput(rl) {
  const inline = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).join(" ").trim();
  return inline;
}

async function readPipedInputLines() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.split(/\r?\n/);
}

async function buildRequest(input, config, rl) {
  const text = normalizeText(input);
  if (!text) return await buildGuidedRequest(config, rl);
  const countries = findCountries(text, config);
  let modules = findModules(text, config);
  let dateRange = parseRequestedDate(text, config);

  if (isAllModules(text)) {
    modules = config.modules;
  }

  if (modules.length === 0) {
    modules.push(await chooseOne(rl, "璇烽€夋嫨瀵煎嚭妯″潡:", config.modules));
  }

  modules = uniqueByName(modules);
  if (!dateRange && modulesUseDefaultLast30(modules)) {
    dateRange = dateShortcut("last30");
  }
  if (!dateRange) {
    dateRange = await chooseDateRange(rl, config);
  }

  return { countries, modules, dateRange };
}

async function buildGuidedRequest(config, rl) {
  console.log("");
  console.log("步骤 1/3：选择国家");
  const countries = await chooseMany(rl, "可选国家：", config.countries);

  console.log("");
  console.log("步骤 2/3：选择数据板块");
  const modules = await chooseMany(rl, "可选板块：", config.modules);

  const uniqueModules = uniqueByName(modules);
  const dateRange = modulesUseDefaultLast30(uniqueModules)
    ? dateShortcut("last30")
    : await chooseGuidedDateRange(rl, config);

  return { countries: uniqueByName(countries), modules: uniqueModules, dateRange };
}

async function chooseGuidedDateRange(rl, config) {
  console.log("");
  console.log("步骤 3/3：选择时间段");
  return await chooseDateRange(rl, config);
}

function modulesUseDefaultLast30(modules) {
  return Array.isArray(modules)
    && modules.length > 0
    && modules.every((module) => String(module?.taskRangeMode || "").toLowerCase() === "last30");
}

async function chooseDateRange(rl, config) {
  const choices = [
    { name: "浠婂ぉ", key: "today" },
    { name: "鏄ㄥぉ", key: "yesterday" },
    { name: "鏈€杩?7 澶?", key: "last7" },
    { name: "鏈€杩?30 澶?", key: "last30" },
    { name: "鑷畾涔夋椂闂存", key: "custom" }
  ];
  const choice = await chooseOne(rl, "鍙€夋椂闂存锛?", choices);
  if (choice.key !== "custom") return dateShortcut(choice.key);
  while (true) {
    const value = await ask(rl, "璇疯緭鍏ユ椂闂存锛屾牸寮?YYYY/MM/DD~YYYY/MM/DD锛?");
    const parsed = parseRequestedDate(value, config);
    if (parsed) return parsed;
    console.log("鏃堕棿鏍煎紡鏃犳硶璇嗗埆锛岃閲嶆柊杈撳叆锛屼緥濡?2026/07/01~2026/07/13銆?");
  }
}

async function chooseOne(rl, title, items) {
  console.log(title);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${item.name}`));
  while (true) {
    const value = await ask(rl, "璇疯緭鍏ョ紪鍙凤細");
    const index = Number(value.trim()) - 1;
    if (items[index]) return items[index];
    console.log("缂栧彿鏃犳晥锛岃閲嶆柊閫夋嫨銆?");
  }
}

async function chooseMany(rl, title, items) {
  console.log(title);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${item.name}`));
  console.log("鍙緭鍏ュ涓紪鍙凤紝渚嬪 1,2锛涚洿鎺ュ洖杞﹁〃绀哄叏閫夈€?");
  while (true) {
    const value = await ask(rl, "璇疯緭鍏ョ紪鍙凤細");
    if (!value.trim()) return items;
    const indexes = value.split(/[,锛孿s]+/).filter(Boolean).map((part) => Number(part) - 1);
    const uniqueIndexes = Array.from(new Set(indexes));
    if (uniqueIndexes.length && uniqueIndexes.every((index) => items[index])) {
      return uniqueIndexes.map((index) => items[index]);
    }
    console.log("缂栧彿鏃犳晥锛岃閲嶆柊閫夋嫨銆?");
  }
}

async function ensureProfileMappings(activeProfiles, config, rl) {
  for (const profile of activeProfiles) {
    if (config.profiles[profile.userId]) continue;
    console.log("");
    console.log(`妫€娴嬪埌鏈煡 AdsPower Profile: ${profile.userId}`);
    const country = await chooseOne(rl, "璇烽€夋嫨瀵瑰簲鍥藉:", config.countries);
    config.profiles[profile.userId] = country.name;
    const save = await ask(rl, "鏄惁淇濆瓨涓烘柊鐨勯粯璁ゆ槧灏? (Y/N) ");
    if (/^y(es)?$/i.test(save.trim())) {
      await saveUserProfileMapping(config);
      console.log(`宸蹭繚瀛樻槧灏? ${profile.userId} -> ${country.name}`);
    }
  }
}

function createTasks(request, activeProfiles, config) {
  const mappedCountries = activeProfiles
    .map((profile) => findCountryByName(config.profiles[profile.userId], config))
    .filter(Boolean);
  const countries = request.countries.length ? request.countries : uniqueByName(mappedCountries);
  const tasks = [];
  for (const country of countries) {
    const profile = activeProfiles.find((item) => config.profiles[item.userId] === country.name);
    if (!profile) {
      for (const module of request.modules) {
        for (const moduleVariant of expandModuleForCountry(module, country)) {
          for (const dateRange of taskDateRangesForModule(moduleVariant, request.dateRange)) {
            tasks.push({ country, module: moduleVariant, dateRange, requestedDateRange: request.dateRange, missingProfile: true });
          }
        }
      }
      continue;
    }
    for (const module of request.modules) {
      for (const moduleVariant of expandModuleForCountry(module, country)) {
        for (const dateRange of taskDateRangesForModule(moduleVariant, request.dateRange)) {
          tasks.push({ country, module: moduleVariant, dateRange, requestedDateRange: request.dateRange, profile });
        }
      }
    }
  }
  return tasks;
}

function taskDateRangesForModule(module, requestedRange) {
  const mode = String(module?.taskRangeMode || "").toLowerCase();
  if (mode === "last30") return [dateShortcut("last30")];
  return expandDateRangeToDailyRanges(requestedRange);
}

function expandModuleForCountry(module, country) {
  const sections = adSectionsForCountry(module, country);
  if (!sections.length) return [module];
  return sections.map((section) => ({ ...module, adsSection: section }));
}

function adSectionsForCountry(module, country) {
  if (!isAdsDownloadModule(module)) return [];
  const byCountry = module.adsSectionsByCountry || {};
  const candidates = [country.name, country.code, String(country.name || "").toLowerCase(), String(country.code || "").toLowerCase()].filter(Boolean);
  for (const key of candidates) {
    if (Array.isArray(byCountry[key]) && byCountry[key].length) return byCountry[key];
  }
  return Array.isArray(module.adsSections) ? module.adsSections : [];
}

async function detectCountriesFromOpenPages(activeProfiles, modules, config) {
  const playwright = await loadPlaywright();
  const detected = [];
  for (const profile of activeProfiles) {
    const country = findCountryByName(config.profiles[profile.userId], config);
    if (!country || !profileHasCdpEndpoint(profile)) continue;

    let browser;
    try {
      browser = await playwright.chromium.connectOverCDP(resolveCdpEndpoint(profile), { noDefaults: true });
      const pages = browser.contexts().flatMap((context) => context.pages());
      for (const page of pages) {
        const title = await safeTitle(page);
        const url = page.url();
        if (modules.some((module) => matchesPage(url, title, country, module))) {
          detected.push(country);
          break;
        }
      }
    } catch {
      // Ignore a single profile discovery failure; the task preflight reports actionable errors later.
    } finally {
      await browser?.close?.();
    }
  }
  return uniqueByName(detected);
}

async function runTaskBatch(tasks, config, realExport, rl) {
  const indexedTasks = tasks.map((task, index) => ({ ...task, batchIndex: index }));
  const groups = realExport ? groupTasksForParallelCountries(indexedTasks) : [{ key: "simulation", tasks: indexedTasks }];
  if (realExport && groups.length > 1) {
    console.log("");
    console.log(`骞惰绔欑偣浠诲姟: ${groups.map((group) => group.name).join(" + ")}`);
  }

  const groupResults = await Promise.all(groups.map((group) => runTaskGroup(group, config, realExport, rl)));
  return groupResults.flat().sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
}

async function runTaskGroup(group, config, realExport, rl) {
  const results = [];
  const exportThrottle = new Map();
  const session = realExport ? { browser: null, page: null } : null;
  for (const task of group.tasks) {
    console.log("");
    console.log(`任务 ${task.batchIndex + 1}: ${task.country.name} -> ${task.module.name} -> ${formatDateRange(task.dateRange)}`);
    try {
      results.push(await runTask(task, config, realExport, rl, exportThrottle, session));
    } catch (error) {
      if (realExport && task.usedCachedPage) {
        console.log(`缓存页面流程失败，执行一次完整页面筛查重试: ${friendlyError(error)}`);
        session.page = null;
        task.usedCachedPage = false;
        try {
          results.push(await runTask(task, config, realExport, rl, exportThrottle, session));
          continue;
        } catch (retryError) {
          results.push(recordTaskFailure(task, retryError));
          continue;
        }
      }
      results.push(recordTaskFailure(task, error));
    }
  }
  await session?.browser?.close?.().catch(() => null);
  return results;
}

function groupTasksForParallelCountries(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = `${task.profile?.userId || task.country.name}::${task.country.name}::${task.module.name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: `${task.country.name}/${task.module.name}`,
        tasks: []
      });
    }
    groups.get(key).tasks.push(task);
  }
  return Array.from(groups.values());
}

function recordTaskFailure(task, error) {
  const message = friendlyError(error);
  console.log(`失败: ${message}`);
  return {
    status: "Failed",
    batchIndex: task.batchIndex,
    country: task.country.name,
    module: task.module.name,
    adsSection: task.module?.adsSection || null,
    dateRange: task.dateRange,
    requestedDateRange: task.requestedDateRange,
    error: message,
    timings: task.timings ? finishTimings(task.timings, task.timingsStartedAt || Date.now()) : undefined
  };
}

async function waitForSameModuleExportSlot(task, config, exportThrottle) {
  if (task.module?.optimisticExportThrottle) {
    const key = exportThrottleKey(task);
    if (exportThrottle.get(key)) console.log("Optimistic throttle: skip fixed 60s wait; retry only if platform blocks.");
    return;
  }
  const timing = officialExportTiming(config);
  const key = exportThrottleKey(task);
  const lastTriggeredAt = exportThrottle.get(key);
  if (!lastTriggeredAt) return;

  const elapsed = Date.now() - lastTriggeredAt;
  const waitMs = timing.sameModuleExportIntervalMs - elapsed;
  if (waitMs <= 0) return;

  console.log(`同一站点/模块 Export 间隔限制：还需等待 ${Math.ceil(waitMs / 1000)}s`);
  await sleep(waitMs);
}

function exportThrottleKey(task) {
  const sectionKey = task.module?.adsSection?.key || task.module?.adsSection?.name || "";
  return `${task.profile?.userId || task.country.name}::${task.country.name}::${task.module.name}::${sectionKey}`;
}

function officialExportTiming(config) {
  const value = config?.officialExport || {};
  return {
    sameModuleExportIntervalMs: positiveNumber(value.sameModuleExportIntervalMs, 60000),
    retryExportClickIntervalMs: positiveNumber(value.retryExportClickIntervalMs, 10000),
    latestReportsInitialWaitMs: nonNegativeNumber(value.latestReportsInitialWaitMs, 0),
    latestReportsTimeoutMs: positiveNumber(value.latestReportsTimeoutMs, 300000)
  };
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTask(task, config, realExport, rl, exportThrottle = new Map(), session = null) {
  const timings = [];
  task.timings = timings;
  const taskStartedAt = Date.now();
  task.timingsStartedAt = taskStartedAt;
  task.usedCachedPage = false;
  if (task.missingProfile) {
    throw new UserFacingError(`未找到已打开并映射到 ${task.country.name} 的 AdsPower Profile。`);
  }

  console.log("[1/5] 检查页面");
  let browser = session?.browser || null;
  try {
    let selectedPage = null;
    if (session?.page) {
      task.usedCachedPage = true;
      selectedPage = await measureTiming(timings, "page_reuse_validate", () => validateCachedPage(session.page, task));
      console.log("沿用已确认页面");
    } else {
      if (!browser) {
        const { chromium } = await measureTiming(timings, "load_playwright", () => loadPlaywright());
        const endpoint = resolveCdpEndpoint(task.profile);
        browser = await measureTiming(timings, "connect_cdp", () => chromium.connectOverCDP(endpoint, { noDefaults: true }));
        if (session) session.browser = browser;
      }
      selectedPage = await measureTiming(timings, "page_select_or_open", () => selectMatchingPage(browser, task, rl));
      if (session) session.page = selectedPage;
      await measureTiming(timings, "dismiss_overlays", () => dismissTransientOverlays(selectedPage));
      const preflight = await measureTiming(timings, "preflight", () => readPreflight(selectedPage, task));
      await measureTiming(timings, "preflight_assert", async () => assertPreflight(preflight, task, realExport));
    }
    const dateSelection = await measureTiming(timings, "date_period", () => prepareDataPeriod(selectedPage, task, { apply: realExport }));
    if (realExport) {
      await measureTiming(timings, "date_assert", () => assertSelectedDate(selectedPage, task));
    }
    await measureTiming(timings, "module_subview", () => prepareModuleSubview(selectedPage, task, { apply: realExport }));
    console.log("OK");

    if (!realExport) {
      console.log("[2/5] Export Data: SKIPPED");
      console.log("[3/5] Latest Reports: SKIPPED");
      console.log("[4/5] Download Excel: SKIPPED");
      console.log("[5/5] 保存完成: SKIPPED");
      return {
        status: "Ready",
        batchIndex: task.batchIndex,
        country: task.country.name,
        module: task.module.name,
        adsSection: task.module?.adsSection || null,
        dateRange: task.dateRange,
        requestedDateRange: task.requestedDateRange,
        simulation: true,
        timings: finishTimings(timings, taskStartedAt)
      };
    }

    console.log("[2/5] Export Data");
    await measureTiming(timings, "export_throttle", () => waitForSameModuleExportSlot(task, config, exportThrottle));
    const exportTriggeredAt = Date.now();
    let download = null;
    if (isExportManagementModule(task.module)) {
      download = await measureTiming(timings, "export_management_wait", () => clickExportAndWaitForExportManagementDownload(selectedPage, task.module.exportLabels, config, task.dateRange, exportTriggeredAt, task.profile, task.module));
      exportThrottle.set(exportThrottleKey(task), Date.now());
      console.log("OK");
      console.log("[3/5] Export Management: WAITED FOR DOWNLOAD READY");
      console.log("[4/5] Download Excel");
      console.log("OK");
    } else if (isDirectDownloadModule(task.module)) {
      download = await measureTiming(timings, "direct_download_wait", () => clickExportAndWaitForDirectDownload(selectedPage, task.module.exportLabels, config, task.dateRange, exportTriggeredAt, task.profile, task.module));
      exportThrottle.set(exportThrottleKey(task), Date.now());
      console.log("OK");
      console.log("[3/5] Latest Reports: SKIPPED direct download");
      console.log("[4/5] Download Excel");
      console.log("OK");
    } else {
      await measureTiming(timings, "export_click", () => clickByLabels(selectedPage, task.module.exportLabels, "Export Data"));
      exportThrottle.set(exportThrottleKey(task), Date.now());
      console.log("OK");

      console.log("[3/5] Latest Reports");
      await measureTiming(timings, "latest_reports_open", () => openLatestReports(selectedPage, task.module.latestReportsLabels));
      console.log("OK");

      console.log("[4/5] Download Excel");
      download = await measureTiming(timings, "download_wait", () => waitForWorkbookDownload(selectedPage, task.module.downloadLabels, config, task.dateRange, exportTriggeredAt, task.module.exportLabels, task.profile, task.module));
      console.log("OK");
    }

    console.log("[5/5] 保存完成");
    const workbook = await measureTiming(timings, "save_workbook", () => saveWorkbook(download, task, config));
    console.log("OK");
    console.log("");
    console.log("导出完成");
    console.log("");
    console.log(`文件: ${workbook.savedFilename}`);
    console.log(`保存位置: ${path.dirname(workbook.path)}`);

    return {
      status: "Completed",
      batchIndex: task.batchIndex,
      country: task.country.name,
      module: task.module.name,
      adsSection: task.module?.adsSection || null,
      dateRange: task.dateRange,
      requestedDateRange: task.requestedDateRange,
      workbook,
      timings: finishTimings(timings, taskStartedAt)
    };
  } finally {
    if (!session && browser) {
      await measureTiming(timings, "disconnect_cdp", () => browser.close());
    }
  }
}

async function measureTiming(timings, phase, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ phase, ms: Date.now() - startedAt });
  }
}

function finishTimings(timings, startedAt) {
  return {
    totalMs: Date.now() - startedAt,
    phases: [...timings]
  };
}

async function selectMatchingPage(browser, task, rl) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const candidates = [];
  for (const page of pages) {
    const title = await safeTitle(page);
    const url = page.url();
    if (matchesPage(url, title, task.country, task.module)) {
      candidates.push({ page, title, url });
    }
  }
  if (candidates.length === 0) {
    return await openConfiguredTargetPage(browser, task);
  }
  const targetPathCandidates = task.module?.targetPath
    ? candidates.filter((item) => pageMatchesTargetPath(item.url, task.module.targetPath))
    : candidates;
  if (targetPathCandidates.length === 0 && task.module?.targetPath) {
    return await openConfiguredTargetPage(browser, task);
  }
  const selectableCandidates = targetPathCandidates.length ? targetPathCandidates : candidates;
  if (selectableCandidates.length === 1) return selectableCandidates[0].page;
  if (process.argv.includes("--approved-real-export")) {
    console.log(`妫€娴嬪埌澶氫釜鍖归厤椤甸潰锛岀湡瀹炴壒閲忔ā寮忛粯璁ら€夋嫨绗?1 涓? ${selectableCandidates[0].url}`);
    return selectableCandidates[0].page;
  }

  console.log("妫€娴嬪埌澶氫釜鍖归厤椤甸潰锛岃閫夋嫨:");
  selectableCandidates.forEach((item, index) => console.log(`${index + 1}. ${item.title || "(鏃犳爣棰?"} ${item.url}`));
  while (true) {
    const value = await ask(rl, "璇疯緭鍏ラ〉闈㈢紪鍙? ");
    if (!value.trim()) {
      console.log("鏈緭鍏ラ〉闈㈢紪鍙凤紝榛樿閫夋嫨绗?1 涓尮閰嶉〉闈€?");
      return selectableCandidates[0].page;
    }
    const index = Number(value.trim()) - 1;
    if (selectableCandidates[index]) return selectableCandidates[index].page;
    console.log("缂栧彿鏃犳晥锛岃閲嶆柊閫夋嫨銆?");
  }
}

async function validateCachedPage(page, task) {
  if (!page || page.isClosed?.()) {
    throw new UserFacingError("Cached Shopee page is closed.");
  }
  const title = await safeTitle(page);
  const url = page.url();
  if (!matchesPage(url, title, task.country, task.module)) {
    throw new UserFacingError(`Cached page no longer matches ${task.country.name} -> ${task.module.name}: ${url}`);
  }
  return page;
}

async function openConfiguredTargetPage(browser, task) {
  const targetUrl = resolveConfiguredTargetUrl(task);
  if (!targetUrl) {
    throw new UserFacingError(`No matching page was found for ${task.country.name} -> ${task.module.name}, and no configured target URL/path is available.`);
  }
  const context = browser.contexts()[0];
  if (!context?.newPage) {
    throw new UserFacingError(`No matching page was found for ${task.country.name} -> ${task.module.name}, and the connected browser context cannot open a new page.`);
  }
  console.log(`No matching open page. Opening configured target URL: ${targetUrl}`);
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const title = await safeTitle(page);
  if (!matchesPage(page.url(), title, task.country, task.module)) {
    throw new UserFacingError(pageOpenFailureMessage(task, page.url()));
  }
  return page;
}

function pageOpenFailureMessage(task, currentUrl) {
  const target = `${task.country.name} -> ${task.module.name}`;
  const urlText = String(currentUrl || "");
  if (/verify|captcha|traffic/i.test(urlText)) {
    return `页面检测失败：${target} 被 Shopee 验证页拦截。请先在对应 AdsPower 站点完成验证并打开目标页面，或修改需求后重试。`;
  }
  let location = urlText;
  try {
    const url = new URL(urlText);
    location = url.origin + url.pathname;
  } catch {}
  return `页面检测失败：未找到 ${target} 的对应资源。请确认是否已打开正确页面，或修改需求后重试。当前页面：${location}`;
}

function pageMatchesTargetPath(urlValue, targetPath) {
  if (!targetPath) return true;
  try {
    const url = new URL(urlValue);
    return url.pathname.toLowerCase() === String(targetPath).toLowerCase();
  } catch {
    return false;
  }
}

function resolveConfiguredTargetUrl(task) {
  const countryKeyCandidates = [
    task.country.name,
    task.country.code,
    String(task.country.name || "").toLowerCase(),
    String(task.country.code || "").toLowerCase()
  ].filter(Boolean);
  if (task.module.targetUrls && typeof task.module.targetUrls === "object") {
    for (const key of countryKeyCandidates) {
      if (task.module.targetUrls[key]) return applyUrlDateRangeToTarget(String(task.module.targetUrls[key]), task);
    }
  }
  const targetPath = task.module.targetPath
    || (task.module.pageHints || []).find((hint) => String(hint).startsWith("/"));
  const host = task.country.hosts?.[0];
  if (!targetPath || !host) return null;
  return applyUrlDateRangeToTarget("https://" + host + (String(targetPath).startsWith("/") ? "" : "/") + targetPath, task);
}
function applyUrlDateRangeToTarget(targetUrl, task) {
  if (!isUrlDateModule(task.module) || !task.dateRange?.start || !task.dateRange?.end) return targetUrl;
  const url = new URL(targetUrl);
  const offsetHours = urlTimezoneOffsetHours(task);
  const from = epochSecondsForLocalDate(task.dateRange.start, offsetHours, 0, 0, 0);
  const to = epochSecondsForLocalDate(task.dateRange.end, offsetHours, 23, 59, 59);
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  if (task.module.urlDateGroup === "today-or-custom") {
    url.searchParams.set("group", sameRange(task.dateRange, dateShortcut("today")) ? "today" : "custom");
  }
  return url.toString();
}

function epochSecondsForLocalDate(isoDate, offsetHours, hour, minute, second) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new UserFacingError("Invalid date: " + isoDate);
  const utcMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, second) - offsetHours * 3600 * 1000;
  return Math.floor(utcMs / 1000);
}

function parseUrlDateRange(urlValue, task) {
  try {
    const url = new URL(urlValue);
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const offsetHours = urlTimezoneOffsetHours(task);
    return { start: isoDateFromEpochAtOffset(from, offsetHours), end: isoDateFromEpochAtOffset(to, offsetHours) };
  } catch {
    return null;
  }
}

function isoDateFromEpochAtOffset(epochSeconds, offsetHours) {
  const date = new Date((epochSeconds + offsetHours * 3600) * 1000);
  return String(date.getUTCFullYear()) + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}

function urlTimezoneOffsetHours(task) {
  const offsets = task.module?.urlTimezoneOffsets || {};
  const keys = [task.country?.name, task.country?.code, String(task.country?.name || "").toLowerCase(), String(task.country?.code || "").toLowerCase()].filter(Boolean);
  for (const key of keys) {
    const value = Number(offsets[key]);
    if (Number.isFinite(value)) return value;
  }
  return task.country?.name === "Malaysia" ? 8 : 7;
}

async function prepareUrlQueryDateRange(page, task, options = {}) {
  const targetUrl = resolveConfiguredTargetUrl(task);
  if (!options.apply) return { action: "set date by URL query", simulation: true, targetUrl };

  let current = parseUrlDateRange(page.url(), task);
  for (let attempt = 0; attempt < 3 && !sameRange(current, task.dateRange); attempt += 1) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(attempt === 0 ? 1800 : 3000);
    current = parseUrlDateRange(page.url(), task);
  }

  return { action: "set date by URL query", simulation: false, current };
}



async function dismissTransientOverlays(page) {
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button,[role='button'],span,i"))
        .map((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          const label = el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "";
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return { el, text, label, rect, visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" };
        })
        .filter((item) => item.visible && /^(close|鍏抽棴|脳|x)$/i.test(item.text || item.label));
      const target = candidates
        .filter((item) => item.rect.top < 220 || item.rect.right > window.innerWidth - 220)
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
      target?.el?.click?.();
    }).catch(() => {});
    await page.waitForTimeout(300);
  } catch {
    // Best-effort cleanup only. Preflight reports real failures.
  }
}

async function readPreflight(page, task) {
  const snapshot = await page.evaluate(({ exportLabels }) => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const labels = new RegExp(exportLabels.map(escapeRegExp).join("|"), "i");
    const buttons = Array.from(document.querySelectorAll("button,[role='button'],a"));
    const exportButton = buttons.find((el) => labels.test(el.textContent || ""));
    return {
      url: location.href,
      title: document.title,
      pageReady: document.readyState === "complete" && text.length > 80,
      loginDetected: !/(login|sign in|masuk|喙€喔傕箟喔侧釜喔灌箞喔｀赴喔氞笟)/i.test(text),
      exportButtonDetected: Boolean(exportButton),
      exportButtonEnabled: Boolean(exportButton && !exportButton.disabled && isVisible(exportButton)),
      exportButtonText: exportButton?.textContent?.replace(/\s+/g, " ").trim() || ""
    };

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }, { exportLabels: task.module.exportLabels });

  const dataPeriod = await inspectDataPeriodButton(page);
  const detectedRange = parseDataPeriodRange(dataPeriod);
  return {
    ...snapshot,
    dataPeriod,
    detectedDate: detectedRange || dataPeriod.currentLabel || null,
    requestedDate: task.dateRange,
    dateMatched: dataPeriodMatchesRange(dataPeriod, task.dateRange)
  };
}

async function inspectPageDate(page) {
  const fallback = {
    url: page.url(),
    title: await safeTitle(page),
    range: null,
    selectedSelector: "",
    selectedReason: "No date range candidate was selected.",
    selectedCandidate: null,
    candidates: [],
    error: ""
  };
  try {
    const probe = await page.evaluate(collectDateRangeProbeInPage);
    return {
      ...fallback,
      ...probe,
      candidates: Array.isArray(probe?.candidates) ? probe.candidates : []
    };
  } catch (error) {
    return {
      ...fallback,
      error: friendlyError(error)
    };
  }
}

async function inspectDataPeriodButton(page) {
  try {
    await ensureCalendarHelpers(page);
    const result = await page.evaluate(() => window.__shopeeOfficialCalendar.findDataPeriodButton());
    return result || { found: false, currentLabel: "", selector: "", text: "", rect: null };
  } catch (error) {
    return { found: false, currentLabel: "", selector: "", text: "", rect: null, error: friendlyError(error) };
  }
}

async function prepareDataPeriod(page, task, options = {}) {
  if (isUrlDateModule(task.module)) return await prepareUrlQueryDateRange(page, task, options);
  if (isPageDefaultDateModule(task.module)) {
    return {
      action: "reuse page default recent 30 days",
      simulation: !options.apply,
      button: { found: true, currentLabel: "recent 30 days", selector: "", text: "", rect: null }
    };
  }
  const action = resolveDataPeriodAction(task.dateRange);
  const button = await inspectDataPeriodButton(page);
  if (!button.found) throw new UserFacingError("鏈壘鍒?Product Performance 椤甸潰 Data Period 鎸夐挳銆?");

  if (!options.apply) {
    return { action: describeDataPeriodAction(action), simulation: true, button };
  }

  if (dataPeriodMatchesRange(button, task.dateRange)) {
    return {
      action: `reuse current ${describeDataPeriodAction(action)}`,
      simulation: false,
      button,
      current: button
    };
  }

  await ensureCalendarPopupOpen(page);

  if (action.type === "preset") {
    await clickCalendarMenuOption(page, action.labels);
    await waitForPageAfterDateChange(page);
  } else {
    await clickCalendarMenuOption(page, ["By Day"]);
    await waitForByDayCalendar(page, action.start);
    await selectCalendarMonth(page, action.start);
    await selectCalendarDate(page, action.start);
    await tryClickCalendarConfirm(page);
    await waitForPageAfterDateChange(page);
  }
  return {
    action: describeDataPeriodAction(action),
    simulation: false,
    button,
    current: await inspectDataPeriodButton(page)
  };
}

async function assertSelectedDate(page, task) {
  if (isPageDefaultDateModule(task.module)) return;
  if (isUrlDateModule(task.module)) {
    const detectedRange = parseUrlDateRange(page.url(), task);
    if (sameRange(detectedRange, task.dateRange)) return;
    throw new UserFacingError("Date selection verification failed. Requested " + formatDateRange(task.dateRange) + ", but page URL shows " + (detectedRange ? formatDateRange(detectedRange) : "not readable") + ".");
  }
  const dataPeriod = await inspectDataPeriodButton(page);
  const detectedRange = parseDataPeriodRange(dataPeriod);
  if (dataPeriodMatchesRange(dataPeriod, task.dateRange)) return;
  const requested = formatDateRange(task.dateRange);
  const detected = detectedRange ? formatDateRange(detectedRange) : (dataPeriod.currentLabel || dataPeriod.text || "not readable");
  throw new UserFacingError(`Date selection verification failed. Requested ${requested}, but page shows ${detected}. Please confirm the page is on the requested Product Performance date or change the request.`);
}

function parseDataPeriodRange(dataPeriod) {
  const currentLabel = String(dataPeriod?.currentLabel || "").trim();
  if (currentLabel) return parseDateRangeFromText(currentLabel);
  return parseDateRangeFromText(dataPeriod?.text || "");
}

function dataPeriodMatchesRange(dataPeriod, range) {
  const detectedRange = parseDataPeriodRange(dataPeriod);
  if (sameRange(detectedRange, range)) return true;
  const label = String(dataPeriod?.currentLabel || dataPeriod?.text || "").toLowerCase();
  if (label.includes("yesterday") && sameRange(range, dateShortcut("yesterday"))) return true;
  if (label.includes("today") && sameRange(range, dateShortcut("today"))) return true;
  return false;
}

function resolveDataPeriodAction(range) {
  if (sameRange(range, dateShortcut("yesterday"))) {
    return { type: "preset", key: "yesterday", labels: ["Yesterday"], range };
  }
  return { type: "custom", key: "byDay", start: range.start, end: range.end, range };
}

function describeDataPeriodAction(action) {
  if (action.type === "preset") return `select ${action.labels[0]}`;
  return `select By Day ${formatDateRange(action.range)}`;
}

async function clickDataPeriodButton(page) {
  await ensureCalendarHelpers(page);
  const dataPeriod = await inspectDataPeriodButton(page);
  if (!dataPeriod.found || !dataPeriod.rect) throw new UserFacingError("鏈壘鍒板彲鐐瑰嚮鐨?Data Period 鎸夐挳銆?");
  await page.mouse.click(
    dataPeriod.rect.x + Math.max(8, dataPeriod.rect.width - 28),
    dataPeriod.rect.y + Math.max(6, dataPeriod.rect.height / 2)
  );
}

async function waitForCalendarPopup(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const info = await inspectCalendarPopup(page);
    if (info.popupFound) return info;
    await page.waitForTimeout(300);
  }
  throw new UserFacingError("鐐瑰嚮 Data Period 鍚庢湭妫€娴嬪埌 Shopee Calendar Popup銆?");
}

async function ensureCalendarPopupOpen(page) {
  const existingPopup = await inspectCalendarPopup(page);
  if (existingPopup.popupFound) return existingPopup;

  await clickDataPeriodButton(page);
  let popup = await waitForCalendarPopupOrNull(page, 5000);
  if (popup?.popupFound) return popup;

  await clickDataPeriodButton(page);
  popup = await waitForCalendarPopupOrNull(page, 10000);
  if (popup?.popupFound) return popup;

  throw new UserFacingError("鐐瑰嚮 Data Period 鍚庢湭妫€娴嬪埌 Shopee Calendar Popup銆?");
}

async function waitForCalendarPopupOrNull(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await inspectCalendarPopup(page);
    if (info.popupFound) return info;
    await page.waitForTimeout(300);
  }
  return null;
}

async function inspectCalendarPopup(page) {
  try {
    await ensureCalendarHelpers(page);
    return await page.evaluate(() => window.__shopeeOfficialCalendar.inspectCalendarPopup());
  } catch (error) {
    return {
      popupFound: false,
      error: friendlyError(error),
      leftMenuOptions: [],
      dateCells: [],
      currentMonth: "",
      applyButtons: [],
      domStructure: []
    };
  }
}

async function clickCalendarMenuOption(page, labels) {
  await ensureCalendarHelpers(page);
  const target = await page.evaluate((value) => window.__shopeeOfficialCalendar.findCalendarMenuOption(value), labels);
  if (!target?.found || !target.rect) throw new UserFacingError(`鏈壘鍒?Calendar 鑿滃崟閫夐」: ${labels.join(" / ")}銆俙`);
  if (target.rect.width > 0 && target.rect.height > 0) {
    await page.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
    return;
  }
  const clicked = await page.evaluate((value) => window.__shopeeOfficialCalendar.clickCalendarMenuOption(value), labels);
  if (!clicked) throw new UserFacingError(`鏈兘鐐瑰嚮 Calendar 鑿滃崟閫夐」: ${labels.join(" / ")}銆俙`);
}

async function waitForByDayCalendar(page, startDate) {
  const deadline = Date.now() + 12000;
  let lastInfo = null;
  while (Date.now() < deadline) {
    await ensureCalendarPopupOpen(page);
    await hoverCalendarMenuOption(page, ["By Day"]).catch(() => {});
    await page.waitForTimeout(150);
    lastInfo = await inspectCalendarPopup(page);
    if (lastInfo.dateCells?.length) return lastInfo;
    await page.waitForTimeout(500);
  }
  const currentMonth = lastInfo?.currentMonth || "(not found)";
  const menuOptions = lastInfo?.leftMenuOptions?.join(" | ") || "(none)";
  throw new UserFacingError(`宸茬偣鍑?By Day锛屼絾 Calendar 鏈樉绀烘寜澶╂棩鏈熷崟鍏冩牸锛屾棤娉曢€夋嫨 ${startDate}銆侰urrent Month: ${currentMonth}; Menu: ${menuOptions}`);
}

async function hoverCalendarMenuOption(page, labels) {
  await ensureCalendarHelpers(page);
  const target = await page.evaluate((value) => window.__shopeeOfficialCalendar.findCalendarMenuOption(value), labels);
  if (!target?.found || !target.rect) return false;
  await page.mouse.move(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
  return true;
}

async function selectCalendarMonth(page, isoDate) {
  await ensureCalendarHelpers(page);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const target = await page.evaluate((value) => window.__shopeeOfficialCalendar.findCalendarMonth(value), isoDate);
    if (target?.alreadySelected) return true;
    if (target?.found && target.rect) {
      if (target.rect.width > 0 && target.rect.height > 0) {
        await page.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
      } else {
        await page.evaluate((value) => window.__shopeeOfficialCalendar.clickCalendarMonth(value), isoDate);
      }
    } else {
      const navTarget = await page.evaluate((value) => window.__shopeeOfficialCalendar.findCalendarMonthNavTarget(value), isoDate);
      if (!navTarget?.found || !navTarget.rect) return false;
      await page.mouse.click(navTarget.rect.x + navTarget.rect.width / 2, navTarget.rect.y + navTarget.rect.height / 2);
    }
    await page.waitForTimeout(500);
    await hoverCalendarMenuOption(page, ["By Day"]).catch(() => {});
    await page.waitForTimeout(150);
  }
  return false;
}

async function selectCalendarDate(page, isoDate) {
  await ensureCalendarHelpers(page);
  const target = await page.evaluate((value) => window.__shopeeOfficialCalendar.findCalendarDate(value), isoDate);
  if (!target?.found || !target.rect) throw new UserFacingError(`鏈兘鍦?Calendar 涓€夋嫨鏃ユ湡: ${isoDate}銆傝鍏堢敤 --debug-calendar 鏌ョ湅鏃ユ湡鍗曞厓鏍肩粨鏋勩€俙`);
  if (target.rect.width > 0 && target.rect.height > 0) {
    await page.mouse.click(target.rect.x + target.rect.width / 2, target.rect.y + target.rect.height / 2);
    return;
  }
  const clicked = await page.evaluate((value) => window.__shopeeOfficialCalendar.clickCalendarDate(value), isoDate);
  if (!clicked) throw new UserFacingError(`鏈兘鐐瑰嚮 Calendar 鏃ユ湡: ${isoDate}銆俙`);
}

async function clickCalendarConfirm(page) {
  await ensureCalendarHelpers(page);
  const clicked = await page.evaluate(() => window.__shopeeOfficialCalendar.clickCalendarConfirm());
  if (!clicked) throw new UserFacingError("鏈壘鍒?Calendar Apply/Confirm 鎸夐挳銆?");
}

async function tryClickCalendarConfirm(page) {
  await ensureCalendarHelpers(page);
  return await page.evaluate(() => window.__shopeeOfficialCalendar.clickCalendarConfirm());
}

async function waitForPageAfterDateChange(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(2500);
}

async function runDebugCalendarMode(tasks, config, rl) {
  const { chromium } = await loadPlaywright();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    console.log("");
    console.log(`Calendar debug ${index + 1}/${tasks.length}: ${task.country.name} -> ${task.module.name}`);
    if (task.missingProfile) {
      console.log(`FAILED: no open AdsPower profile mapped to ${task.country.name}`);
      continue;
    }

    let browser;
    try {
      browser = await chromium.connectOverCDP(resolveCdpEndpoint(task.profile), { noDefaults: true, timeout: 15000 });
      const page = await selectMatchingPage(browser, task, rl);
      console.log(`URL: ${page.url()}`);
      console.log(`Page Title: ${await safeTitle(page)}`);

      const dataPeriod = await inspectDataPeriodButton(page);
      printCalendarDataPeriodDebug(dataPeriod);
      let popup = await inspectCalendarPopup(page);
      if (popup.popupFound) {
        console.log("Data Period Clicked: SKIPPED (Calendar already open)");
      } else if (dataPeriod.found) {
        await clickDataPeriodButton(page);
        console.log("Data Period Clicked: YES");
        await page.waitForTimeout(1000);
        popup = await inspectCalendarPopup(page);
      } else {
        console.log("Data Period Clicked: NO");
      }

      printCalendarPopupDebug(popup);
    } catch (error) {
      console.log("Calendar Debug Error:");
      console.log(fullErrorMessage(error));
    } finally {
      try {
        await browser?.close?.();
      } catch {
        // Keep debug output readable even if CDP disconnect reports an error.
      }
    }
  }
  console.log("Debug completed.");
}

function printCalendarDataPeriodDebug(dataPeriod) {
  console.log(`Data Period Found: ${dataPeriod.found ? "YES" : "NO"}`);
  console.log(`Data Period Selector: ${dataPeriod.selector || "(none)"}`);
  console.log(`Data Period Text: ${dataPeriod.text || ""}`);
  console.log(`Data Period Current Label: ${dataPeriod.currentLabel || ""}`);
  if (dataPeriod.rect) {
    console.log(`Data Period BBox: x:${Math.round(dataPeriod.rect.x)} y:${Math.round(dataPeriod.rect.y)} w:${Math.round(dataPeriod.rect.width)} h:${Math.round(dataPeriod.rect.height)}`);
  }
  if (dataPeriod.error) console.log(`Data Period Error: ${dataPeriod.error}`);
}

function printCalendarPopupDebug(popup) {
  console.log(`Calendar Popup Found: ${popup.popupFound ? "YES" : "NO"}`);
  console.log(`Calendar Selector: ${popup.selector || "(none)"}`);
  console.log(`Left Menu Options: ${(popup.leftMenuOptions || []).join(" | ") || "(none)"}`);
  console.log(`Current Month: ${popup.currentMonth || "(not found)"}`);
  console.log(`Apply/Confirm Buttons: ${(popup.applyButtons || []).map((item) => `${item.text} <${item.selector}>`).join(" | ") || "(none)"}`);
  console.log("Date Cell Selectors:");
  for (const cell of popup.dateCells || []) {
    const rect = cell.rect || { x: 0, y: 0, width: 0, height: 0 };
    console.log(`- ${cell.selector} text="${cell.text}" disabled=${cell.disabled} selected=${cell.selected} bbox=x:${Math.round(rect.x)} y:${Math.round(rect.y)} w:${Math.round(rect.width)} h:${Math.round(rect.height)}`);
  }
  console.log("Calendar DOM Structure:");
  for (const line of popup.domStructure || []) console.log(line);
  if (popup.error) console.log(`Calendar Error: ${popup.error}`);
}

async function runDebugDateMode(tasks, config, rl) {
  const { chromium } = await loadPlaywright();
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const printedDebugSteps = new Set();
    console.log("");
    console.log(`Date debug ${index + 1}/${tasks.length}: ${task.country.name} -> ${task.module.name}`);
    markDebugStep(printedDebugSteps, "Step 1 Enter");
    debugStepStart("Step 1 Enter");
    if (task.missingProfile) {
      printSkippedDebugSteps(printedDebugSteps);
      await printDateDebugProbe({
        url: "",
        title: "",
        range: null,
        selectedSelector: "",
        selectedReason: `No open AdsPower profile mapped to ${task.country.name}.`,
        selectedCandidate: null,
        candidates: [],
        error: `No open AdsPower profile mapped to ${task.country.name}.`
      }, task);
      debugStepStart("Step 10 Debug completed");
      continue;
    }

    const endpoint = resolveCdpEndpoint(task.profile);
    let browser;
    let selectedPage;
    let probe = null;
    try {
      markDebugStep(printedDebugSteps, "Step 2 Connect Browser");
      browser = await debugStep("Step 2 Connect Browser", async () => {
        console.log(`CDP Endpoint: ${endpoint}`);
        return await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: 15000 });
      }, 20000);
      if (!browser) throw new Error("Browser connection did not return a browser object.");

      markDebugStep(printedDebugSteps, "Step 3 Locate Page");
      selectedPage = await debugStep("Step 3 Locate Page", async () => await selectMatchingPage(browser, task, rl));
      if (!selectedPage) throw new Error("Page selection did not return a page object.");

      markDebugStep(printedDebugSteps, "Step 4 Read URL");
      const url = await debugStep("Step 4 Read URL", async () => selectedPage.url());
      markDebugStep(printedDebugSteps, "Step 5 Read Title");
      const title = await debugStep("Step 5 Read Title", async () => await safeTitle(selectedPage));
      probe = {
        url: url || "",
        title: title || "",
        range: null,
        selectedSelector: "",
        selectedReason: "Date probe has not completed.",
        selectedCandidate: null,
        candidates: []
      };

      markDebugStep(printedDebugSteps, "Step 6 Locate Date Range Picker");
      probe = await debugStep("Step 6 Locate Date Range Picker", async () => await inspectPageDate(selectedPage), 15000);
      if (!probe) {
        probe = {
          url: url || "",
          title: title || "",
          range: null,
          selectedSelector: "",
          selectedReason: "Date range picker probe failed or timed out.",
          selectedCandidate: null,
          candidates: [],
          error: "Date range picker probe failed or timed out."
        };
      }
      markDebugStep(printedDebugSteps, "Step 7 Collect Candidate Elements");
      await debugStep("Step 7 Collect Candidate Elements", async () => {
        console.log(`Candidate Count: ${Array.isArray(probe.candidates) ? probe.candidates.length : 0}`);
        return true;
      });
      markDebugStep(printedDebugSteps, "Step 8 Score Candidates");
      await debugStep("Step 8 Score Candidates", async () => {
        console.log(`Selected Selector: ${probe.selectedSelector || "(none)"}`);
        console.log(`Selection Reason: ${probe.selectedReason || "No candidate selected."}`);
        return true;
      });
      await printDateDebugProbe(probe, task);
    } catch (error) {
      printDebugError("Debug flow error", error);
      printSkippedDebugSteps(printedDebugSteps);
      await printDateDebugProbe({
        url: probe?.url || selectedPage?.url?.() || "",
        title: probe?.title || "",
        range: null,
        selectedSelector: "",
        selectedReason: "Debug probe failed before page date inspection completed.",
        selectedCandidate: null,
        candidates: [],
        error: fullErrorMessage(error)
      }, task);
    } finally {
      try {
        await withTimeout(browser?.close?.() || Promise.resolve(), 5000, "Browser disconnect timed out.");
      } catch (error) {
        printDebugError("Browser disconnect error", error);
      }
    }
    markDebugStep(printedDebugSteps, "Step 10 Debug completed");
    debugStepStart("Step 10 Debug completed");
  }
  console.log("");
  console.log("Debug completed.");
}

async function printDateDebugProbe(probe, task) {
  debugStepStart("Step 9 Print Debug Report");
  try {
    const candidates = Array.isArray(probe?.candidates) ? probe.candidates : [];
    console.log(`URL: ${probe?.url || "(not available)"}`);
    console.log(`Page Title: ${probe?.title || "(not available)"}`);
    console.log(`Date Range Picker Found: ${candidates.length > 0 ? "YES" : "NO"}`);
    console.log(`Candidates Found: ${candidates.length}`);
    console.log(`Requested Date: ${formatDateRange(task.dateRange)}`);
    console.log(`Selected Start Date: ${probe?.range?.start || "Not readable"}`);
    console.log(`Selected End Date: ${probe?.range?.end || "Not readable"}`);
    console.log(`Detected Date: ${formatDateRange(probe?.range)}`);
    console.log(`Matched: ${sameRange(probe?.range, task.dateRange) ? "YES" : "NO"}`);
    console.log(`Selected Selector: ${probe?.selectedSelector || "(none)"}`);
    console.log(`Selection Reason: ${probe?.selectedReason || "No candidate selected."}`);
    if (probe?.error) console.log(`Debug Error: ${probe.error}`);
    console.log("");
    console.log("Date candidates:");
    if (candidates.length === 0) {
      console.log("0 candidates found");
      return;
    }

    for (const candidate of candidates) {
      const rect = candidate.rect || { x: 0, y: 0, width: 0, height: 0 };
      console.log(`- selector=${candidate.selector || ""}`);
      console.log(`  container=${candidate.containerSelector}`);
      console.log(`  text=${candidate.text || ""}`);
      console.log(`  value=${candidate.value || ""}`);
      console.log(`  placeholder=${candidate.placeholder || ""}`);
      console.log(`  aria-label=${candidate.ariaLabel || ""}`);
      console.log(`  title=${candidate.title || ""}`);
      console.log(`  visible=${candidate.visible}`);
      console.log(`  bbox=x:${Math.round(rect.x)} y:${Math.round(rect.y)} w:${Math.round(rect.width)} h:${Math.round(rect.height)}`);
      console.log(`  score=${candidate.score}`);
      console.log(`  range=${formatDateRange(candidate.range)}`);
      console.log(`  reasons=${Array.isArray(candidate.reasons) ? candidate.reasons.join(", ") : "none"}`);
    }
  } catch (error) {
    printDebugError("Step 9 Print Debug Report", error);
  }
}

async function debugStep(label, action, timeoutMs = 15000) {
  debugStepStart(label);
  try {
    const result = await withTimeout(Promise.resolve().then(action), timeoutMs, `${label} timed out after ${timeoutMs}ms.`);
    console.log(`${label}: OK`);
    return result;
  } catch (error) {
    printDebugError(label, error);
    return undefined;
  }
}

function debugStepStart(label) {
  console.log(label);
}

function markDebugStep(printedSteps, label) {
  const match = String(label).match(/^Step\s+\d+/);
  if (match) printedSteps.add(match[0]);
}

function printSkippedDebugSteps(printedSteps) {
  const required = [
    "Step 2 Connect Browser",
    "Step 3 Locate Page",
    "Step 4 Read URL",
    "Step 5 Read Title",
    "Step 6 Locate Date Range Picker",
    "Step 7 Collect Candidate Elements",
    "Step 8 Score Candidates"
  ];
  for (const label of required) {
    const key = label.match(/^Step\s+\d+/)?.[0];
    if (!printedSteps.has(key)) {
      printedSteps.add(key);
      console.log(label);
      console.log(`${label}: SKIPPED - previous step failed.`);
    }
  }
}

function printDebugError(label, error) {
  console.log(`${label}: ERROR`);
  console.log(fullErrorMessage(error));
}

function fullErrorMessage(error) {
  if (!error) return "(unknown error)";
  return error.stack || `${error.name || "Error"}: ${error.message || String(error)}`;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function collectDateRangeProbeInPage() {
  const selector = [
    "input",
    "[class*='date' i]",
    "[class*='range' i]",
    "[class*='calendar' i]",
    "[aria-label*='date' i]",
    "[placeholder*='date' i]",
    "[data-testid*='date' i]",
    "[data-test*='date' i]",
    "[role='combobox']",
    "[role='textbox']"
  ].join(",");
  const seen = new Set();
  const candidates = [];
  for (const origin of Array.from(document.querySelectorAll(selector))) {
    if (!(origin instanceof Element)) continue;
    let node = origin;
    for (let depth = 0; node && node instanceof Element && depth <= 4; depth += 1, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      const key = `${cssPath(origin)}>>${cssPath(node)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const candidate = buildDateCandidate(origin, node, depth);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates.find((item) => item.range) || null;
  return {
    url: location.href,
    title: document.title,
    range: best?.range || null,
    selectedSelector: best?.selector || "",
    selectedReason: best ? best.reasons.join(", ") : "No candidate contained a valid left-to-right date range.",
    selectedCandidate: best,
    candidates: candidates.slice(0, 40)
  };

  function buildDateCandidate(origin, container, depth) {
    const rect = box(container);
    const visible = isVisible(container);
    const originSignal = signal(origin);
    const containerSignal = signal(container);
    const text = compact(containerSignal.text || originSignal.text);
    const value = compact(originSignal.value || containerSignal.value);
    const combined = compact([originSignal.value, originSignal.ariaLabel, originSignal.placeholder, originSignal.title, text].filter(Boolean).join(" "));
    const haystack = compact([originSignal.meta, containerSignal.meta, combined].join(" "));
    const dateish = /date|range|calendar|picker|tanggal|periode|period|waktu|time/i.test(haystack);
    const tokens = positionedDateTokens(container);
    const fallbackTokens = dateTokens(combined).map((item, order) => ({ ...item, order, x: rect.x + order, y: rect.y }));
    const chosenTokens = tokens.length >= 2 ? tokens : fallbackTokens;
    const range = deriveRange(chosenTokens);
    const reasons = [];
    let score = 0;

    if (visible) {
      score += 20;
      reasons.push("visible");
    }
    if (dateish) {
      score += 35;
      reasons.push("date-like-control");
    }
    if (/date[^a-z0-9]*range|range[^a-z0-9]*date|daterange|date-picker|datepicker/i.test(haystack)) {
      score += 35;
      reasons.push("range-picker-marker");
    }
    if (origin.tagName === "INPUT" && value) {
      score += 25;
      reasons.push("input-value");
    }
    if (chosenTokens.length >= 2) {
      score += 60;
      reasons.push("two-dates");
    } else if (chosenTokens.length === 1) {
      score += 20;
      reasons.push("one-date");
    }
    if (/[~]| to | sampai | hingga /i.test(combined)) {
      score += 15;
      reasons.push("range-separator");
    }
    score += Math.max(0, 24 - depth * 6);

    if (rect.width > 900 || rect.height > 260 || text.length > 700) {
      score -= 80;
      reasons.push("large-container");
    }
    if (!dateish && chosenTokens.length === 0) score -= 120;
    if (!range && chosenTokens.length >= 2) {
      score -= 120;
      reasons.push("date-order-invalid");
    }

    if (!dateish && chosenTokens.length === 0) return null;
    return {
      selector: cssPath(origin),
      containerSelector: cssPath(container),
      visible,
      value: value.slice(0, 160),
      placeholder: originSignal.placeholder.slice(0, 160),
      ariaLabel: originSignal.ariaLabel.slice(0, 160),
      title: originSignal.title.slice(0, 160),
      text: text.slice(0, 240),
      rect,
      tokens: chosenTokens.map((token) => token.date),
      range,
      score,
      reasons
    };
  }

  function positionedDateTokens(scope) {
    const result = [];
    const nodes = [scope, ...Array.from(scope.querySelectorAll("input,span,div,button,[role='textbox'],[role='combobox']"))];
    for (const node of nodes) {
      if (!(node instanceof Element) || !isVisible(node)) continue;
      const rect = box(node);
      if (rect.width <= 0 || rect.height <= 0 || rect.width > 500 || rect.height > 90) continue;
      const nodeSignal = signal(node);
      const source = compact([nodeSignal.value, nodeSignal.ariaLabel, nodeSignal.placeholder, nodeSignal.title, nodeSignal.text].filter(Boolean).join(" "));
      if (!source || source.length > 140) continue;
      for (const token of dateTokens(source)) {
        const key = `${token.date}:${Math.round(rect.x)}:${Math.round(rect.y)}`;
        if (result.some((item) => item.key === key)) continue;
        result.push({ ...token, key, x: rect.x, y: rect.y });
      }
    }
    return result
      .sort((left, right) => Math.abs(left.y - right.y) < 12 ? left.x - right.x : left.y - right.y)
      .map((item, order) => ({ ...item, order }));
  }

  function deriveRange(tokens) {
    const unique = [];
    for (const token of tokens) {
      if (token.date && !unique.some((item) => item.date === token.date)) unique.push(token);
      if (unique.length >= 2) break;
    }
    if (unique.length === 0) return null;
    const start = unique[0].date;
    const end = unique[1]?.date || start;
    if (start > end) return null;
    return { start, end };
  }

  function dateTokens(source) {
    const text = String(source || "");
    const tokens = [];
    const push = (date, index) => {
      if (date) tokens.push({ date, index });
    };
    for (const match of text.matchAll(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])\b/g)) {
      push(toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])), match.index || 0);
    }
    for (const match of text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})\b/g)) {
      push(toIsoDate(Number(match[3]), Number(match[2]), Number(match[1])), match.index || 0);
    }
    const months = { jan:1,january:1,januari:1,feb:2,february:2,februari:2,mar:3,march:3,maret:3,apr:4,april:4,may:5,mei:5,jun:6,june:6,juni:6,jul:7,july:7,juli:7,aug:8,august:8,agu:8,agustus:8,sep:9,sept:9,september:9,oct:10,october:10,okt:10,oktober:10,nov:11,november:11,dec:12,december:12,des:12,desember:12 };
    const names = Object.keys(months).sort((a, b) => b.length - a.length).join("|");
    for (const match of text.matchAll(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s+(${names})\\s*,?\\s*(20\\d{2})\\b`, "gi"))) {
      push(toIsoDate(Number(match[3]), months[match[2].toLowerCase()], Number(match[1])), match.index || 0);
    }
    for (const match of text.matchAll(new RegExp(`\\b(${names})\\s+(0?[1-9]|[12]\\d|3[01]),?\\s*(20\\d{2})\\b`, "gi"))) {
      push(toIsoDate(Number(match[3]), months[match[1].toLowerCase()], Number(match[2])), match.index || 0);
    }
    return tokens.sort((left, right) => left.index - right.index);
  }

  function signal(el) {
    return {
      text: compact(el.textContent || ""),
      value: compact(el.value || el.getAttribute("value") || ""),
      placeholder: compact(el.getAttribute("placeholder") || ""),
      ariaLabel: compact(el.getAttribute("aria-label") || ""),
      title: compact(el.getAttribute("title") || ""),
      meta: compact([
        el.tagName,
        el.id,
        el.className,
        el.getAttribute("role"),
        el.getAttribute("data-testid"),
        el.getAttribute("data-test"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("title")
      ].filter(Boolean).join(" "))
    };
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  function box(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    const parts = [];
    let node = el;
    while (node && node instanceof Element && node !== document.body && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      let part = tag;
      if (node.id) {
        part += `#${safeCssIdent(node.id)}`;
        parts.unshift(part);
        break;
      }
      const classNames = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 2);
      if (classNames.length) part += `.${classNames.map(safeCssIdent).join(".")}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function safeCssIdent(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toIsoDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
}

async function ensureCalendarHelpers(page) {
  await page.evaluate((source) => {
    (0, eval)(source);
  }, calendarHelperSource());
}

function calendarHelperSource() {
  return `
    ${findDataPeriodButtonElementInPage.toString()}
    ${findDataPeriodButtonInPage.toString()}
    ${locateDataPeriodButtonInPage.toString()}
    ${inspectCalendarPopupInPage.toString()}
    ${findCalendarMenuOptionInPage.toString()}
    ${findCalendarDateInPage.toString()}
    ${findCalendarMonthInPage.toString()}
    ${navigateCalendarMonthInPage.toString()}
    ${findCalendarMonthNavTargetInPage.toString()}
    ${findCalendarMonthNavButtonInPage.toString()}
    ${monthDistance.toString()}
    ${calendarMonthLabels.toString()}
    ${clickCalendarMenuOptionInPage.toString()}
    ${clickCalendarDateInPage.toString()}
    ${clickCalendarMonthInPage.toString()}
    ${clickCalendarConfirmInPage.toString()}
    ${locateCalendarPopupInPage.toString()}
    ${collectCalendarMenuOptions.toString()}
    ${collectCalendarDateCells.toString()}
    ${collectCalendarDateCellElements.toString()}
    ${findCalendarCurrentMonth.toString()}
    ${findCalendarCurrentMonthInfo.toString()}
    ${findCalendarCurrentMonthNumber.toString()}
    ${collectCalendarConfirmButtons.toString()}
    ${describeCalendarDom.toString()}
    ${nearestClickableForCalendar.toString()}
    ${extractDataPeriodLabel.toString()}
    ${calendarVisible.toString()}
    ${calendarDisabled.toString()}
    ${calendarBox.toString()}
    ${cssPathForCalendar.toString()}
    ${compactCalendarText.toString()}
    ${uniqueElements.toString()}
    ${triggerCalendarClick.toString()}
    window.__shopeeOfficialCalendar = {
      findDataPeriodButtonElement: findDataPeriodButtonElementInPage,
      findDataPeriodButton: findDataPeriodButtonInPage,
      inspectCalendarPopup: inspectCalendarPopupInPage,
      findCalendarMenuOption: findCalendarMenuOptionInPage,
      findCalendarDate: findCalendarDateInPage,
      findCalendarMonth: findCalendarMonthInPage,
      navigateCalendarMonth: navigateCalendarMonthInPage,
      findCalendarMonthNavTarget: findCalendarMonthNavTargetInPage,
      clickCalendarMenuOption: clickCalendarMenuOptionInPage,
      clickCalendarDate: clickCalendarDateInPage,
      clickCalendarMonth: clickCalendarMonthInPage,
      clickCalendarConfirm: clickCalendarConfirmInPage
    };
  `;
}

function findDataPeriodButtonElementInPage() {
  return locateDataPeriodButtonInPage().element || null;
}

function findDataPeriodButtonInPage() {
  const result = locateDataPeriodButtonInPage();
  return {
    found: Boolean(result.element),
    selector: result.element ? cssPathForCalendar(result.element) : "",
    text: compactCalendarText(result.element?.textContent || ""),
    currentLabel: result.currentLabel || "",
    rect: result.element ? calendarBox(result.element) : null,
    score: result.score || 0
  };
}

function locateDataPeriodButtonInPage() {
  const candidates = [];
  const values = /^(today until|yesterday|past 7 days|past 30 days|real-time)/i;
  const elements = Array.from(document.querySelectorAll("button,[role='button'],div,span"));
  for (const el of elements) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    if (el.closest(".bi-date-picker,.eds-popover__popper,.eds-popper-container")) continue;
    const text = compactCalendarText(el.textContent || "");
    if (!text || text.length > 220) continue;
    const lower = text.toLowerCase();
    let score = 0;
    if (lower.includes("data period")) score += 80;
    if (values.test(lower)) score += 70;
    if (/(today until|yesterday|past 7 days|past 30 days)/i.test(text)) score += 40;
    if (el.matches("button,[role='button']")) score += 25;
    if (score <= 0) continue;
    const clickable = nearestClickableForCalendar(el) || el;
    const clickableText = compactCalendarText(clickable.textContent || text);
    candidates.push({
      element: clickable,
      score,
      currentLabel: extractDataPeriodLabel(clickableText),
      text: clickableText
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || { element: null, score: 0, currentLabel: "" };
}

function inspectCalendarPopupInPage() {
  const popup = locateCalendarPopupInPage();
  if (!popup) {
    return {
      popupFound: false,
      selector: "",
      leftMenuOptions: [],
      dateCells: [],
      currentMonth: "",
      applyButtons: [],
      domStructure: []
    };
  }
  return {
    popupFound: true,
    selector: cssPathForCalendar(popup),
    leftMenuOptions: collectCalendarMenuOptions(popup),
    dateCells: collectCalendarDateCells(popup),
    currentMonth: findCalendarCurrentMonth(popup),
    applyButtons: collectCalendarConfirmButtons(popup),
    domStructure: describeCalendarDom(popup)
  };
}

function findCalendarMenuOptionInPage(labels) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return { found: false, selector: "", text: "", rect: null };
  const normalized = labels.map((label) => compactCalendarText(label).toLowerCase());
  const shortcutItems = Array.from(popup.querySelectorAll("li.eds-date-shortcut-item,li[class*='shortcut' i]"));
  const candidates = uniqueElements([...shortcutItems, ...Array.from(popup.querySelectorAll("li,button,[role='button'],div,span"))]);
  for (const el of candidates) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    const text = compactCalendarText(el.textContent || "");
    if (!text || text.length > 120) continue;
    const lower = text.toLowerCase();
    if (normalized.some((label) => lower === label || lower.startsWith(label))) {
      const target = nearestClickableForCalendar(el) || el;
      return {
        found: true,
        selector: cssPathForCalendar(target),
        text: compactCalendarText(target.textContent || text),
        rect: calendarBox(target)
      };
    }
  }
  return { found: false, selector: "", text: "", rect: null };
}

function clickCalendarMenuOptionInPage(labels) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return false;
  const normalized = labels.map((label) => compactCalendarText(label).toLowerCase());
  const shortcutItems = Array.from(popup.querySelectorAll("li.eds-date-shortcut-item,li[class*='shortcut' i]"));
  const candidates = uniqueElements([...shortcutItems, ...Array.from(popup.querySelectorAll("button,[role='button'],li,div,span"))]);
  for (const el of candidates) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    const text = compactCalendarText(el.textContent || "");
    if (!text || text.length > 120) continue;
    const lower = text.toLowerCase();
    if (normalized.some((label) => lower === label || lower.startsWith(label))) {
      triggerCalendarClick(nearestClickableForCalendar(el) || el);
      return true;
    }
  }
  return false;
}

function findCalendarDateInPage(isoDate) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return { found: false, selector: "", text: "", rect: null };
  const [, month, day] = String(isoDate).split("-").map(Number);
  const currentMonth = findCalendarCurrentMonthNumber(popup);
  if (currentMonth && currentMonth !== month) return { found: false, selector: "", text: "", rect: null };
  const dayText = String(day);
  const cells = collectCalendarDateCellElements(popup);
  for (const cell of cells) {
    const text = compactCalendarText(cell.textContent || "");
    const className = String(cell.className || "");
    if (text !== dayText || calendarDisabled(cell) || /out-of-month/i.test(className)) continue;
    return {
      found: true,
      selector: cssPathForCalendar(cell),
      text,
      rect: calendarBox(cell)
    };
  }
  return { found: false, selector: "", text: "", rect: null };
}

function clickCalendarDateInPage(isoDate) {
  const target = findCalendarDateInPage(isoDate);
  if (!target.found) return false;
  const cell = document.querySelector(target.selector);
  if (!cell) return false;
  triggerCalendarClick(nearestClickableForCalendar(cell) || cell);
  return true;
}

function findCalendarMonthInPage(isoDate) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return { found: false, alreadySelected: false, selector: "", text: "", rect: null };
  const [, targetMonth] = String(isoDate).split("-").map(Number);
  const currentMonth = findCalendarCurrentMonthNumber(popup);
  if (currentMonth && currentMonth === targetMonth) {
    return { found: true, alreadySelected: true, selector: cssPathForCalendar(popup), text: findCalendarCurrentMonth(popup), rect: calendarBox(popup) };
  }
  const labels = calendarMonthLabels(targetMonth);
  for (const el of Array.from(popup.querySelectorAll("button,[role='button'],td,div,span"))) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    const text = compactCalendarText(el.textContent || "");
    if (!labels.some((label) => text.toLowerCase() === label)) continue;
    const target = nearestClickableForCalendar(el) || el;
    return {
      found: true,
      alreadySelected: false,
      selector: cssPathForCalendar(target),
      text: compactCalendarText(target.textContent || text),
      rect: calendarBox(target)
    };
  }
  return { found: false, alreadySelected: false, selector: "", text: "", rect: null };
}

function clickCalendarMonthInPage(isoDate) {
  const target = findCalendarMonthInPage(isoDate);
  if (!target.found || target.alreadySelected) return Boolean(target.alreadySelected);
  const cell = document.querySelector(target.selector);
  if (!cell) return false;
  triggerCalendarClick(nearestClickableForCalendar(cell) || cell);
  return true;
}

function navigateCalendarMonthInPage(isoDate) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return false;
  const [targetYear, targetMonth] = String(isoDate).split("-").map(Number);
  const current = findCalendarCurrentMonthInfo(popup);
  if (!current) return false;
  const distance = monthDistance(current.year, current.month, targetYear, targetMonth);
  if (distance === 0) return true;
  const direction = distance > 0 ? "next" : "prev";
  const button = findCalendarMonthNavButtonInPage(popup, direction);
  if (!button) return false;
  triggerCalendarClick(button);
  return true;
}

function findCalendarMonthNavTargetInPage(isoDate) {
  const popup = locateCalendarPopupInPage();
  if (!popup) return { found: false, rect: null, direction: "", text: "" };
  const [targetYear, targetMonth] = String(isoDate).split("-").map(Number);
  const current = findCalendarCurrentMonthInfo(popup);
  if (!current) return { found: false, rect: null, direction: "", text: "" };
  const distance = monthDistance(current.year, current.month, targetYear, targetMonth);
  if (distance === 0) return { found: true, rect: calendarBox(popup), direction: "current", text: findCalendarCurrentMonth(popup) };
  const direction = distance > 0 ? "next" : "prev";
  const button = findCalendarMonthNavButtonInPage(popup, direction);
  return button ? { found: true, rect: calendarBox(button), direction, text: compactCalendarText(button.textContent || "") } : { found: false, rect: null, direction, text: "" };
}

function findCalendarMonthNavButtonInPage(popup, direction) {
  const buttons = Array.from(popup.querySelectorAll("button,[role='button'],i,svg,span,div"))
    .filter((el) => el instanceof Element && calendarVisible(el) && !calendarDisabled(el));
  const patterns = direction === "next"
    ? [/next/i, /right/i, /forward/i, /chevron-right/i, /arrow-right/i]
    : [/prev/i, /previous/i, /left/i, /back/i, /chevron-left/i, /arrow-left/i];
  const directMatches = [];
  for (const el of buttons) {
    const meta = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("class"),
      el.getAttribute("data-testid"),
      el.getAttribute("data-cy")
    ].filter(Boolean).join(" ");
    if (patterns.some((pattern) => pattern.test(meta))) directMatches.push(el);
  }
  if (directMatches.length) {
    directMatches.sort((a, b) => {
      const left = calendarBox(a);
      const right = calendarBox(b);
      return direction === "next" ? left.x - right.x : right.x - left.x;
    });
    return directMatches[0];
  }
  const popupRect = calendarBox(popup);
  const currentMonthText = findCalendarCurrentMonth(popup);
  const monthHeader = buttons
    .map((el) => ({ el, text: compactCalendarText(el.textContent || ""), rect: calendarBox(el) }))
    .filter((item) => item.text.includes(currentMonthText) || item.text === currentMonthText)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  const headerY = monthHeader ? monthHeader.rect.y + monthHeader.rect.height / 2 : popupRect.y + Math.min(80, popupRect.height * 0.18);
  const candidates = buttons
    .map((el) => ({ el, rect: calendarBox(el), text: compactCalendarText(el.textContent || "") }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    .filter((item) => Math.abs((item.rect.y + item.rect.height / 2) - headerY) < 55)
    .filter((item) => item.text.length <= 6)
    .sort((a, b) => direction === "next" ? b.rect.x - a.rect.x : a.rect.x - b.rect.x);
  return candidates[0] ? (nearestClickableForCalendar(candidates[0].el) || candidates[0].el) : null;
}

function monthDistance(fromYear, fromMonth, toYear, toMonth) {
  return (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth);
}

function calendarMonthLabels(monthNumber) {
  const labels = {
    1: ["jan", "january", "januari"],
    2: ["feb", "february", "februari"],
    3: ["mar", "march", "maret"],
    4: ["apr", "april"],
    5: ["may", "mei"],
    6: ["jun", "june", "juni"],
    7: ["jul", "july", "juli"],
    8: ["aug", "august", "agu", "agustus"],
    9: ["sep", "sept", "september"],
    10: ["oct", "october", "okt", "oktober"],
    11: ["nov", "november"],
    12: ["dec", "december", "des", "desember"]
  };
  return labels[monthNumber] || [];
}

function clickCalendarConfirmInPage() {
  const popup = locateCalendarPopupInPage();
  if (!popup) return false;
  const labels = /^(apply|confirm|ok|done|terapkan|simpan|纭畾|纭|瀹屾垚)$/i;
  const buttons = Array.from(popup.querySelectorAll("button,[role='button']"));
  for (const button of buttons) {
    if (!(button instanceof Element) || !calendarVisible(button) || calendarDisabled(button)) continue;
    const text = compactCalendarText(button.textContent || "");
    if (labels.test(text)) {
      button.click();
      return true;
    }
  }
  return false;
}

function locateCalendarPopupInPage() {
  const menuTerms = ["Real-Time", "Yesterday", "Past 7 Days", "Past 30 Days", "By Day", "By Week", "By Month"];
  const directPickers = Array.from(document.querySelectorAll(".bi-date-picker,[class*='bi-date-picker' i]"))
    .filter((el) => el instanceof Element)
    .map((el) => ({ el, text: compactCalendarText(el.textContent || ""), area: calendarBox(el).width * calendarBox(el).height }))
    .filter((item) => item.area > 0)
    .filter((item) => menuTerms.filter((term) => item.text.toLowerCase().includes(term.toLowerCase())).length >= 2)
    .sort((left, right) => left.area - right.area);
  if (directPickers.length) return directPickers[0].el;
  const containers = [];
  const popupSelectors = [
    "[role='dialog']",
    "[role='listbox']",
    "[class*='bi-date-picker' i]",
    "[class*='date-picker' i]",
    "[class*='calendar' i]",
    "[class*='popover' i]",
    "[class*='popper' i]",
    "[class*='popup' i]",
    "[class*='dropdown' i]",
    "[class*='overlay' i]"
  ].join(",");
  for (const el of Array.from(document.querySelectorAll(popupSelectors))) {
    if (!(el instanceof Element) || !calendarVisible(el) || el === document.body) continue;
    const className = String(el.className || "");
    if (/date-export__date-picker|date-export__container|page-filters__date-picker|datacenter-container|content-container|feature-section|key-metric|eds-table|voucher|marketing/i.test(className)) continue;
    const text = compactCalendarText(el.textContent || "");
    if (!text || text.length > 2500) continue;
    const hits = menuTerms.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
    if (hits.length < 2) continue;
    const rect = calendarBox(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportWidth && rect.width > viewportWidth * 0.9) continue;
    if (viewportHeight && rect.height > viewportHeight * 0.9) continue;
    const popupLike = /bi-date-picker|date-picker|calendar|popover|popper|popup|dropdown|overlay/i.test(className)
      || ["dialog", "listbox"].includes(String(el.getAttribute("role") || "").toLowerCase());
    if (!popupLike) continue;
    let score = hits.length * 50;
    if (/bi-date-picker/i.test(className)) score += 500;
    if (/date-picker/i.test(className)) score += 120;
    if (text.toLowerCase().includes("by day")) score += 100;
    if (/calendar|popover|popper|popup|dropdown|overlay/i.test(className)) score += 30;
    if (/popover__ref/i.test(className)) score -= 80;
    if (rect.width > 150 && rect.height > 150) score += 20;
    if (rect.width > 1200 || rect.height > 900) score -= 100;
    containers.push({ el, score, area: rect.width * rect.height });
  }
  containers.sort((left, right) => right.score - left.score || left.area - right.area);
  return containers[0]?.el || null;
}

function collectCalendarMenuOptions(popup) {
  const known = ["Real-Time", "Yesterday", "Past 7 Days", "Past 30 Days", "By Day", "By Week", "By Month"];
  const found = [];
  for (const el of Array.from(popup.querySelectorAll("button,[role='button'],li,div,span"))) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    const text = compactCalendarText(el.textContent || "");
    if (known.includes(text) && !found.includes(text)) found.push(text);
  }
  return found;
}

function uniqueElements(elements) {
  return Array.from(new Set(elements));
}

function triggerCalendarClick(el) {
  if (!(el instanceof Element)) return false;
  el.scrollIntoView?.({ block: "center", inline: "center" });
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
  }
  return true;
}

function collectCalendarDateCells(popup) {
  return collectCalendarDateCellElements(popup).slice(0, 80).map((cell) => ({
    selector: cssPathForCalendar(cell),
    text: compactCalendarText(cell.textContent || ""),
    disabled: calendarDisabled(cell),
    selected: /selected|active|range/i.test(String(cell.className || "")),
    rect: calendarBox(cell)
  }));
}

function collectCalendarDateCellElements(popup) {
  const cells = [];
  for (const el of Array.from(popup.querySelectorAll("button,[role='button'],td,div,span"))) {
    if (!(el instanceof Element) || !calendarVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const text = compactCalendarText(el.textContent || "");
    if (/^(0?[1-9]|[12]\d|3[01])$/.test(text)) cells.push(el);
  }
  return cells;
}

function findCalendarCurrentMonth(popup) {
  const text = compactCalendarText(popup.textContent || "");
  const month = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Januari|Februari|Maret|Mei|Juni|Juli|Agustus|Oktober|Desember|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*20\d{2}/i);
  return month ? month[0] : "";
}

function findCalendarCurrentMonthInfo(popup) {
  const label = findCalendarCurrentMonth(popup).toLowerCase();
  const year = Number((label.match(/20\d{2}/) || [])[0]);
  const months = { january:1,jan:1,januari:1,"มกราคม":1,"ม.ค.":1,february:2,feb:2,februari:2,"กุมภาพันธ์":2,"ก.พ.":2,march:3,mar:3,maret:3,"มีนาคม":3,"มี.ค.":3,april:4,apr:4,"เมษายน":4,"เม.ย.":4,may:5,mei:5,"พฤษภาคม":5,"พ.ค.":5,june:6,jun:6,juni:6,"มิถุนายน":6,"มิ.ย.":6,july:7,jul:7,juli:7,"กรกฎาคม":7,"ก.ค.":7,august:8,aug:8,agustus:8,"สิงหาคม":8,"ส.ค.":8,september:9,sep:9,sept:9,"กันยายน":9,"ก.ย.":9,october:10,oct:10,oktober:10,"ตุลาคม":10,"ต.ค.":10,november:11,nov:11,"พฤศจิกายน":11,"พ.ย.":11,december:12,dec:12,desember:12,"ธันวาคม":12,"ธ.ค.":12 };
  for (const [name, number] of Object.entries(months)) {
    if (label.includes(name) && year) return { year, month: number };
  }
  return null;
}

function findCalendarCurrentMonthNumber(popup) {
  return findCalendarCurrentMonthInfo(popup)?.month || null;
}

function collectCalendarConfirmButtons(popup) {
  return Array.from(popup.querySelectorAll("button,[role='button']"))
    .filter((el) => el instanceof Element && calendarVisible(el))
    .map((el) => ({ selector: cssPathForCalendar(el), text: compactCalendarText(el.textContent || ""), rect: calendarBox(el) }))
    .filter((item) => /apply|confirm|ok|done|terapkan|simpan|纭畾|纭|瀹屾垚/i.test(item.text));
}

function describeCalendarDom(root) {
  const lines = [];
  const walk = (node, depth) => {
    if (!(node instanceof Element) || lines.length >= 80 || depth > 3) return;
    const text = compactCalendarText(node.textContent || "").slice(0, 80);
    lines.push(`${"  ".repeat(depth)}<${node.tagName.toLowerCase()} class="${String(node.className || "").slice(0, 80)}"> ${text}`);
    for (const child of Array.from(node.children).slice(0, 12)) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines;
}

function nearestClickableForCalendar(el) {
  let node = el;
  for (let depth = 0; node && node instanceof Element && depth < 5; depth += 1, node = node.parentElement) {
    if (node.matches("button,[role='button'],a,li")) return node;
    if (/select|dropdown|trigger|button|picker|shortcut|item/i.test(String(node.className || ""))) return node;
  }
  return null;
}

function extractDataPeriodLabel(text) {
  const byDay = text.match(/By Day\s*(\d{1,2}[./-]\d{1,2}[./-]20\d{2}|\d{4}[./-]\d{1,2}[./-]\d{1,2})(?:\s*\(GMT[+-]\d{2}\))?/i);
  if (byDay) return compactCalendarText(byDay[0]);
  const match = text.match(/(Today Until[^]*?\(GMT[+-]\d{2}\)|Today Until[^]*?$|Yesterday|Past 7 Days|Past 30 Days|Real-Time)/i);
  return match ? compactCalendarText(match[0]) : compactCalendarText(text);
}

function calendarVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const hasBox = rect.width > 0 && rect.height > 0;
  const picker = el.closest?.(".bi-date-picker");
  const pickerRect = picker?.getBoundingClientRect?.();
  const inVisibleCalendar = Boolean(pickerRect && pickerRect.width > 0 && pickerRect.height > 0);
  return (hasBox || inVisibleCalendar) && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function calendarDisabled(el) {
  return Boolean(el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/i.test(String(el.className || "")));
}

function calendarBox(el) {
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function cssPathForCalendar(el) {
  if (!(el instanceof Element)) return "";
  const parts = [];
  let node = el;
  while (node && node instanceof Element && node !== document.body && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${String(node.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      parts.unshift(part);
      break;
    }
    const classNames = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 2);
    if (classNames.length) part += `.${classNames.map((name) => name.replace(/[^a-zA-Z0-9_-]/g, "_")).join(".")}`;
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((item) => item.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function compactCalendarText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assertPreflight(preflight, task, realExport) {
  if (!matchesPage(preflight.url, preflight.title, task.country, task.module)) {
    throw new UserFacingError(`褰撳墠椤甸潰涓嶆槸 ${task.country.name} -> ${task.module.name}銆俙`);
  }
  if (!preflight.pageReady) throw new UserFacingError("椤甸潰灏氭湭瀹屽叏鍔犺浇锛岃绛夊緟椤甸潰鍔犺浇瀹屾垚鍚庨噸璇曘€?");
  if (!preflight.loginDetected) throw new UserFacingError("褰撳墠椤甸潰鐪嬭捣鏉ユ湭鐧诲綍锛岃鍏堝湪娴忚鍣ㄤ腑瀹屾垚鐧诲綍銆?");
  if (!preflight.exportButtonDetected) throw new UserFacingError("鏈娴嬪埌 Export Data 鎸夐挳銆?");
  if (!preflight.exportButtonEnabled) throw new UserFacingError("Export Data 鎸夐挳涓嶅彲鐐瑰嚮銆?");
  if (!preflight.dataPeriod?.found) throw new UserFacingError("鏈娴嬪埌 Data Period 鏃ユ湡鎸夐挳銆?");
  return;
  if (!matchesPage(preflight.url, preflight.title, task.country, task.module)) {
    throw new UserFacingError(`褰撳墠椤甸潰涓嶆槸 ${task.country.name} -> ${task.module.name}銆俙`);
  }
  if (!preflight.pageReady) throw new UserFacingError("椤甸潰灏氭湭瀹屽叏鍔犺浇锛岃绛夊緟椤甸潰鍔犺浇瀹屾垚鍚庨噸璇曘€?");
  if (!preflight.loginDetected) throw new UserFacingError("褰撳墠椤甸潰鐪嬭捣鏉ユ湭鐧诲綍锛岃鍏堝湪娴忚鍣ㄤ腑瀹屾垚鐧诲綍銆?");
  if (!preflight.exportButtonDetected) throw new UserFacingError("鏈娴嬪埌 Export Data 鎸夐挳銆?");
  if (!preflight.exportButtonEnabled) throw new UserFacingError("Export Data 鎸夐挳涓嶅彲鐐瑰嚮銆?");
  if (!preflight.detectedDate) throw new UserFacingError("椤甸潰鏃ユ湡涓嶅彲璇诲彇锛岃纭椤甸潰鏃ユ湡鎺т欢宸叉樉绀恒€?");
  if (!preflight.dateMatched) {
    const message = `褰撳墠鏃ユ湡: ${formatDateRange(preflight.detectedDate)}\n璇锋眰鏃ユ湡: ${formatDateRange(task.dateRange)}\n璇峰厛鎵嬪姩鍒囨崲椤甸潰鏃ユ湡銆俙`;
    if (realExport) throw new UserFacingError(message);
    console.log(`WARNING: ${message}`);
  }
}
async function prepareModuleSubview(page, task, options = {}) {
  const section = task.module?.adsSection;
  if (!section) return { skipped: true };
  if (!options.apply) return { skipped: false, section: section.name || section.key };
  let urlQueryMatched = false;
  if (section.urlQuery && typeof section.urlQuery === "object") {
    const changed = await applyAdsSectionUrlQuery(page, section.urlQuery);
    if (changed) {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(1200);
    }
    urlQueryMatched = await pageUrlQueryMatches(page, section.urlQuery);
  }
  const labels = Array.isArray(section.tabLabels) && section.tabLabels.length ? section.tabLabels : [section.name || section.key].filter(Boolean);
  if (!labels.length) return { skipped: true };
  try {
    await clickAdsSectionTab(page, labels);
  } catch (error) {
    if (!urlQueryMatched) throw error;
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(1200);
  return { skipped: false, section: section.name || section.key };
}

async function applyAdsSectionUrlQuery(page, query) {
  const nextUrl = await page.evaluate((query) => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const [key, value] of Object.entries(query || {})) {
      const nextValue = String(value);
      if (url.searchParams.get(key) !== nextValue) {
        url.searchParams.set(key, nextValue);
        changed = true;
      }
    }
    return changed ? url.href : null;
  }, query);
  if (!nextUrl) return false;
  await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  return true;
}

async function pageUrlQueryMatches(page, query) {
  return await page.evaluate((query) => {
    const url = new URL(window.location.href);
    return Object.entries(query || {}).every(([key, value]) => url.searchParams.get(key) === String(value));
  }, query).catch(() => false);
}

async function clickAdsSectionTab(page, labels) {
  const clicked = await page.evaluate(({ labels }) => {
    const normalized = labels.map((label) => normalize(label)).filter(Boolean);
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a,li,div,span"))
      .filter((el) => el instanceof Element && isVisible(el))
      .map((el) => ({ el, text: normalize(el.textContent || ""), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text && item.text.length <= 80)
      .filter((item) => normalized.some((label) => item.text === label || item.text.includes(label)))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    const target = candidates[0]?.el;
    if (!target) return false;
    target.click();
    return true;
    function normalize(value) { return String(value || "").replace(/\s+/g, " ").trim().toLowerCase(); }
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    }
  }, { labels });
  if (!clicked) throw new UserFacingError("Shopee Ads section was not found: " + labels.join(" / ") + ". Please confirm the page or adjust the request.");
}



async function clickByLabels(page, labels, fallbackName) {
  const target = await page.evaluate(({ labels, fallbackName }) => {
    const normalizedLabels = labels.map(normalize).filter(Boolean);
    const submenuMode = normalizedLabels.some((label) => /\b(data|report)\b/.test(label)) || /\b(data|report)\b/i.test(String(fallbackName || ""));
    const selectors = submenuMode
      ? "li.eds-dropdown-item,[role='menuitem'],button,[role='button'],a"
      : "button,[role='button'],a,li.eds-dropdown-item,[role='menuitem']";
    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter((el) => el instanceof Element && isVisible(el))
      .map((el) => ({ el, text: normalize(el.textContent || ""), rect: el.getBoundingClientRect() }))
      .filter((item) => item.text && item.text.length <= 240)
      .filter((item) => normalizedLabels.some((label) => item.text === label || item.text.startsWith(label) || item.text.includes(label)))
      .sort((a, b) => clickCandidateScore(a, normalizedLabels, submenuMode) - clickCandidateScore(b, normalizedLabels, submenuMode));
    const item = candidates[0];
    if (!item) return null;
    return { x: item.rect.left + item.rect.width / 2, y: item.rect.top + item.rect.height / 2 };
    function clickCandidateScore(item, labels, submenuMode) {
      const tag = item.el.tagName.toLowerCase();
      const cls = String(item.el.className || "");
      const area = item.rect.width * item.rect.height;
      const exact = labels.includes(item.text) ? 0 : 100000;
      const starts = labels.some((label) => item.text.startsWith(label)) ? 0 : 10000;
      const menuBoost = submenuMode && (tag === "li" || cls.includes("dropdown-item") || item.el.getAttribute("role") === "menuitem") ? -5000 : 0;
      const buttonBoost = !submenuMode && (tag === "button" || item.el.getAttribute("role") === "button") ? -5000 : 0;
      return exact + starts + area + menuBoost + buttonBoost;
    }
    function normalize(value) {
      return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    }
  }, { labels, fallbackName });
  if (!target) throw new UserFacingError("Clickable target was not found: " + fallbackName + ".");
  await page.mouse.click(target.x, target.y);
}

function adsExportSubmenuLabels(module) {
  if (module?.adsSection) {
    return Array.isArray(module.adsSection.exportSubmenuLabels) ? module.adsSection.exportSubmenuLabels : [];
  }
  return Array.isArray(module?.exportSubmenuLabels) ? module.exportSubmenuLabels : [];
}

function isDirectDownloadModule(module) {
  const mode = String(module?.downloadMode || "").toLowerCase();
  return mode === "direct" || mode === "adssubmenu";
}

function isAdsDownloadModule(module) {
  return String(module?.downloadMode || "").toLowerCase() === "adssubmenu";
}

function isUrlDateModule(module) {
  return String(module?.dateMode || "").toLowerCase() === "urlquery";
}

function isPageDefaultDateModule(module) {
  return String(module?.dateMode || "").toLowerCase() === "pagedefaultlast30";
}

function isExportManagementModule(module) {
  return String(module?.downloadMode || "").toLowerCase() === "exportmanagement";
}


async function clickExportAndWaitForExportManagementDownload(page, exportLabels, config, expectedDateRange = null, minMtimeMs = Date.now(), profile = null, module = null) {
  const timing = officialExportTiming(config);
  const deadline = Date.now() + timing.latestReportsTimeoutMs;
  const fallbackDirs = await resolveFallbackDownloadDirs(config, profile);

  await clickByLabels(page, exportLabels, "Export");
  const ready = await waitForExportManagementReady(page, deadline);
  if (!ready) throw new UserFacingError("Affiliate export page did not show a downloadable file. Please confirm the page is opened, or adjust the request.");

  const downloadTimeoutMs = Math.min(60000, Math.max(5000, deadline - Date.now()));
  const downloadDeadline = Date.now() + downloadTimeoutMs;
  const downloadPromise = page.waitForEvent("download", { timeout: downloadTimeoutMs }).catch(() => null);
  const clicked = await clickExportManagementDownload(page);
  if (!clicked) throw new UserFacingError("Download button was not found on the latest export row. Please confirm the export page is ready or change the request.");

  while (Date.now() < downloadDeadline) {
    const waitMs = Math.min(3000, Math.max(0, downloadDeadline - Date.now()));
    const download = await Promise.race([downloadPromise, sleep(waitMs).then(() => null)]);
    if (download) return download;
    const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { allowLooseRecent: true, module });
    if (fallback) return fallback;
  }

  const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { allowLooseRecent: true, module });
  if (fallback) return fallback;
  throw new UserFacingError("Affiliate export page download timed out.");
}

async function waitForExportManagementReady(page, deadline) {
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      if (!/export management/i.test(text) && !/affiliate marketing solution/i.test(text) && !/export/i.test(text)) return null;
      const rows = Array.from(document.querySelectorAll('tr,[role="row"]'))
        .map((row) => ({ row, text: (row.textContent || '').replace(/\s+/g, ' ').trim() }))
        .filter((item) => /sellerconversionreport|conversionreport/i.test(item.text));
      const latest = rows[0];
      if (!latest) return null;
      if (/processing|pending|queue|loading|running/i.test(latest.text)) return null;
      const button = Array.from(latest.row.querySelectorAll('button,a,[role="button"]')).find((el) => /download/i.test((el.textContent || '').trim()) && isVisible(el));
      if (!button) return null;
      return { rowText: latest.text };

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      }
    }).catch(() => null);
    if (ready) return ready;
    await page.waitForTimeout(2000);
  }
  return null;
}

async function clickExportManagementDownload(page) {
  const rows = page.locator('tr', { hasText: /SellerConversionReport|ConversionReport/i });
  const count = await rows.count().catch(() => 0);
  if (!count) return null;
  const row = rows.first();
  const button = row.getByRole('button', { name: /download/i }).first();
  await button.click({ timeout: 10000, force: true });
  const rowText = await row.innerText({ timeout: 1000 }).catch(() => "");
  return { rowText };
}

async function clickExportAndWaitForDirectDownload(page, exportLabels, config, expectedDateRange = null, minMtimeMs = Date.now(), profile = null, module = null) {
  if (isAdsDownloadModule(module)) return await clickAdsExportJobAndDownload(page, exportLabels, config, expectedDateRange, profile, module);
  const timing = officialExportTiming(config);
  const deadline = Date.now() + timing.latestReportsTimeoutMs;
  const fallbackDirs = await resolveFallbackDownloadDirs(config, profile);
  const retryExportClickIntervalMs = Math.max(1000, Number(timing.retryExportClickIntervalMs || 10000));
  let retryExportClickCount = 0;

  let lastClickAt = 0;
  await clickExport();
  while (Date.now() < deadline) {
    const remainingMs = Math.max(0, deadline - Date.now());
    const waitMs = Math.min(retryExportClickIntervalMs, remainingMs);
    const download = await page.waitForEvent("download", { timeout: waitMs }).catch(() => null);
    if (download) return download;

    const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { allowLooseRecent: true, module });
    if (fallback) return fallback;

    const terminalError = await inspectDirectExportTerminalError(page);
    if (terminalError) throw new UserFacingError(terminalError);

    if (Date.now() - lastClickAt >= retryExportClickIntervalMs) {
      retryExportClickCount += 1;
      console.log(`Direct download not ready yet; retry Export Data (${retryExportClickCount})`);
      await clickExport().catch(() => null);
    }
  }

  const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { allowLooseRecent: true, module });
  if (fallback) return fallback;
  throw new UserFacingError("Direct Export Data download timed out.");

  async function clickExport() {
    await clickByLabels(page, exportLabels, "Export Data");
    const submenuLabels = adsExportSubmenuLabels(module);
    const submenuName = module?.adsSection?.exportSubmenuName || module?.exportSubmenuName || (Array.isArray(submenuLabels) ? submenuLabels.join(" / ") : "Export submenu");
    if (Array.isArray(submenuLabels) && submenuLabels.length) {
      await page.waitForTimeout(500);
      await clickByLabels(page, submenuLabels, submenuName);
    }
    lastClickAt = Date.now();
  }
}


async function clickAdsExportJobAndDownload(page, exportLabels, config, expectedDateRange = null, profile = null, module = null) {
  const timing = officialExportTiming(config);
  const deadline = Date.now() + timing.latestReportsTimeoutMs;
  const retryExportClickIntervalMs = Math.max(1000, Number(timing.retryExportClickIntervalMs || 10000));
  let retryExportClickCount = 0;
  let trigger = null;

  while (Date.now() < deadline && !trigger?.exportId) {
    trigger = await triggerAdsExportJob(page, exportLabels, module, retryExportClickIntervalMs);
    if (trigger?.exportId) break;
    const latestReport = await findAdsLatestReportJob(page, expectedDateRange);
    if (latestReport?.exportId) {
      return await downloadAdsExportJob(page, latestReport.trigger, latestReport.job, expectedDateRange, profile, module);
    }
    retryExportClickCount += 1;
    console.log("Ads export job not created yet; retry Export Data (" + retryExportClickCount + ")");
    await sleep(retryExportClickIntervalMs);
  }
  if (!trigger?.exportId) throw new UserFacingError("Shopee Ads export job was not created.");

  const job = await waitForAdsExportJobSuccess(page, trigger, deadline);
  return await downloadAdsExportJob(page, trigger, job, expectedDateRange, profile, module);
}

async function triggerAdsExportJob(page, exportLabels, module, responseTimeoutMs) {
  const apiReportType = module?.adsSection?.apiReportType || module?.apiReportType;
  if (apiReportType) {
    try {
      const apiTrigger = await triggerAdsExportJobByApi(page, apiReportType);
      if (apiTrigger) return apiTrigger;
    } catch (error) {
      console.log(`Ads API trigger failed; fallback to visible export flow: ${error?.message || String(error)}`);
    }
  }

  const triggerResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && response.url().includes("/api/pas/v1/report/export_job/trigger/");
  }, { timeout: responseTimeoutMs }).catch(() => null);

  await clickByLabels(page, exportLabels, "Export Data");
  const submenuLabels = adsExportSubmenuLabels(module);
  const submenuName = module?.adsSection?.exportSubmenuName || module?.exportSubmenuName || (Array.isArray(submenuLabels) ? submenuLabels.join(" / ") : "Export submenu");
  if (Array.isArray(submenuLabels) && submenuLabels.length) {
    await clickExportSubmenuWithRetry(page, exportLabels, submenuLabels, submenuName);
  }

  const response = await triggerResponsePromise;
  if (!response) return null;
  const body = await response.json().catch(() => null);
  if (body?.code !== 0) {
    const message = body?.msg || body?.debug_detail || "Shopee Ads export job trigger failed.";
    if (/too\s*frequent|please\s*wait|try\s*again|sering|tunggu/i.test(message)) return null;
    throw new UserFacingError(message);
  }
  const exportId = body?.data?.export_id;
  if (!exportId) return null;
  const requestBody = safeJsonParse(response.request().postData() || "{}") || {};
  return { exportId, triggerUrl: response.url(), requestBody };
}

async function triggerAdsExportJobByApi(page, reportType) {
  const result = await page.evaluate(async ({ reportType }) => {
    const pageUrl = new URL(window.location.href);
    const startTime = Number(pageUrl.searchParams.get("from"));
    const endTime = Number(pageUrl.searchParams.get("to"));
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return { error: "Shopee Ads URL is missing from/to." };
    }
    const triggerUrl = resolveAdsExportApiUrl("export_job/trigger/");
    const requestBody = {
      language: "en",
      report_type: reportType,
      start_time: startTime,
      end_time: endTime
    };
    const response = await fetch(triggerUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    return {
      status: response.status,
      url: response.url,
      body: await response.text(),
      requestBody
    };

    function resolveAdsExportApiUrl(endpoint) {
      const entries = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("/api/pas/v1/report/") && name.includes("SPC_CDS"));
      const current = new URL(window.location.href);
      const currentCds = current.searchParams.get("SPC_CDS");
      const currentCdsVer = current.searchParams.get("SPC_CDS_VER");
      if (currentCds) {
        const url = new URL("/api/pas/v1/report/" + endpoint, window.location.origin);
        url.searchParams.set("SPC_CDS", currentCds);
        if (currentCdsVer) url.searchParams.set("SPC_CDS_VER", currentCdsVer);
        return url.href;
      }
      const seed = entries[entries.length - 1];
      if (seed) {
        const url = new URL(seed);
        url.pathname = "/api/pas/v1/report/" + endpoint;
        return url.href;
      }
      return new URL("/api/pas/v1/report/" + endpoint, window.location.origin).href;
    }
  }, { reportType });

  if (result?.error) throw new UserFacingError(result.error);
  const body = safeJsonParse(result?.body || "{}");
  if (body?.code !== 0) {
    const message = body?.msg || body?.debug_detail || "Shopee Ads export job trigger failed.";
    if (/too\s*frequent|please\s*wait|try\s*again|sering|tunggu/i.test(message)) return null;
    throw new UserFacingError(message);
  }
  const exportId = body?.data?.export_id;
  if (!exportId) return null;
  return { exportId, triggerUrl: result.url, requestBody: result.requestBody };
}

async function clickExportSubmenuWithRetry(page, exportLabels, submenuLabels, submenuName) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 900 : 1200);
    try {
      await clickByLabels(page, submenuLabels, submenuName);
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press("Escape").catch(() => null);
      await page.waitForTimeout(300);
      await clickByLabels(page, exportLabels, "Export Data").catch(() => null);
    }
  }
  throw lastError || new UserFacingError("Clickable target was not found: " + submenuName + ".");
}

async function findAdsLatestReportJob(page, expectedDateRange = null) {
  const dateToken = adsReportDateToken(expectedDateRange);
  const result = await page.evaluate(async ({ dateToken }) => {
    const entries = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes("/api/pas/v1/report/") && name.includes("SPC_CDS"));
    const seed = entries.find((name) => name.includes("/export_job/list_homepage_result/"))
      || entries.find((name) => name.includes("/export_job/"))
      || entries[entries.length - 1];
    if (!seed) return null;
    const listUrl = new URL(seed);
    listUrl.pathname = "/api/pas/v1/report/export_job/list_homepage_result/";
    const response = await fetch(listUrl.href, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }).catch(() => null);
    if (!response) return null;
    const body = await response.json().catch(() => null);
    if (body?.code !== 0 || !Array.isArray(body?.data)) return null;
    const jobs = body.data
      .filter((job) => job?.export_id && (!dateToken || String(job.file_name || "").includes(dateToken)))
      .filter((job) => job.status === "success" || Number(job.progress) >= 100)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    const job = jobs[0];
    if (!job) return null;
    return { listUrl: listUrl.href, job };
  }, { dateToken }).catch(() => null);
  const job = result?.job;
  if (!job?.export_id) return null;
  return {
    trigger: { exportId: job.export_id, triggerUrl: result.listUrl, requestBody: {} },
    job: { ...job, export_id: job.export_id },
    exportId: job.export_id
  };
}

function adsReportDateToken(range) {
  if (!range?.start || !range?.end) return "";
  return `${adsReportDatePart(range.start)}-${adsReportDatePart(range.end)}`;
}

function adsReportDatePart(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(isoDate || "");
}

async function waitForAdsExportJobSuccess(page, trigger, deadline) {
  const urls = adsExportApiUrls(trigger.triggerUrl);
  while (Date.now() < deadline) {
    const job = await page.evaluate(async ({ listUrl, singleUrl, exportId }) => {
      async function post(url, body) {
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {})
        });
        return await response.json();
      }
      const single = await post(singleUrl, { export_id: exportId }).catch(() => null);
      let job = single?.data || null;
      if (!job || !job.status) {
        const list = await post(listUrl, {}).catch(() => null);
        job = Array.isArray(list?.data) ? list.data.find((item) => Number(item.export_id) === Number(exportId)) : null;
      }
      return job || null;
    }, { ...urls, exportId: trigger.exportId });

    if (job?.status === "success" || Number(job?.progress) >= 100) return job;
    if (job?.status && /fail|error/i.test(String(job.status))) throw new UserFacingError("Shopee Ads export job failed: " + job.status);
    await sleep(3000);
  }
  throw new UserFacingError("Shopee Ads export job timed out.");
}

async function downloadAdsExportJob(page, trigger, job, expectedDateRange = null, profile = null, module = null) {
  const urls = adsExportApiUrls(trigger.triggerUrl);
  const payload = await page.evaluate(async ({ getDownloadUrl, exportId }) => {
    const urlResponse = await fetch(getDownloadUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ export_id: exportId })
    });
    const urlBody = await urlResponse.json();
    if (urlBody?.code !== 0 || !urlBody?.data?.download_url) {
      throw new Error(urlBody?.msg || "download_url missing");
    }
    const downloadUrl = new URL(urlBody.data.download_url, window.location.origin).href;
    const fileResponse = await fetch(downloadUrl, { method: "GET", credentials: "include" });
    if (!fileResponse.ok) throw new Error("direct_download HTTP " + fileResponse.status);
    const buffer = await fileResponse.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return {
      base64: btoa(binary),
      contentDisposition: fileResponse.headers.get("content-disposition"),
      contentType: fileResponse.headers.get("content-type"),
      downloadUrl
    };
  }, { ...urls, exportId: trigger.exportId });

  const filename = filenameFromContentDisposition(payload.contentDisposition)
    || String(job?.file_name || "Shopee-Ads-Export.csv").replace(/[\\/]+/g, "_");
  const buffer = Buffer.from(payload.base64, "base64");
  if (!buffer.length) throw new UserFacingError("Shopee Ads direct download returned an empty file.");
  return createMemoryDownload(buffer, filename);
}

function adsExportApiUrls(triggerUrl) {
  const url = new URL(triggerUrl);
  const base = url.origin + "/api/pas/v1/report/export_job";
  return {
    listUrl: base + "/list_homepage_result/" + url.search,
    singleUrl: base + "/get_single_result/" + url.search,
    getDownloadUrl: base + "/get_download_url/" + url.search
  };
}

function createMemoryDownload(buffer, filename) {
  return {
    suggestedFilename: () => filename,
    saveAs: async (targetPath) => {
      await writeFile(targetPath, buffer);
    },
    failure: async () => null
  };
}

function filenameFromContentDisposition(value) {
  const text = String(value || "");
  const utf8 = text.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const quoted = text.match(/filename="?([^";]+)"?/i);
  return quoted ? quoted[1] : null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function inspectDirectExportTerminalError(page) {
  try {
    const message = await page.evaluate(() => {
      const terminalPatterns = [
        /download\s+failed/i,
        /export\s+failed/i,
        /failed\s+to\s+(download|export)/i,
        /try\s+again\s+later/i,
        /network\s+error/i,
        /瀵煎嚭澶辫触|涓嬭浇澶辫触|鐢熸垚澶辫触|缃戠粶閿欒/,
        /gagal\s+(mengunduh|mengekspor|ekspor|download)/i,
        /(muat\s*turun|eksport|export)\s+gagal/i
      ];
      const transientPatterns = [
        /too\s+frequent/i,
        /please\s+wait/i,
        /try\s+again\s+in/i,
        /terlalu\s+sering/i,
        /sila\s+tunggu/i,
        /璇风◢鍚巪杩囦簬棰戠箒|棰戠箒|绋嶅悗鍐嶈瘯/
      ];
      const selectors = [
        ".eds-toast",
        ".eds-message",
        ".eds-notification",
        ".eds-dialog",
        ".shopee-toast",
        "[role='alert']",
        "[class*='toast' i]",
        "[class*='message' i]",
        "[class*='notification' i]",
        "[class*='error' i]"
      ].join(",");
      const candidates = Array.from(document.querySelectorAll(selectors));
      for (const el of candidates) {
        if (!(el instanceof Element) || !isVisible(el)) continue;
        const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 300) continue;
        if (transientPatterns.some((pattern) => pattern.test(text))) continue;
        if (terminalPatterns.some((pattern) => pattern.test(text))) return text;
      }
      return "";

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
      }
    });
    return message ? `Direct Export Data stopped after page error: ${message}` : "";
  } catch {
    return "";
  }
}

async function openLatestReports(page, labels) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const alreadyOpen = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ");
      return /Latest Reports/i.test(text) && /Report name/i.test(text) && /Download/i.test(text);
    }).catch(() => false);
    if (alreadyOpen) return;

    const clicked = await page.evaluate(({ labels }) => {
      const re = new RegExp(labels.map(escapeRegExp).join("|"), "i");
      const candidates = Array.from(document.querySelectorAll("button,[role='button'],a,div.latest,span"));
      const target = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        return rect.width > 0 && rect.height > 0 && text.length < 120 && re.test(text);
      });
      if (!target) return false;
      target.click();
      return true;

      function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }, { labels });
    if (clicked) return;
    await page.waitForTimeout(2000);
  }
  throw new UserFacingError("鏈壘鍒?Latest Reports 鍏ュ彛銆?");
}

async function waitForWorkbookDownload(page, labels, config, expectedDateRange = null, minMtimeMs = Date.now(), exportLabels = [], profile = null, module = null) {
  const timing = officialExportTiming(config);
  if (timing.latestReportsInitialWaitMs > 0) {
    console.log(`绛夊緟鎶ヨ〃鐢熸垚 ${Math.round(timing.latestReportsInitialWaitMs / 1000)}s 鍚庡紑濮嬫鏌?..`);
    await page.waitForTimeout(timing.latestReportsInitialWaitMs);
  }

  const deadline = Date.now() + timing.latestReportsTimeoutMs;
  const dateTokens = expectedDateRange ? buildReportDateTokens(expectedDateRange) : null;
  const fallbackDirs = await resolveFallbackDownloadDirs(config, profile);
  const retryExportClickIntervalMs = Math.max(1000, Number(timing.retryExportClickIntervalMs || 10000));
  let nextRetryExportClickAt = Date.now() + retryExportClickIntervalMs;
  let retryExportClickCount = 0;
  while (Date.now() < deadline) {
    const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { module });
    if (fallback) return fallback;

    const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    const clicked = await page.evaluate(({ labels, dateTokens }) => {
      const re = new RegExp(labels.map(escapeRegExp).join("|"), "i");
      const buttons = Array.from(document.querySelectorAll("button,[role='button'],a"))
        .filter((el) => re.test(el.textContent || "") && isVisible(el));
      let target = null;
      if (dateTokens) {
        const rows = Array.from(document.querySelectorAll("tr,[role='row'],li,div"))
          .map((row) => {
            const button = buttons.find((item) => row !== item && row.contains(item));
            if (!button) return null;
            const text = normalizeForDateMatch(row.textContent || "");
            const rect = row.getBoundingClientRect();
            const startMatched = dateTokens.start.some((token) => text.includes(token));
            const endMatched = dateTokens.end.some((token) => text.includes(token));
            if (!startMatched || !endMatched || rect.width <= 0 || rect.height <= 0) return null;
            return { row, button, area: rect.width * rect.height, textLength: text.length };
          })
          .filter(Boolean)
          .sort((a, b) => a.area - b.area || a.textLength - b.textLength);
        target = rows[0]?.button || null;
      } else {
        target = buttons[0] || null;
      }
      if (!target) return false;
      target.click();
      return true;

      function isVisible(el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function normalizeForDateMatch(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      }

      function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }, { labels, dateTokens });
    if (clicked) {
      const download = await downloadPromise;
      if (download) return download;
      const fallbackAfterClick = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { module });
      if (fallbackAfterClick) return fallbackAfterClick;
    }
    if (exportLabels.length && Date.now() >= nextRetryExportClickAt) {
      retryExportClickCount += 1;
      console.log(`Latest Reports no downloadable file yet; retry Export Data (${retryExportClickCount})`);
      await clickByLabels(page, exportLabels, "Export Data").catch(() => null);
      nextRetryExportClickAt = Date.now() + retryExportClickIntervalMs;
    }
    await page.waitForTimeout(1000);
  }
  const fallback = await findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, fallbackDirs, { module });
  if (fallback) return fallback;
  throw new UserFacingError("绛夊緟 Latest Reports 鐢熸垚骞朵笅杞借秴鏃躲€?");
}

async function findFallbackWorkbookDownload(config, expectedDateRange, minMtimeMs, resolvedDirs = null, options = {}) {
  if (!expectedDateRange) return null;
  const dirs = resolvedDirs || await resolveFallbackDownloadDirs(config);
  if (!dirs.length) return null;
  const slug = rangeSlug(expectedDateRange).toLowerCase();
  const allowLooseRecent = Boolean(options.allowLooseRecent);
  const filenameHints = fallbackFilenameHints(options.module);
  const candidates = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filename = entry.name;
        const allowCsv = isAdsDownloadModule(options.module) || isExportManagementModule(options.module);
        const allowedFile = allowCsv ? /\.(xlsx|xls|csv)$/i.test(filename) : /\.(xlsx|xls)$/i.test(filename);
        if (!allowedFile) continue;
        if (filenameHints.length && !filenameMatchesHints(filename, filenameHints)) continue;
        const filePath = path.join(dir, filename);
        const info = await stat(filePath);
        if (info.mtimeMs < minMtimeMs - 5000) continue;
        const matchedDateSlug = filenameMatchesExpectedRange(filename, expectedDateRange) || filename.toLowerCase().includes(slug);
        if (!matchedDateSlug && filenameHasExplicitDateRange(filename) && !allowLooseRecent) continue;
        if (!matchedDateSlug && !allowLooseRecent) continue;
        candidates.push({ filePath, mtimeMs: info.mtimeMs, matchedDateSlug });
      }
    } catch {
      // Ignore unavailable fallback directories.
    }
  }
  candidates.sort((a, b) => Number(b.matchedDateSlug) - Number(a.matchedDateSlug) || b.mtimeMs - a.mtimeMs);
  if (!candidates[0]) return null;
  console.log(`妫€娴嬪埌娴忚鍣ㄥ凡涓嬭浇鏂囦欢: ${candidates[0].filePath}`);
  return createFallbackDownload(candidates[0].filePath);
}

function fallbackFilenameHints(module) {
  if (Array.isArray(module?.fallbackFilenameHints)) {
    return module.fallbackFilenameHints.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function filenameMatchesHints(filename, hints) {
  const lower = String(filename || "").toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

function filenameMatchesExpectedRange(filename, range) {
  if (!range?.start || !range?.end) return false;
  const dates = filenameDateTokens(filename);
  const start = range.start.replaceAll("-", "");
  const end = range.end.replaceAll("-", "");
  if (dates.length >= 2) return dates[0] === start && dates[1] === end;
  if (dates.length === 1 && start === end) return dates[0] === start;
  return false;
}

function filenameHasExplicitDateRange(filename) {
  return filenameDateTokens(filename).length > 0;
}

function filenameDateTokens(filename) {
  const text = String(filename || "");
  const compact = text.match(/20\d{6}/g) || [];
  const underscored = Array.from(text.matchAll(/\b(\d{2})_(\d{2})_(20\d{2})\b/g)).map((match) => match[3] + match[2] + match[1]);
  return [...compact, ...underscored];
}

async function resolveFallbackDownloadDirs(config, profile = null) {
  const profileDirs = profile?.userId && config?.output?.profileFallbackDownloadDirs?.[profile.userId];
  if (Array.isArray(profileDirs) && profileDirs.length) {
    return profileDirs.filter(Boolean);
  }
  const configured = Array.isArray(config?.output?.fallbackDownloadDirs) ? config.output.fallbackDownloadDirs : [];
  const dirs = new Set(configured.filter(Boolean));
  try {
    const entries = await readdir("D:\\", { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^adspower涓嬭浇-/i.test(entry.name)) {
        dirs.add(path.join("D:\\", entry.name));
      }
    }
  } catch {
    // Auto-discovery is best-effort. Configured fallback directories remain in use.
  }
  return Array.from(dirs);
}

function createFallbackDownload(sourcePath) {
  return {
    __fallbackPath: sourcePath,
    suggestedFilename: () => path.basename(sourcePath),
    saveAs: async (targetPath) => {
      await copyFile(sourcePath, targetPath);
    },
    failure: async () => null
  };
}

async function saveWorkbook(download, task, config) {
  const suggested = sanitizeFilename(download.suggestedFilename());
  const outputDir = path.join(config.output.rootDir, task.country.name, task.module.name);
  await mkdir(outputDir, { recursive: true });
  const sectionPrefix = task.module?.adsSection?.filenamePrefix ? `${sanitizeFilename(task.module.adsSection.filenamePrefix)}_` : "";
  const savedFilename = `${timestamp()}_${sectionPrefix}${suggested}`;
  const savedPath = path.join(outputDir, savedFilename);
  await download.saveAs(savedPath);
  const failure = await download.failure?.();
  if (failure) throw new UserFacingError(`涓嬭浇澶辫触: ${failure}`);
  const bytes = (await stat(savedPath)).size;
  const sha256 = createHash("sha256").update(await readFile(savedPath)).digest("hex");
  return {
    path: savedPath,
    sourcePath: download.__fallbackPath || null,
    suggestedFilename: suggested,
    savedFilename,
    bytes,
    sha256,
    downloadTime: new Date().toISOString()
  };
}

async function combineCompletedDailyWorkbooks(results, config) {
  const completed = results.filter((result) => result.status === "Completed" && result.workbook?.path);
  const countryCombinedGroups = new Map();
  const crossCountryGroups = new Map();
  for (const result of completed) {
    const requested = result.requestedDateRange || result.dateRange;
    if (!requested) continue;
    const key = `${result.country}\u0000${result.module}\u0000${requested.start}\u0000${requested.end}`;
    if (!crossCountryGroups.has(key)) {
      crossCountryGroups.set(key, {
        country: result.country,
        module: result.module,
        requestedDateRange: requested,
        results: []
      });
    }
    crossCountryGroups.get(key).results.push(result);

    if (sameRange(requested, result.dateRange)) continue;
    if (!countryCombinedGroups.has(key)) {
      countryCombinedGroups.set(key, {
        country: result.country,
        module: result.module,
        requestedDateRange: requested,
        results: []
      });
    }
    countryCombinedGroups.get(key).results.push(result);
  }

  const combined = [];
  for (const group of countryCombinedGroups.values()) {
    if (group.results.length === 0) continue;
    combined.push(await combineWorkbookGroup(group, config));
  }
  const crossCountry = await combineCrossCountryWorkbooks(crossCountryGroups, config);
  combined.push(...crossCountry);
  return combined;
}

async function combineWorkbookGroup(group, config) {
  const XLSX = loadXlsx();
  const sheets = new Map();
  const combinedSheetNames = selectedCombinedSheetNames(config, group.module);
  const sortedResults = [...group.results].sort((a, b) => String(a.dateRange?.start || "").localeCompare(String(b.dateRange?.start || "")));

  if (normalizeSheetName(group.module) === "shopee ads") {
    const sheet = readAdsCombinedSheetRows(sortedResults);
    if (sheet?.rows.length) {
      sortCombinedRows(sheet.rows, sheet.header, group.module);
      const outputWorkbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]);
      worksheet["!cols"] = sheet.header.map((header, index) => ({
        wch: index === 0 ? 12 : Math.max(10, Math.min(32, String(header || "").length + 4))
      }));
      XLSX.utils.book_append_sheet(outputWorkbook, worksheet, "Shopee Ads");

      const outputDir = path.join(config.output.rootDir, group.country, group.module);
      await mkdir(outputDir, { recursive: true });
      const filename = finalCombinedFilename([group.country], group.module, group.requestedDateRange, config);
      const outputPath = path.join(outputDir, filename);
      XLSX.writeFile(outputWorkbook, outputPath, { bookType: "xlsx" });
      const bytes = (await stat(outputPath)).size;
      const sha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
      return {
        type: "country",
        country: group.country,
        module: group.module,
        requestedDateRange: group.requestedDateRange,
        path: outputPath,
        filename,
        bytes,
        sha256,
        sourceCount: group.results.length,
        createdAt: new Date().toISOString()
      };
    }
  }
  for (const result of sortedResults) {
    const sourceWorkbook = XLSX.readFile(result.workbook.path, { cellDates: true });
    const dataDate = formatSingleDateForColumn(result.dateRange?.start);
    const matchingSheetNames = sourceWorkbook.SheetNames.filter((sheetName) => combinedSheetNames.has(normalizeSheetName(sheetName)));
    if (!matchingSheetNames.length && shouldCombineFirstSheet(config, group.module) && sourceWorkbook.SheetNames[0]) matchingSheetNames.push(sourceWorkbook.SheetNames[0]);
    for (const sheetName of matchingSheetNames) {
      const sourceSheet = sourceWorkbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sourceSheet, {
        header: 1,
        defval: "",
        blankrows: false,
        raw: false
      });
      if (!rows.length) continue;

      const originalHeader = normalizeWorkbookRow(rows[0]);
      if (!sheets.has(sheetName)) {
        sheets.set(sheetName, {
          header: ["鏁版嵁鏃ユ湡", ...originalHeader],
          rows: []
        });
      }

      const target = sheets.get(sheetName);
      for (const row of rows.slice(1)) {
        const normalized = normalizeWorkbookRow(row);
        if (!normalized.some((value) => String(value).trim() !== "")) continue;
        const transformed = transformCombinedSourceRow({
          row: normalized,
          header: originalHeader,
          country: group.country,
          moduleName: group.module
        });
        if (!transformed) continue;
        target.rows.push([dataDate, ...transformed]);
      }
    }
  }

  const outputWorkbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();
  for (const [sheetName, sheet] of sheets.entries()) {
    sortCombinedRows(sheet.rows, sheet.header, group.module);
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]);
    worksheet["!cols"] = sheet.header.map((header, index) => ({
      wch: index === 0 ? 12 : Math.max(10, Math.min(32, String(header || "").length + 4))
    }));
    XLSX.utils.book_append_sheet(outputWorkbook, worksheet, uniqueSheetName(sheetName, usedSheetNames));
  }

  if (!outputWorkbook.SheetNames.length) {
    throw new UserFacingError(`姣忔棩瀹樻柟 Excel 宸蹭笅杞斤紝浣嗘病鏈夋壘鍒板彲鍚堝苟鐨?Sheet: ${Array.from(combinedSheetNames).join(", ")}`);
  }

  const outputDir = path.join(config.output.rootDir, group.country, group.module);
  await mkdir(outputDir, { recursive: true });
  const filename = finalCombinedFilename([group.country], group.module, group.requestedDateRange, config);
  const outputPath = path.join(outputDir, filename);
  XLSX.writeFile(outputWorkbook, outputPath, { bookType: "xlsx" });
  const bytes = (await stat(outputPath)).size;
  const sha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  return {
    type: "country",
    country: group.country,
    module: group.module,
    requestedDateRange: group.requestedDateRange,
    path: outputPath,
    filename,
    bytes,
    sha256,
    sourceCount: group.results.length,
    createdAt: new Date().toISOString()
  };
}

async function combineCrossCountryWorkbooks(groups, config) {
  const eligible = Array.from(groups.values()).filter((group) => group.results.length > 0);
  const byModuleRange = new Map();
  for (const group of eligible) {
    const key = `${group.module}\u0000${group.requestedDateRange.start}\u0000${group.requestedDateRange.end}`;
    if (!byModuleRange.has(key)) {
      byModuleRange.set(key, {
        module: group.module,
        requestedDateRange: group.requestedDateRange,
        groups: []
      });
    }
    byModuleRange.get(key).groups.push(group);
  }

  const combined = [];
  for (const item of byModuleRange.values()) {
    if (item.groups.length < 2 && !moduleAlwaysCreatesCrossCountryCombined(config, item.module)) continue;
    const workbook = await combineCrossCountryWorkbook(item, config);
    if (workbook) combined.push(workbook);
  }
  return combined;
}

function moduleAlwaysCreatesCrossCountryCombined(config, moduleName) {
  const module = (config.modules || []).find((item) => item.name === moduleName);
  return Boolean(module?.alwaysCreateCrossCountryCombined);
}

async function combineCrossCountryWorkbook(item, config) {
  const XLSX = loadXlsx();
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();
  let sourceCount = 0;

  for (const group of item.groups.sort((a, b) => a.country.localeCompare(b.country))) {
    const sheet = readCombinedSheetRows(group.results, config, group.module);
    if (!sheet || sheet.rows.length === 0) continue;
    sortCombinedRows(sheet.rows, sheet.header, item.module);
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]);
    worksheet["!cols"] = sheet.header.map((header, index) => ({
      wch: index === 0 ? 12 : Math.max(10, Math.min(32, String(header || "").length + 4))
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(group.country, usedSheetNames));
    sourceCount += group.results.length;
  }

  if (!workbook.SheetNames.length) return null;
  const outputDir = path.join(config.output.rootDir, "Combined", item.module);
  await mkdir(outputDir, { recursive: true });
  const filename = finalCombinedFilename(item.groups.map((group) => group.country), item.module, item.requestedDateRange, config);
  const outputPath = path.join(outputDir, filename);
  XLSX.writeFile(workbook, outputPath, { bookType: "xlsx" });
  const bytes = (await stat(outputPath)).size;
  const sha256 = createHash("sha256").update(await readFile(outputPath)).digest("hex");
  return {
    type: "cross-country",
    country: item.groups.map((group) => group.country).join(" + "),
    module: item.module,
    requestedDateRange: item.requestedDateRange,
    path: outputPath,
    filename,
    bytes,
    sha256,
    sourceCount,
    createdAt: new Date().toISOString()
  };
}

function readCombinedSheetRows(results, config, moduleName = null) {
  if (normalizeSheetName(moduleName || results[0]?.module) === "shopee ads") {
    return readAdsCombinedSheetRows(results);
  }
  const XLSX = loadXlsx();
  const combinedSheetNames = selectedCombinedSheetNames(config, moduleName || results[0]?.module);
  const sortedResults = [...results].sort((a, b) => String(a.dateRange?.start || "").localeCompare(String(b.dateRange?.start || "")));
  let header = null;
  const rowsOut = [];

  for (const result of sortedResults) {
    const sourceWorkbook = XLSX.readFile(result.workbook.path, { cellDates: true });
    let sheetName = sourceWorkbook.SheetNames.find((name) => combinedSheetNames.has(normalizeSheetName(name)));
    if (!sheetName && shouldCombineFirstSheet(config, moduleName || results[0]?.module)) sheetName = sourceWorkbook.SheetNames[0];
    if (!sheetName) continue;
    const rows = XLSX.utils.sheet_to_json(sourceWorkbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false
    });
    if (!rows.length) continue;
    const originalHeader = normalizeWorkbookRow(rows[0]);
    if (!header) header = ["鏁版嵁鏃ユ湡", ...originalHeader];
    const dataDate = formatSingleDateForColumn(result.dateRange?.start);
    for (const row of rows.slice(1)) {
      const normalized = normalizeWorkbookRow(row);
      if (!normalized.some((value) => String(value).trim() !== "")) continue;
      const transformed = transformCombinedSourceRow({
        row: normalized,
        header: originalHeader,
        country: result.country,
        moduleName: result.module
      });
      if (!transformed) continue;
      rowsOut.push([dataDate, ...transformed]);
    }
  }

  return header ? { header, rows: rowsOut } : null;
}
function readAdsCombinedSheetRows(results) {
  const XLSX = loadXlsx();
  const sortedResults = [...results].sort((a, b) => {
    const dateCompare = String(a.dateRange?.start || "").localeCompare(String(b.dateRange?.start || ""));
    if (dateCompare !== 0) return dateCompare;
    return adsSectionOrder(a) - adsSectionOrder(b);
  });
  const header = ["数据日期", "Ads Section"];
  const headerIndexByName = new Map(header.map((name, index) => [normalizeHeaderName(name), index]));
  const sourceRows = [];
  const hasStandaloneShopAds = sortedResults.some((result) => {
    const section = adsSectionForResult(result);
    const key = normalizeHeaderName(section.key || section.name || "");
    return key.includes("shop ads");
  });

  for (const result of sortedResults) {
    const sourceWorkbook = XLSX.readFile(result.workbook.path, { cellDates: true });
    const sheetName = sourceWorkbook.SheetNames[0];
    if (!sheetName) continue;
    const rows = XLSX.utils.sheet_to_json(sourceWorkbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false
    });
    const headerRowIndex = rows.findIndex((row) => {
      const normalized = normalizeWorkbookRow(row);
      return findHeaderIndex(normalized, "Sequence") >= 0 && findHeaderIndex(normalized, "Ad Name") >= 0;
    });
    if (headerRowIndex < 0) continue;

    const sourceHeader = normalizeWorkbookRow(rows[headerRowIndex]);
    for (const value of sourceHeader) {
      const name = String(value || "").trim();
      if (!name) continue;
      const key = normalizeHeaderName(name);
      if (headerIndexByName.has(key)) continue;
      headerIndexByName.set(key, header.length);
      header.push(name);
    }

    const dataDate = formatSingleDateForColumn(result.dateRange?.start);
    const section = adsSectionForResult(result);
    const sectionName = section.name || section.key || "";
    for (const row of rows.slice(headerRowIndex + 1)) {
      const normalized = normalizeWorkbookRow(row);
      if (!normalized.some((value) => String(value).trim() !== "")) continue;
      if (shouldSkipAdsCombinedSourceRow(sectionName, sourceHeader, normalized, hasStandaloneShopAds)) continue;
      sourceRows.push({ dataDate, sectionName, sourceHeader, row: normalized });
    }
  }

  const rowsOut = sourceRows.map((item) => {
    const out = Array(header.length).fill("");
    out[0] = item.dataDate;
    out[1] = item.sectionName;
    item.sourceHeader.forEach((name, index) => {
      const targetIndex = headerIndexByName.get(normalizeHeaderName(name));
      if (targetIndex != null) out[targetIndex] = item.row[index] ?? "";
    });
    return out;
  });

  return header.length > 2 ? { header, rows: rowsOut } : null;
}

function adsSectionForResult(result) {
  const section = result.adsSection || result.module?.adsSection || null;
  if (section?.name || section?.key) return section;
  const file = String(result.workbook?.path || result.workbook?.filename || result.workbook?.savedFilename || "").toLowerCase();
  if (file.includes("all_product_ads")) return { key: "all_product_ads", name: "All Product Ads" };
  if (file.includes("shop_ads")) return { key: "shop_ads", name: "Shop Ads" };
  if (file.includes("all_cpc_ads")) return { key: "all_cpc_ads", name: "All CPC Ads" };
  return {};
}

function shouldSkipAdsCombinedSourceRow(sectionName, sourceHeader, row, hasStandaloneShopAds) {
  if (!hasStandaloneShopAds) return false;
  const adsTypeIndex = findHeaderIndex(sourceHeader, "Ads Type");
  const adsType = adsTypeIndex >= 0 ? normalizeHeaderName(row[adsTypeIndex]) : "";
  return normalizeHeaderName(sectionName).includes("all product ads") && adsType === "shop ad";
}

function adsSectionOrder(result) {
  const section = adsSectionForResult(result);
  const key = String(section.key || section.name || "");
  if (/product/i.test(key)) return 1;
  if (/shop/i.test(key)) return 2;
  return 0;
}
function sortCombinedRows(rows, header, moduleName) {
  const moduleKey = normalizeSheetName(moduleName);
  const sequenceIndex = moduleKey === "shopee ads" ? findHeaderIndex(header, "Sequence") : -1;
  rows.sort((a, b) => {
    const dateCompare = String(a[0]).localeCompare(String(b[0]));
    if (dateCompare !== 0) return dateCompare;
    if (sequenceIndex < 0) return 0;
    const left = Number(String(a[sequenceIndex] ?? "").replace(/[^0-9.-]/g, ""));
    const right = Number(String(b[sequenceIndex] ?? "").replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
    if (Number.isFinite(left) && !Number.isFinite(right)) return -1;
    if (!Number.isFinite(left) && Number.isFinite(right)) return 1;
    return 0;
  });
}

function shouldCombineFirstSheet(config, moduleName) {
  const module = moduleName ? (config.modules || []).find((item) => item.name === moduleName) : null;
  return Boolean(module?.combineFirstSheet);
}



function selectedCombinedSheetNames(config, moduleName = null) {
  const module = moduleName ? (config.modules || []).find((item) => item.name === moduleName) : null;
  const names = Array.isArray(module?.combinedSheetNames) && module.combinedSheetNames.length
    ? module.combinedSheetNames
    : Array.isArray(config?.output?.combinedSheetNames) && config.output.combinedSheetNames.length
    ? config.output.combinedSheetNames
    : ["Top Performing Products"];
  return new Set(names.map(normalizeSheetName));
}

function normalizeSheetName(value) {
  return String(value || "").trim().toLowerCase();
}

function loadXlsx() {
  try {
    const requireFromSkill = createRequire(path.join(skillDir, "package.json"));
    return requireFromSkill("xlsx");
  } catch {
    throw new UserFacingError("缂哄皯 Excel 鍚堝苟渚濊禆 xlsx銆傝鍦?Skill 鐩綍杩愯 setup.bat 鎴?npm install 鍚庨噸璇曘€?");
  }
}

function normalizeWorkbookRow(row) {
  return Array.isArray(row) ? row.map((value) => value ?? "") : [];
}

function transformCombinedSourceRow({ row, header, country, moduleName }) {
  const moduleKey = normalizeSheetName(moduleName);
  let transformed = [...row];

  if (moduleKey === "product performance") {
    const variationIdIndex = findHeaderIndex(header, "Variation ID");
    if (variationIdIndex >= 0 && String(transformed[variationIdIndex] ?? "").trim() !== "-") return null;
  }

  if (country === "Indonesia" && ["product performance", "voucher"].includes(moduleKey)) {
    transformed = transformed.map(convertIndonesianNumericText);
  }

  return transformed;
}

function findHeaderIndex(header, expectedName) {
  const expected = normalizeHeaderName(expectedName);
  return normalizeWorkbookRow(header).findIndex((value) => normalizeHeaderName(value) === expected);
}

function normalizeHeaderName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function convertIndonesianNumericText(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || text === "-") return value;
  if (!/^-?\d[\d.,]*(%?)$/.test(text)) return value;
  if (!/[.,]/.test(text)) return value;
  return text.replaceAll(".", "").replaceAll(",", ".");
}

function formatSingleDateForColumn(value) {
  return String(value || "").replaceAll("-", "/");
}

function rangeSlug(range) {
  return `${range.start.replaceAll("-", "")}_${range.end.replaceAll("-", "")}`;
}

function compactRangeSlug(range) {
  return `${range.start.slice(2).replaceAll("-", "")}-${range.end.slice(2).replaceAll("-", "")}`;
}

function finalCombinedFilename(countries, moduleName, range, config) {
  const countryPart = countries.map((country) => countryCodeForName(country, config)).join("_");
  const modulePart = String(moduleName || "").trim().toLowerCase();
  return `${sanitizeFilename(countryPart)}_${sanitizeFilename(modulePart)}_${compactRangeSlug(range)}.xlsx`;
}

function countryCodeForName(name, config) {
  const country = (config.countries || []).find((item) => item.name === name);
  return country?.code || String(name || "").trim();
}

function uniqueSheetName(value, used) {
  const base = String(value || "Sheet")
    .replace(/[\[\]:*?/\\]/g, "_")
    .slice(0, 31) || "Sheet";
  let name = base;
  let index = 2;
  while (used.has(name)) {
    const suffix = `_${index}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(name);
  return name;
}

async function loadConfig() {
  const base = JSON.parse(await readFile(defaultConfigPath, "utf8"));
  if (!existsSync(userConfigPath)) return base;
  const user = JSON.parse(await readFile(userConfigPath, "utf8"));
  return mergeConfig(base, user);
}

function mergeConfig(base, user) {
  return {
    ...base,
    ...user,
    adspower: { ...base.adspower, ...user.adspower },
    output: { ...base.output, ...user.output },
    officialExport: { ...base.officialExport, ...user.officialExport },
    profiles: { ...base.profiles, ...user.profiles },
    countries: user.countries || base.countries,
    modules: user.modules || base.modules,
    dateShortcuts: { ...base.dateShortcuts, ...user.dateShortcuts }
  };
}

async function saveUserProfileMapping(config) {
  const existing = existsSync(userConfigPath) ? JSON.parse(await readFile(userConfigPath, "utf8")) : {};
  const next = { ...existing, profiles: { ...(existing.profiles || {}), ...config.profiles } };
  await mkdir(path.dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function getActiveProfiles(config) {
  const body = await getAdsPowerJson(config, "/api/v1/browser/local-active");
  const data = body?.data ?? body;
  const list = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
  const profiles = list.map((item) => {
    const userId = item.user_id || item.userId || item.id;
    const wsEndpoint = extractWsEndpoint(item);
    const debugPort = extractDebugPort(item, wsEndpoint);
    return userId ? { userId, wsEndpoint, debugPort, raw: item } : null;
  }).filter(Boolean);
  if (profiles.length === 0) throw new UserFacingError("鏈娴嬪埌宸叉墦寮€鐨?AdsPower Profile銆傝鍏堟墦寮€瀵瑰簲娴忚鍣ㄣ€?");
  return profiles;
}

async function getAdsPowerJson(config, apiPath) {
  const url = new URL(apiPath, normalizedBaseUrl(config.adspower.localApiBaseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.adspower.requestTimeoutMs || 10000);
  try {
    const headers = { Accept: "application/json" };
    const apiKey = config.adspower.apiKeyEnv ? process.env[config.adspower.apiKeyEnv] : undefined;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new UserFacingError(`AdsPower Local API 杩炴帴澶辫触: HTTP ${response.status}`);
    if (body?.code !== undefined && Number(body.code) !== 0) {
      throw new UserFacingError(`AdsPower Local API 杩斿洖閿欒: ${body.msg || body.message || body.code}`);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") throw new UserFacingError("AdsPower Local API 璇锋眰瓒呮椂锛岃纭 AdsPower 宸茶繍琛屽苟寮€鍚?Local API銆?");
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("鏃犳硶杩炴帴 AdsPower Local API锛岃纭 AdsPower 宸茶繍琛屽苟寮€鍚?Local API銆?");
  } finally {
    clearTimeout(timeout);
  }
}

function findCountries(text, config) {
  return uniqueByName(config.countries.filter((country) =>
    [country.name, country.code, ...(country.aliases || [])].some((alias) => containsToken(text, alias))
  ));
}

function findModules(text, config) {
  return uniqueByName(config.modules.filter((module) =>
    [module.name, ...(module.aliases || [])].some((alias) => containsToken(text, alias))
  ));
}

function isAllModules(text) {
  return /鍏ㄩ儴妯″潡|鎵€鏈夋ā鍧梶all modules/i.test(text);
}

function parseRequestedDate(text, config) {
  const normalized = normalizeText(text);
  const range = normalized.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})\s*~\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})/);
  if (range) {
    const start = parseUserDate(range[1]);
    const end = parseUserDate(range[2]);
    if (start && end) return { start, end };
  }
  for (const [key, aliases] of Object.entries(config.dateShortcuts || {})) {
    if (aliases.some((alias) => containsToken(normalized, alias))) return dateShortcut(key);
  }
  return null;
}

function parseDateRangeFromText(value) {
  const text = normalizeText(value);
  const dates = [];
  const push = (date) => {
    if (date && !dates.includes(date)) dates.push(date);
  };
  for (const match of text.matchAll(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])\b/g)) {
    push(toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(/(20\d{2})[./-](0?[1-9]|1[0-2])[./-](0?[1-9]|[12]\d|3[01])(?!\d)/g)) {
    push(toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(/\b(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})\b/g)) {
    push(toIsoDate(Number(match[3]), Number(match[2]), Number(match[1])));
  }
  for (const match of text.matchAll(/(0?[1-9]|[12]\d|3[01])[./-](0?[1-9]|1[0-2])[./-](20\d{2})(?!\d)/g)) {
    push(toIsoDate(Number(match[3]), Number(match[2]), Number(match[1])));
  }
  const months = { jan:1,january:1,januari:1,feb:2,february:2,februari:2,mar:3,march:3,maret:3,apr:4,april:4,may:5,mei:5,jun:6,june:6,juni:6,jul:7,july:7,juli:7,aug:8,august:8,agu:8,agustus:8,sep:9,sept:9,september:9,oct:10,october:10,okt:10,oktober:10,nov:11,november:11,dec:12,december:12,des:12,desember:12 };
  const names = Object.keys(months).sort((a, b) => b.length - a.length).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s+(${names})\\s*,?\\s*(20\\d{2})\\b`, "gi"))) {
    push(toIsoDate(Number(match[3]), months[match[2].toLowerCase()], Number(match[1])));
  }
  for (const match of text.matchAll(new RegExp(`\\b(${names})\\s+(0?[1-9]|[12]\\d|3[01]),?\\s*(20\\d{2})\\b`, "gi"))) {
    push(toIsoDate(Number(match[3]), months[match[1].toLowerCase()], Number(match[2])));
  }
  if (!dates[0]) return null;
  return { start: dates[0], end: dates[1] || dates[0] };
}

function parseUserDate(value) {
  const parts = String(value).trim().split(/[/-]/).map(Number);
  if (parts.length === 3) return toIsoDate(parts[0], parts[1], parts[2]);
  if (parts.length === 2) return toIsoDate(new Date().getFullYear(), parts[0], parts[1]);
  return null;
}

function dateShortcut(key) {
  const today = new Date();
  const end = stripTime(today);
  if (key === "today") return { start: iso(end), end: iso(end) };
  if (key === "yesterday") {
    const date = addDays(end, -1);
    return { start: iso(date), end: iso(date) };
  }
  if (key === "last7") return { start: iso(addDays(end, -6)), end: iso(end) };
  if (key === "last30") return { start: iso(addDays(end, -29)), end: iso(end) };
  return null;
}

function matchesPage(urlValue, title, country, module) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return false;
  }
  const hostOk = country.hosts.includes(url.hostname.toLowerCase());
  const haystack = `${url.pathname.toLowerCase()} ${String(title || "").toLowerCase()}`;
  const moduleOk = module.pageHints.some((hint) => haystack.includes(String(hint).toLowerCase()));
  return hostOk && moduleOk;
}

function resolveCdpEndpoint(profile) {
  if (profile.debugPort) return `http://127.0.0.1:${profile.debugPort}`;
  if (profile.wsEndpoint) return profile.wsEndpoint;
  throw new UserFacingError(`AdsPower Profile ${profile.userId} 娌℃湁鍙敤鐨?CDP 璋冭瘯绔彛銆俙`);
}

function profileHasCdpEndpoint(profile) {
  return Boolean(profile?.debugPort || profile?.wsEndpoint);
}

function extractWsEndpoint(data) {
  const ws = data?.ws;
  if (typeof ws === "string" && ws) return ws;
  if (ws && typeof ws === "object") return ws.puppeteer || ws.playwright || ws.selenium;
  return data?.wsEndpoint;
}

function extractDebugPort(data, wsEndpoint) {
  const value = data?.debug_port || data?.debugPort || data?.port;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  const match = String(wsEndpoint || "").match(/:(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : undefined;
}

function findCountryByName(name, config) {
  if (!name) return null;
  return config.countries.find((country) => country.name.toLowerCase() === String(name).toLowerCase()) || null;
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function containsToken(text, token) {
  if (!token) return false;
  return normalizeText(text).toLowerCase().includes(normalizeText(token).toLowerCase());
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameRange(left, right) {
  return left && right && left.start === right.start && left.end === right.end;
}

function expandDateRangeToDailyRanges(range) {
  if (!range?.start || !range?.end) throw new UserFacingError("鏃ユ湡鑼冨洿鏃犳晥锛岃閲嶆柊杈撳叆銆?");
  const start = parseIsoDateLocal(range.start);
  const end = parseIsoDateLocal(range.end);
  if (!start || !end) throw new UserFacingError(`鏃ユ湡鑼冨洿鏃犳晥: ${formatDateRange(range)}`);
  if (start > end) throw new UserFacingError(`寮€濮嬫棩鏈熶笉鑳芥櫄浜庣粨鏉熸棩鏈? ${formatDateRange(range)}`);

  const ranges = [];
  for (let current = new Date(start); current <= end; current = addDays(current, 1)) {
    const day = iso(current);
    ranges.push({ start: day, end: day });
    if (ranges.length > 370) {
      throw new UserFacingError("涓€娆″鍑虹殑鏃ユ湡鑼冨洿杩囬暱锛岃缂╃煭鏃ユ湡鑼冨洿鍚庨噸璇曘€?");
    }
  }
  return ranges;
}

function parseIsoDateLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return iso(date) === value ? date : null;
}

function formatDateRange(range) {
  if (!range) return "Not readable";
  return `${range.start.replaceAll("-", "/")}~${range.end.replaceAll("-", "/")}`;
}

function buildReportDateTokens(range) {
  return {
    start: buildSingleDateTokens(range.start),
    end: buildSingleDateTokens(range.end)
  };
}

function buildSingleDateTokens(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, yyyy, mm, dd] = match;
  return [
    `${yyyy}${mm}${dd}`,
    `${dd}${mm}${yyyy}`,
    `${yyyy}${Number(mm)}${Number(dd)}`,
    `${Number(dd)}${Number(mm)}${yyyy}`
  ];
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizedBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function sanitizeFilename(value) {
  return String(value || "shopee-official-export.xlsx").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function safeTitle(page) {
  try {
    return await Promise.race([
      page.title(),
      new Promise((resolve) => setTimeout(() => resolve(""), 3000))
    ]);
  } catch {
    return "";
  }
}

async function ask(rl, question) {
  if (rl?.__inputQueue) {
    if (question) process.stdout.write(question);
    if (!rl.__inputQueue.length) {
      throw new UserFacingError("Missing interactive input. Please provide a complete command or run the guided skill in an interactive terminal.");
    }
    const value = rl.__inputQueue.shift();
    process.stdout.write(`${value}\n`);
    return value;
  }
  try {
    return await rl.question(question);
  } catch (error) {
    if (String(error?.message || error).includes("readline was closed")) return "";
    throw error;
  }
}

async function writeGoogleSummaryAfterExport(results, config) {
  const settings = config.googleSheets || {};
  if (!settings.enabled || !settings.writeAfterExport) return [];
  const helperPath = path.join(skillDir, "scripts", "write-google-summary.mjs");
  if (!existsSync(helperPath)) return [{ status: "Failed", range: "n/a", rows: 0, blocks: 0, error: `helper not found: ${helperPath}` }];

  const groups = new Map();
  for (const result of results) {
    if (result.status !== "Completed" || !result.workbook?.path) continue;
    if (normalizeSheetName(result.module) === "affiliate") continue;
    const range = result.requestedDateRange || result.dateRange;
    if (!range?.start || !range?.end) continue;
    const key = `${range.start}\u0000${range.end}`;
    if (!groups.has(key)) {
      groups.set(key, { range, modules: new Set(), countries: new Set() });
    }
    groups.get(key).modules.add(result.module);
    groups.get(key).countries.add(result.country);
  }

  const writes = [];
  if (!groups.size) return writes;
  for (const group of groups.values()) {
    const rangeArg = `${dateForGoogleSummaryArg(group.range.start)}~${dateForGoogleSummaryArg(group.range.end)}`;
    const modulesArg = [...group.modules].join(",");
    const countriesArg = [...group.countries].join(",");
    const helperArgs = [helperPath, `--range=${rangeArg}`, `--modules=${modulesArg}`, `--countries=${countriesArg}`];
    const env = googleSummaryEnv(settings);
    console.log("");
    console.log(`在线表同步: ${rangeArg} -> ${modulesArg}`);
    const proc = spawnSync(process.execPath, helperArgs, {
      cwd: skillDir,
      env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: Number(settings.timeoutMs || 10 * 60 * 1000)
    });
    const parsed = parseGoogleSummaryOutput(proc.stdout);
    const summary = Array.isArray(parsed?.summary) ? parsed.summary : [];
    const rows = summary.reduce((sum, item) => sum + (Number(item.rows) || 0), 0);
    const blocks = summary.filter((item) => Number(item.rows) > 0).length;
    writes.push({
      range: rangeArg,
      modules: modulesArg,
      countries: countriesArg,
      status: proc.status === 0 ? "Completed" : "Failed",
      rows,
      blocks,
      summary,
      error: proc.status === 0 ? "" : String(proc.stderr || proc.stdout || proc.error?.message || `exit ${proc.status}`).trim()
    });
  }
  return writes;
}

function googleSummaryEnv(settings) {
  const env = { ...process.env };
  if (settings.spreadsheetId) env.SHOPEE_GOOGLE_SHEET_ID = settings.spreadsheetId;
  if (settings.credentialPath) env.GOOGLE_APPLICATION_CREDENTIALS = settings.credentialPath;
  if (settings.requestTimeoutMs) env.SHOPEE_GOOGLE_TIMEOUT_MS = String(settings.requestTimeoutMs);
  if (settings.proxy) {
    env.HTTPS_PROXY = settings.proxy;
    env.https_proxy = settings.proxy;
  }
  return env;
}

function dateForGoogleSummaryArg(date) {
  return String(date || "").replaceAll("-", "/");
}

function parseGoogleSummaryOutput(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}


function printSummary(results, combinedWorkbooks = [], googleSummaryWrites = []) {
  console.log("");
  console.log("执行汇总:");
  for (const result of results) {
    const label = `${result.country} -> ${result.module}${result.dateRange ? ` -> ${formatDateRange(result.dateRange)}` : ""}`;
    if (result.status === "Completed") {
      console.log(`OK ${label}: ${result.workbook.path}`);
      console.log(`SHA-256: ${result.workbook.sha256}`);
      console.log(`Timing: ${formatTimings(result.timings)}`);
    } else if (result.status === "Ready") {
      console.log(`READY ${label}: Simulation Mode`);
      console.log(`Timing: ${formatTimings(result.timings)}`);
    } else {
      console.log(`FAILED ${label}: ${result.error}`);
      if (result.timings) console.log(`Timing: ${formatTimings(result.timings)}`);
    }
  }
  if (combinedWorkbooks.length) {
    console.log("");
    console.log("合并 Excel:");
    for (const workbook of combinedWorkbooks) {
      const prefix = workbook.type === "cross-country" ? "CROSS" : "OK";
      console.log(`${prefix} ${workbook.country} -> ${workbook.module} -> ${formatDateRange(workbook.requestedDateRange)}: ${workbook.path}`);
      console.log(`Source files: ${workbook.sourceCount}`);
      console.log(`SHA-256: ${workbook.sha256}`);
    }
  }
  if (googleSummaryWrites.length) {
    console.log("");
    console.log("在线表写入:");
    for (const item of googleSummaryWrites) {
      if (item.status === "Completed") {
        console.log(`OK ${item.range}: ${item.rows} rows, ${item.blocks} blocks`);
      } else {
        console.log(`FAILED ${item.range}: ${item.error || "unknown error"}`);
      }
    }
  }
  console.log(`耗时: ${Math.round((Date.now() - startedAt) / 1000)}s`);
  printTimingSummary(results);
}

function formatTimings(timings) {
  if (!timings?.phases?.length) return "n/a";
  const phases = timings.phases
    .filter((item) => item.phase !== "disconnect_cdp")
    .map((item) => `${item.phase}=${formatMs(item.ms)}`)
    .join(", ");
  return `total=${formatMs(timings.totalMs)}; ${phases}`;
}

function printTimingSummary(results) {
  const phases = new Map();
  for (const result of results) {
    for (const item of result.timings?.phases || []) {
      if (!phases.has(item.phase)) phases.set(item.phase, []);
      phases.get(item.phase).push(item.ms);
    }
  }
  if (phases.size === 0) return;
  console.log("");
  console.log("Timing Summary:");
  for (const [phase, values] of phases.entries()) {
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    const max = Math.max(...values);
    console.log(`${phase}: count=${values.length}, avg=${formatMs(average)}, max=${formatMs(max)}, total=${formatMs(total)}`);
  }
}

function formatMs(value) {
  const ms = Math.round(Number(value) || 0);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printHelp() {
  console.log("Shopee 瀹樻柟 Excel 瀵煎嚭");
  console.log("");
  console.log("鍚姩鍛戒护锛?");
  console.log("  node scripts/shopee-export.mjs");
  console.log("  run.bat");
  console.log("");
  console.log("鏃犲弬鏁板惎鍔ㄥ悗鎸変笁姝ラ€夋嫨锛氬浗瀹?-> 鏉垮潡 -> 鏃堕棿娈点€?");
  console.log("杈撳叆澶氫釜缂栧彿鍙閫夛紝渚嬪 1,2锛涚洿鎺ュ洖杞﹁〃绀哄叏閫夈€?");
  console.log("");
  console.log("鏃у懡浠や粛鍏煎锛屼緥濡傦細");
  console.log("  node scripts/shopee-export.mjs \"Indonesia Malaysia Voucher: 2026/07/01~2026/07/13\"");
}

async function runStartupSelfCheck(config) {
  console.log("Startup check...");

  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new UserFacingError(`Node.js version is too old: ${process.versions.node}. Please install Node.js 20 or later.`);
  }
  console.log("OK Node");

  if (!existsSync(defaultConfigPath)) {
    throw new UserFacingError(`Config file not found: ${defaultConfigPath}`);
  }
  if (!config?.adspower?.localApiBaseUrl || !config?.output?.rootDir) {
    throw new UserFacingError("Config is incomplete. Please check config/default.config.json.");
  }
  console.log("OK Config");

  const playwright = await loadPlaywright();
  console.log(`OK Playwright (${playwright.__source})`);

  const profiles = await getActiveProfiles(config);
  console.log(`OK AdsPower Local API (${profiles.length} active profile)`);

  const profile = profiles.find((item) => item.debugPort || item.wsEndpoint);
  if (!profile) {
    throw new UserFacingError("AdsPower profile was detected, but no CDP debug endpoint is available. Please make sure the AdsPower browser is open.");
  }

  const endpoint = resolveCdpEndpoint(profile);
  let browser;
  try {
    browser = await playwright.chromium.connectOverCDP(endpoint, { noDefaults: true });
    console.log("OK Playwright CDP connection");
  } catch {
    throw new UserFacingError(`Playwright could not connect to AdsPower CDP: ${endpoint}`);
  } finally {
    await browser?.close?.();
  }

  console.log("");
}

async function loadPlaywright() {
  const attempts = [
    {
      source: "Skill node_modules",
      load: async () => {
        const requireFromSkill = createRequire(path.join(skillDir, "package.json"));
        return requireFromSkill("playwright");
      }
    },
    {
      source: "ESM resolver",
      load: async () => await import("playwright")
    },
    {
      source: "Current working directory",
      load: async () => {
        const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
        return requireFromCwd("playwright");
      }
    },
    {
      source: legacyProjectDir,
      load: async () => {
        const requireFromLegacy = createRequire(path.join(legacyProjectDir, "package.json"));
        return requireFromLegacy("playwright");
      }
    }
  ];

  for (const attempt of attempts) {
    try {
      const loaded = await attempt.load();
      Object.defineProperty(loaded, "__source", { value: attempt.source, enumerable: false, configurable: true });
      return loaded;
    } catch {
      // Try the next configured dependency location.
    }
  }

  throw new UserFacingError(playwrightInstallMessage());
}

function friendlyError(error) {
  if (error instanceof UserFacingError) return error.message;
  if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("playwright")) {
    return playwrightInstallMessage();
  }
  return error instanceof Error ? error.message : String(error);
}

function playwrightInstallMessage() {
  return [
    "Playwright is not installed.",
    "",
    "Please double-click setup.bat, or run these commands manually:",
    `cd /d "${skillDir}"`,
    "npm install",
    "",
    "If you only want to install Playwright:",
    "npm install playwright"
  ].join("\n");
}

class UserFacingError extends Error {}
