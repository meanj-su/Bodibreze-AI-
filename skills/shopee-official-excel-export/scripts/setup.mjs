#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userConfigPath = path.join(os.homedir(), ".codex", "shopee-official-excel-export.config.json");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  console.log("Shopee Official Excel Export - Setup");
  console.log("");

  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node.js version is too old: ${process.versions.node}. Please install Node.js 20 or later.`);
  }
  console.log(`Node OK: ${process.versions.node}`);

  if (!playwrightAvailable()) {
    console.log("Installing dependencies...");
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npmCommand, ["install"], {
      cwd: skillDir,
      stdio: "inherit",
      shell: false
    });
    if (result.status !== 0) {
      throw new Error([
        "Dependency installation failed.",
        "Please run these commands manually:",
        `cd /d "${skillDir}"`,
        "npm install",
        "npm install playwright"
      ].join("\n"));
    }
  }

  if (!playwrightAvailable()) {
    throw new Error("Playwright check failed after installation. Please run: npm install playwright");
  }
  console.log("Playwright OK");

  await mkdir(path.dirname(userConfigPath), { recursive: true });
  if (!existsSync(userConfigPath)) {
    await writeFile(userConfigPath, "{}\n", "utf8");
  }
  console.log("Config OK");
  console.log("");
  console.log("Environment is ready.");
  console.log("环境已就绪");
}

function playwrightAvailable() {
  try {
    const requireFromSkill = createRequire(path.join(skillDir, "package.json"));
    requireFromSkill("playwright");
    return true;
  } catch {
    return false;
  }
}
