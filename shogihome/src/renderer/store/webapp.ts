import {
  ImmutableRecord,
  importKIF,
  Record,
  RecordMetadataKey,
  exportJKFString,
  importJKFString,
} from "tsshogi";
import { useErrorStore } from "./error.js";
import { isMobileWebApp, isNative } from "@/renderer/ipc/api.js";

const mobileRecordStorageKey = "mobile:record";
const mobilePlyStorageKey = "mobile:ply";
const webAppUsenStorageKey = "webapp:usen";
const webAppJKFStorageKey = "webapp:jkf";
const webAppBranchStorageKey = "webapp:branch";
const webAppPlyStorageKey = "webapp:ply";

export function loadRecordForWebApp(): Record | undefined {
  if (isNative()) {
    return;
  }

  const urlParams = new URL(window.location.toString()).searchParams;
  const usen = urlParams.get("usen");
  if (usen) {
    const branch = parseInt(urlParams.get("branch") || "0", 10);
    const ply = parseInt(urlParams.get("ply") || "0", 10);
    const record = Record.newByUSEN(usen, branch, ply);
    if (record instanceof Error) {
      useErrorStore().add(`棋譜の読み込み中にエラーが発生しました。: ${record}`);
      return;
    }
    const bname = urlParams.get("bname") || "";
    const wname = urlParams.get("wname") || "";
    record.metadata.setStandardMetadata(RecordMetadataKey.BLACK_NAME, bname);
    record.metadata.setStandardMetadata(RecordMetadataKey.WHITE_NAME, wname);
    return record;
  }

  const storedJKF = localStorage.getItem(webAppJKFStorageKey);
  if (storedJKF) {
    const branch = parseInt(localStorage.getItem(webAppBranchStorageKey) || "0", 10);
    const ply = parseInt(localStorage.getItem(webAppPlyStorageKey) || "0", 10);
    const record = importJKFString(storedJKF);
    if (!(record instanceof Error)) {
      record.switchBranchByIndex(branch);
      record.goto(ply);
      return record;
    }
  }

  const storedUsen = localStorage.getItem(webAppUsenStorageKey);
  if (storedUsen) {
    const branch = parseInt(localStorage.getItem(webAppBranchStorageKey) || "0", 10);
    const ply = parseInt(localStorage.getItem(webAppPlyStorageKey) || "0", 10);
    const record = Record.newByUSEN(storedUsen, branch, ply);
    if (!(record instanceof Error)) {
      return record;
    }
  }

  if (!isMobileWebApp()) {
    return;
  }

  const data = localStorage.getItem(mobileRecordStorageKey);
  if (data === null) {
    return;
  }
  const record = importKIF(data);
  if (record instanceof Error) {
    return;
  }
  const ply = Number.parseInt(localStorage.getItem(mobilePlyStorageKey) || "0");
  record.goto(ply);
  return record;
}

function hasUSENParam(): boolean {
  const urlParams = new URL(window.location.toString()).searchParams;
  return !!urlParams.get("usen");
}

let saveTimeout: number | undefined;

export function saveRecordForWebApp(record: ImmutableRecord): void {
  if (isNative()) {
    return;
  }
  if (hasUSENParam()) {
    return;
  }
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = window.setTimeout(() => {
    const jkf = exportJKFString(record);
    const [, branch] = record.usen;
    localStorage.setItem(webAppJKFStorageKey, jkf);
    localStorage.setItem(webAppBranchStorageKey, (branch || 0).toString());
    localStorage.setItem(webAppPlyStorageKey, record.current.ply.toString());
    // USEN is kept for backward compatibility or removed?
    // User requested to preserve metadata, so JKF is primary.
    // Removing USEN key to avoid confusion or keep it as fallback?
    // Let's remove USEN key to clean up, or just overwrite it if we want dual support.
    // For now, let's just save JKF.
    localStorage.removeItem(webAppUsenStorageKey);
  }, 300);
}

export function clearURLParams(): void {
  const url = new URL(window.location.toString());
  url.searchParams.delete("usen");
  url.searchParams.delete("branch");
  url.searchParams.delete("ply");
  url.searchParams.delete("bname");
  url.searchParams.delete("wname");
  window.history.replaceState({}, "", url.toString());
}
