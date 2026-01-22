import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");

export function getUserDataPath(): string {
  return dataDir;
}

export const electronLicensePath = ""; // Not used in Web/LAN version
export const chromiumLicensePath = ""; // Not used in Web/LAN version
