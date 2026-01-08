import fs from "fs";
import path from "path";

const srcFile = path.join("docs", "third-party-licenses.html");
const destFile = path.join("docs", "webapp", "third-party-licenses.html");
const srcDir = path.join("docs", "third-party-licenses");
const destDir = path.join("docs", "webapp", "third-party-licenses");

// Copy file
try {
  fs.copyFileSync(srcFile, destFile);
  console.log(`Copied ${srcFile} to ${destFile}`);
} catch (err) {
  console.error(`Error copying file: ${err}`);
  process.exit(1);
}

// Copy directory
try {
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.cpSync(srcDir, destDir, { recursive: true });
  console.log(`Copied ${srcDir} to ${destDir}`);
} catch (err) {
  console.error(`Error copying directory: ${err}`);
  process.exit(1);
}
