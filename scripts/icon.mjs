// Renders assets/icon.svg to assets/AppIcon.icns (macOS) and web/public/icon.png, with the local Chrome.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const svg = fs.readFileSync(path.join(root, "assets", "icon.svg"), "utf8");
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-icon-"));
const png = path.join(tmp, "icon.png");
await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
const set = path.join(tmp, "AppIcon.iconset");
fs.mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync("sips", ["-z", String(s), String(s), png, "--out", path.join(set, `icon_${s}x${s}.png`)], { stdio: "ignore" });
  execFileSync("sips", ["-z", String(s * 2), String(s * 2), png, "--out", path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(root, "assets", "AppIcon.icns")]);
fs.mkdirSync(path.join(root, "web", "public"), { recursive: true });
execFileSync("sips", ["-z", "256", "256", png, "--out", path.join(root, "web", "public", "icon.png")], { stdio: "ignore" });
fs.rmSync(tmp, { recursive: true, force: true });
console.log("assets/AppIcon.icns, web/public/icon.png");
