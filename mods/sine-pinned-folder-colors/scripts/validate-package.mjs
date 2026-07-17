import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function assertFile(relativePath) {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing referenced file: ${relativePath}`);
  }
  return fullPath;
}

function checkScript(relativePath) {
  const fullPath = assertFile(relativePath);
  const result = spawnSync(process.execPath, ["--check", fullPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${relativePath} failed syntax check:\n${result.stderr || result.stdout}`
    );
  }
}

const theme = readJson(join(root, "theme.json"));
for (const field of [
  "id",
  "name",
  "description",
  "author",
  "version",
  "homepage",
  "readme",
  "style",
  "scripts",
  "fork",
]) {
  if (!theme[field]) {
    throw new Error(`theme.json is missing required field: ${field}`);
  }
}

if (theme.id !== "sine-pinned-folder-colors") {
  throw new Error("theme.json has an unexpected mod id");
}
if (!Array.isArray(theme.fork) || !theme.fork.includes("zen")) {
  throw new Error('theme.json must include "zen" in fork');
}

assertFile(theme.style.chrome);
assertFile(theme.preferences);
assertFile("README.md");
for (const scriptPath of Object.keys(theme.scripts)) {
  checkScript(scriptPath);
}
checkScript("scripts/pinned-folder-colors-core.uc.mjs");
checkScript("scripts/pinned-folder-colors.uc.mjs");

const preferences = readJson(join(root, theme.preferences));
if (!Array.isArray(preferences)) {
  throw new Error("preferences.json must contain an array");
}

console.log("Pinned Folder Colors package is valid.");
