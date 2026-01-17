import fs from "node:fs";
import path from "node:path";
import { USIEngines } from "@/common/settings/usi.js";
import { AppSettings, defaultAppSettings, normalizeAppSettings } from "@/common/settings/app.js";
import {
  defaultWindowSettings,
  normalizeWindowSettings,
  WindowSettings,
} from "@/common/settings/window.js";
import {
  defaultGameSettings,
  GameSettings,
  normalizeGameSettings,
} from "@/common/settings/game.js";
import {
  defaultResearchSettings,
  normalizeResearchSettings,
  ResearchSettings,
} from "@/common/settings/research.js";
import {
  AnalysisSettings,
  defaultAnalysisSettings,
  normalizeAnalysisSettings,
} from "@/common/settings/analysis.js";
import { getAppLogger } from "@/background/log.js";
import {
  CSAGameSettingsHistory as CSAGameSettingsHistory,
  decryptCSAGameSettingsHistory,
  defaultCSAGameSettingsHistory,
  encryptCSAGameSettingsHistory,
  normalizeSecureCSAGameSettingsHistory,
} from "@/common/settings/csa.js";
import { getPortableExeDir } from "./proc/env.js";
import {
  MateSearchSettings as MateSearchSettings,
  defaultMateSearchSettings,
  normalizeMateSearchSettings,
} from "@/common/settings/mate.js";
import {
  BatchConversionSettings,
  defaultBatchConversionSettings,
  normalizeBatchConversionSettings as normalizeBatchConversionSettings,
} from "@/common/settings/conversion.js";
import { exists } from "./helpers/file.js";
import { emptyLayoutProfileList, LayoutProfileList } from "@/common/settings/layout.js";
import { BookImportSettings, defaultBookImportSettings } from "@/common/settings/book.js";
import { writeFileAtomic, writeFileAtomicSync } from "./file/atomic.js";
import { getUserDataPath } from "./proc/path.js";

function getUserDir() {
  return getUserDataPath();
}

function getRootDir() {
  return getPortableExeDir() || getUserDir();
}

function getDocDir() {
  return path.join(getUserDir(), "Documents", "ShogiHome");
}

export function openSettingsDirectory(): Promise<void> {
  return Promise.resolve(); // Not supported
}

export async function openAutoSaveDirectory(): Promise<void> {
  return Promise.resolve(); // Not supported
}

function getWindowSettingsPath() {
  return path.join(getUserDir(), "window.json");
}

export function saveWindowSettings(settings: WindowSettings): void {
  try {
    writeFileAtomicSync(
      getWindowSettingsPath(),
      JSON.stringify(normalizeWindowSettings(settings), undefined, 2),
      "utf8",
    );
  } catch (e) {
    getAppLogger().error("failed to write window settings: %s", e);
  }
}

export function loadWindowSettings(): WindowSettings {
  try {
    return normalizeWindowSettings(JSON.parse(fs.readFileSync(getWindowSettingsPath(), "utf8")));
  } catch (e) {
    getAppLogger().error("failed to read window settings: %s", e);
    return defaultWindowSettings();
  }
}

function getUSIEnginesPath() {
  return path.join(getRootDir(), "usi_engine.json");
}

export async function saveUSIEngines(usiEngines: USIEngines): Promise<void> {
  await writeFileAtomic(getUSIEnginesPath(), usiEngines.jsonWithIndent, "utf8");
}

export async function loadUSIEngines(): Promise<USIEngines> {
  const p = getUSIEnginesPath();
  if (!(await exists(p))) {
    return new USIEngines();
  }
  return new USIEngines(await fs.promises.readFile(p, "utf8"));
}

function getAppSettingsPath() {
  return path.join(getUserDir(), "app_setting.json");
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await writeFileAtomic(getAppSettingsPath(), JSON.stringify(settings, undefined, 2), "utf8");
}

const defaultReturnCode = process.platform === "win32" ? "\r\n" : "\n";

function getDefaultAppSettings(): AppSettings {
  return defaultAppSettings({
    returnCode: defaultReturnCode,
    autoSaveDirectory: getDocDir(),
  });
}

function loadAppSettingsFromMemory(json: string): AppSettings {
  return normalizeAppSettings(JSON.parse(json), {
    returnCode: defaultReturnCode,
    autoSaveDirectory: getDocDir(),
  });
}

function loadAppSettingsSync(): AppSettings {
  const p = getAppSettingsPath();
  if (!fs.existsSync(p)) {
    return getDefaultAppSettings();
  }
  return loadAppSettingsFromMemory(fs.readFileSync(p, "utf8"));
}

let appSettingsCache: AppSettings;

export function loadAppSettingsOnce(): AppSettings {
  if (!appSettingsCache) {
    appSettingsCache = loadAppSettingsSync();
  }
  return appSettingsCache;
}

export async function loadAppSettings(): Promise<AppSettings> {
  const p = getAppSettingsPath();
  if (!(await exists(p))) {
    return getDefaultAppSettings();
  }
  return loadAppSettingsFromMemory(await fs.promises.readFile(p, "utf8"));
}

function getBatchConversionSettingsPath() {
  return path.join(getRootDir(), "batch_conversion_setting.json");
}

export async function saveBatchConversionSettings(
  settings: BatchConversionSettings,
): Promise<void> {
  await writeFileAtomic(
    getBatchConversionSettingsPath(),
    JSON.stringify(settings, undefined, 2),
    "utf8",
  );
}

export async function loadBatchConversionSettings(): Promise<BatchConversionSettings> {
  const p = getBatchConversionSettingsPath();
  if (!(await exists(p))) {
    return defaultBatchConversionSettings();
  }
  return normalizeBatchConversionSettings(JSON.parse(await fs.promises.readFile(p, "utf8")));
}

function getGameSettingsPath() {
  return path.join(getRootDir(), "game_setting.json");
}

export async function saveGameSettings(settings: GameSettings): Promise<void> {
  await writeFileAtomic(getGameSettingsPath(), JSON.stringify(settings, undefined, 2), "utf8");
}

export async function loadGameSettings(): Promise<GameSettings> {
  const p = getGameSettingsPath();
  if (!(await exists(p))) {
    return defaultGameSettings();
  }
  return normalizeGameSettings(JSON.parse(await fs.promises.readFile(p, "utf8")));
}

function getCSAGameSettingsHistoryPath() {
  return path.join(getRootDir(), "csa_game_setting_history.json");
}

export async function saveCSAGameSettingsHistory(settings: CSAGameSettingsHistory): Promise<void> {
  const encrypted = encryptCSAGameSettingsHistory(settings, undefined);
  await writeFileAtomic(
    getCSAGameSettingsHistoryPath(),
    JSON.stringify(encrypted, undefined, 2),
    "utf8",
  );
}

export async function loadCSAGameSettingsHistory(): Promise<CSAGameSettingsHistory> {
  const p = getCSAGameSettingsHistoryPath();
  if (!(await exists(p))) {
    return defaultCSAGameSettingsHistory();
  }
  const encrypted = JSON.parse(await fs.promises.readFile(p, "utf8"));
  return decryptCSAGameSettingsHistory(normalizeSecureCSAGameSettingsHistory(encrypted), undefined);
}

function getResearchSettingsPath() {
  return path.join(getRootDir(), "research_setting.json");
}

export async function saveResearchSettings(settings: ResearchSettings): Promise<void> {
  await writeFileAtomic(getResearchSettingsPath(), JSON.stringify(settings, undefined, 2), "utf8");
}

export async function loadResearchSettings(): Promise<ResearchSettings> {
  const p = getResearchSettingsPath();
  if (!(await exists(p))) {
    return defaultResearchSettings();
  }
  return normalizeResearchSettings(JSON.parse(await fs.promises.readFile(p, "utf8")));
}

function getAnalysisSettingsPath() {
  return path.join(getRootDir(), "analysis_setting.json");
}

export async function saveAnalysisSettings(settings: AnalysisSettings): Promise<void> {
  await writeFileAtomic(getAnalysisSettingsPath(), JSON.stringify(settings, undefined, 2), "utf8");
}

export async function loadAnalysisSettings(): Promise<AnalysisSettings> {
  const p = getAnalysisSettingsPath();
  if (!(await exists(p))) {
    return defaultAnalysisSettings();
  }
  return normalizeAnalysisSettings(JSON.parse(await fs.promises.readFile(p, "utf8")));
}

function getMateSearchSettingsPath() {
  return path.join(getRootDir(), "mate_search_setting.json");
}

export async function saveMateSearchSettings(settings: MateSearchSettings): Promise<void> {
  await writeFileAtomic(
    getMateSearchSettingsPath(),
    JSON.stringify(settings, undefined, 2),
    "utf8",
  );
}

export async function loadMateSearchSettings(): Promise<MateSearchSettings> {
  const p = getMateSearchSettingsPath();
  if (!(await exists(p))) {
    return defaultMateSearchSettings();
  }
  return normalizeMateSearchSettings(JSON.parse(await fs.promises.readFile(p, "utf8")));
}

function getLayoutProfileListPath() {
  return path.join(getUserDir(), "layouts.json");
}

export async function saveLayoutProfileList(profileList: LayoutProfileList): Promise<void> {
  await writeFileAtomic(
    getLayoutProfileListPath(),
    JSON.stringify(profileList, undefined, 2),
    "utf8",
  );
}

export async function loadLayoutProfileList(): Promise<LayoutProfileList> {
  const p = getLayoutProfileListPath();
  if (!(await exists(p))) {
    return emptyLayoutProfileList();
  }
  return JSON.parse(await fs.promises.readFile(p, "utf8"));
}

function getBookImportSettingsPath() {
  return path.join(getRootDir(), "book_import.json");
}

export async function saveBookImportSettings(settings: BookImportSettings): Promise<void> {
  await writeFileAtomic(
    getBookImportSettingsPath(),
    JSON.stringify(settings, undefined, 2),
    "utf8",
  );
}

export async function loadBookImportSettings(): Promise<BookImportSettings> {
  const p = getBookImportSettingsPath();
  if (!(await exists(p))) {
    return defaultBookImportSettings();
  }
  return JSON.parse(await fs.promises.readFile(p, "utf8"));
}
