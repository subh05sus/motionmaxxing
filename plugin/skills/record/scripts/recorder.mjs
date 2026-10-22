#!/usr/bin/env node
/**
 * The demo recorder: Claude drives a website in motionmaxxing's own browser and every frame is recorded sharp.
 *
 *   node recorder.mjs sites                          the sites the user has allowed
 *   node recorder.mjs allow <host>                   the user said yes once for this site (asked in the first place)
 *   node recorder.mjs login <url> [--minutes 15]     open the browser there so the user signs in (kept in its profile)
 *   node recorder.mjs look <url> --out <dir>         load the page; write look.png and print its controls as JSON
 *   node recorder.mjs run <shots.json> --out <dir>   perform the shot list while recording: frames/, frames.json,
 *                                                    events.json (mouse, clicks, typing, waits, scrolls), then
 *                                                    render.py makes the video
 *
 * The browser is Google Chrome with its own profile in ~/.motionmaxxing/browser: the user's own Chrome, cookies and
 * extensions are never touched. Sign-ins made with `login` stay in that profile.
 *
 * Safety: a site is driven only once the user allowed it (`allow`); a click on anything that deletes, pays, posts,
 * publishes, subscribes or signs out is refused unless its step says "confirmed": true (Claude asks the user first).
 * Emails, phone numbers, keys and IBANs on the page are blurred live, plus every selector in the shot list's "blur".
 *
 * Exit codes: 0 ok, 1 a step failed (fail.png and the reason are written), 2 usage, 3 site not allowed yet.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const require = createRequire(path.join(REPO, "package.json"));
const puppeteer = (() => {
  try { return require(process.env.PUPPETEER_CORE || "puppeteer-core"); }
  catch { console.error("puppeteer-core is missing: run `npm install` in " + REPO); process.exit(2); }
})();

const HOME = process.env.MM_HOME || path.join(os.homedir(), ".motionmaxxing");
const PROFILE = path.join(HOME, "browser");
const SITES = path.join(HOME, "recorder", "sites.json");
const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;

const DESTRUCTIVE = /\b(delete|löschen|remove|entfernen|pay|bezahlen|zahlungspflichtig|purchase|kaufen|buy|bestellen|checkout|subscribe|abonnieren|upgrade|publish|veröffentlichen|post|posten|tweet|share publicly|send money|überweisen|transfer|sign out|log out|logout|abmelden|cancel (subscription|plan)|kündigen|unsubscribe|deactivate|deaktivieren)\b/i;

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const arg = (a, k, d) => (a.includes(k) && a[a.indexOf(k) + 1] !== undefined ? a[a.indexOf(k) + 1] : d);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

function readSites() { try { return JSON.parse(fs.readFileSync(SITES, "utf8")); } catch { return {}; } }
function allowed(u) {
  const h = host(u);
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1") return true;   // the studio itself and local dev servers
  const s = readSites();
  if (s["*"]) return true;   // the user allowed every site (`allow all`); the destructive-click guard still holds
  return Object.keys(s).some((k) => h === k || h.endsWith("." + k));
}

function findChrome() {
  const c = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) { console.error("no Chrome found: install Google Chrome, or set CHROME_PATH"); process.exit(2); }
  return hit;
}

/** A Chrome that crashed leaves its profile locked: clear the lock when its process is gone. */
function unlockProfile() {
  const lock = path.join(PROFILE, "SingletonLock");
  try {
    const target = fs.readlinkSync(lock);             // "<host>-<pid>"
    const pid = Number(target.split("-").pop());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* gone */ }
    if (alive) { console.error("the recording browser is already open: close its window first"); process.exit(2); }
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(PROFILE, f), { force: true });
  } catch { /* no lock */ }
}

async function launch({ headless = false, viewport = true } = {}) {
  fs.mkdirSync(PROFILE, { recursive: true });
  unlockProfile();
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: headless ? "new" : false,
    userDataDir: PROFILE,
    defaultViewport: viewport ? { ...VIEWPORT, deviceScaleFactor: DPR } : null,
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height + 88}`, "--no-first-run", "--no-default-browser-check",
      "--hide-crash-restore-bubble", "--disable-features=Translate,AutofillServerCommunication,MediaRouter,CalculateNativeWinOcclusion",
      "--disable-session-crashed-bubble", "--password-store=basic",
      // keep drawing every frame while the window is behind others or the screen is off: a hidden window records nothing
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      ...(headless ? [`--force-device-scale-factor=${DPR}`] : [])],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

/** Blur personal data live: the shot list's selectors, and any text that is an email, phone number, key or IBAN. */
function blurScript(selectors) {
  const css = [...selectors, "[data-mm-blur]", "input[type=email]", "input[autocomplete=email]"].join(",\n") +
    " { filter: blur(7px) !important; }";
  return `(() => {
    const css = ${JSON.stringify(css)};
    const add = () => { if (document.getElementById("mm-blur-css")) return; const s = document.createElement("style"); s.id = "mm-blur-css"; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/;
    const PLACEHOLDER = /@(?:example|test|acme|demo|domain|email)\\./i;
    const PHONE = /\\+\\d{1,3}[\\s.-]?(?:\\(\\d{1,4}\\)[\\s.-]?)?\\d{2,5}(?:[\\s.-]?\\d{2,5}){1,3}/;
    const KEY = /\\b(?:sk|pk|rk)[-_](?:live|test|prod|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}|\\bgh[pousr]_[A-Za-z0-9]{20,}|\\bAIza[0-9A-Za-z_-]{30,}/;
    const IBAN = /\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){3,7}/;
    const scan = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue; if (!t || t.length < 6) continue;
        const m = t.match(EMAIL);
        if ((m && !PLACEHOLDER.test(m[0])) || PHONE.test(t) || KEY.test(t) || IBAN.test(t)) n.parentElement && n.parentElement.setAttribute("data-mm-blur", "");
      }
    };
    const start = () => { add(); scan(document.body); new MutationObserver((ms) => { for (const m of ms) for (const x of m.addedNodes) { if (x.nodeType === 1) scan(x); else if (x.nodeType === 3 && x.parentElement) scan(x.parentElement); } if (ms.some((m) => m.type === "characterData")) scan(document.body); }).observe(document.body, { childList: true, subtree: true, characterData: true }); };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  })();`;
}

/** In the page: find an element by its selector, visible text, label, or role and name; tag it to get a handle. */
const FIND = `(t) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const label = (el) => norm(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.innerText || el.value || "");
  const CLICKABLE = "a,button,input,textarea,select,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[role=textbox],[contenteditable=true],[tabindex]";
  let el = null;
  if (t.selector) { el = [...document.querySelectorAll(t.selector)].find(vis) || null; }
  else if (t.role || t.name) {
    const want = norm(t.name);
    el = [...document.querySelectorAll(t.role ? "[role=" + t.role + "]," + ({ button: "button", link: "a", textbox: "input,textarea,[contenteditable=true]" }[t.role] || "x-none") : CLICKABLE)]
      .filter(vis).find((e) => !want || label(e) === want) || [...document.querySelectorAll(CLICKABLE)].filter(vis).find((e) => want && label(e).includes(want)) || null;
  } else if (t.text) {
    const want = norm(t.text);
    const all = [...document.querySelectorAll(CLICKABLE + ",h1,h2,h3,h4,p,li,span,div,td,th")].filter(vis);
    const score = (e) => { const l = label(e); if (!l.includes(want)) return -1; let s = 100 - Math.min(90, l.length - want.length); if (l === want) s += 100; if (e.matches(CLICKABLE)) s += 40; return s; };
    let best = null, bs = -1;
    for (const e of all) { const s = score(e); if (s > bs || (s === bs && best && best.contains(e))) { best = e; bs = s; } }
    el = bs >= 0 ? best : null;
  }
  if (!el) return null;
  if (t.nth) { /* the nth match of a selector, 1-based */ const list = [...document.querySelectorAll(t.selector || "*")].filter(vis); el = list[t.nth - 1] || el; }
  const id = "t" + Math.random().toString(36).slice(2, 9);
  el.setAttribute("data-mm-t", id);
  const r = el.getBoundingClientRect();
  return { id, box: [r.left, r.top, r.width, r.height], label: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.value || "").trim().slice(0, 120), tag: el.tagName.toLowerCase() };
}`;

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ------------------------------------------------------------------ the session: a page, the mouse, the log
class Session {
  constructor(page, log) { this.page = page; this.log = log; this.mouse = [VIEWPORT.width * 0.5, VIEWPORT.height * 0.62]; }

  async find(target, timeoutS = 10) {
    const end = now() + timeoutS;
    for (;;) {
      const hit = await this.page.evaluate(`(${FIND})(${JSON.stringify(target)})`).catch(() => null);
      if (hit) return { ...hit, handle: await this.page.$(`[data-mm-t="${hit.id}"]`) };
      if (now() > end) throw new Error(`could not find ${JSON.stringify(target)} on the page`);
      await sleep(200);
    }
  }

  /** A hand on a mouse: an eased, slightly curved path at about 60 Hz, every point logged. */
  async moveTo(x, y) {
    const [x0, y0] = this.mouse, dist = Math.hypot(x - x0, y - y0);
    if (dist < 1) return;
    const ms = Math.max(280, Math.min(900, 240 + dist * 0.42));
    const steps = Math.max(8, Math.round(ms / 16));
    const bend = jitter(-0.12, 0.12) * dist, nx = -(y - y0) / dist, ny = (x - x0) / dist;
    const cx = (x0 + x) / 2 + nx * bend, cy = (y0 + y) / 2 + ny * bend;
    for (let i = 1; i <= steps; i++) {
      const u = easeInOut(i / steps);
      const px = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x, py = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y;
      await this.page.mouse.move(px, py);
      this.mouse = [px, py];
      this.log.mouse.push([now(), +px.toFixed(1), +py.toFixed(1)]);
      await sleep(16);
    }
  }

  /** Where a hand would click on a box: the middle, the left part of a wide text field. */
  aim(box) {
    const [l, t, w, h] = box;
    const x = w > 360 && h < 120 ? l + Math.min(w * 0.25, 160) : l + w / 2;
    return [x + jitter(-2, 2), t + h / 2 + jitter(-1.5, 1.5)];
  }

  async click(target, step) {
    const hit = await this.find(target, step.timeout ?? 10);
    if (DESTRUCTIVE.test(hit.label) && !step.confirmed) {
      throw new Error(`refused: "${hit.label.slice(0, 60)}" looks like it deletes, pays, posts or signs out. Ask the user, then add "confirmed": true to this step.`);
    }
    await hit.handle.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
    const fresh = await this.find({ selector: `[data-mm-t="${hit.id}"]` }, 2);
    const [x, y] = this.aim(fresh.box);
    await this.moveTo(x, y);
    await sleep(jitter(70, 130));
    const t = now();
    this.log.clicks.push([t, +x.toFixed(1), +y.toFixed(1)]);
    this.log.actions.push({ t, kind: "click", box: fresh.box, label: fresh.label });
    await this.page.mouse.down();
    await sleep(jitter(55, 90));
    await this.page.mouse.up();
    return fresh;
  }

  async type(text, step) {
    let box = null;
    if (step.target) box = (await this.click(step.target, step)).box;
    const cps = step.cps ?? 16;
    const t0 = now();
    for (const ch of text) {
      if (ch === "\n") { await this.page.keyboard.down("Shift"); await this.page.keyboard.press("Enter"); await this.page.keyboard.up("Shift"); }
      else await this.page.keyboard.type(ch);
      let d = (1000 / cps) * jitter(0.55, 1.45);
      if (/[.,!?:;]/.test(ch)) d += jitter(90, 220); else if (ch === " ") d += jitter(0, 50);
      await sleep(d);
    }
    if (!box) box = await this.page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    this.log.actions.push({ t: t0, end: now(), kind: "type", box, chars: [...text].length });
  }

  /** Smooth scroll of the right container: the target's scrollable ancestor, or what is under the middle. */
  async scroll(step) {
    let box = null, handleId = null;
    // the target as "to", or written the long way ("to": {"target": ...}, or "target")
    const goal = step.to && typeof step.to === "object" ? (step.to.target ?? step.to) : step.target;
    if (goal) { const hit = await this.find(goal, step.timeout ?? 10); handleId = hit.id; box = hit.box; }
    const t0 = now();
    const ms = await this.page.evaluate(async (o) => {
      const scrollable = (e) => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll)/.test(s.overflowY) && x.scrollHeight > x.clientHeight + 4) return x; } return document.scrollingElement; };
      let el, dy;
      if (o.id) {
        const t = document.querySelector(`[data-mm-t="${o.id}"]`); el = scrollable(t.parentElement);
        const r = t.getBoundingClientRect(), base = el === document.scrollingElement ? 0 : el.getBoundingClientRect().top;
        const view = el === document.scrollingElement ? innerHeight : el.clientHeight;
        dy = r.top - base - view * (o.at ?? 0.3);
      } else {
        el = scrollable(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
        dy = o.to === "bottom" ? el.scrollHeight - el.clientHeight - el.scrollTop : o.to === "top" ? -el.scrollTop : (o.by ?? innerHeight * 0.7);
      }
      const start = el.scrollTop, dur = o.ms ?? Math.max(700, Math.min(2600, 500 + Math.abs(dy) * 0.7));
      const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      await new Promise((done) => { const t0 = performance.now(); const tick = (n) => { const u = Math.min(1, (n - t0) / dur); el.scrollTop = start + dy * ease(u); if (u < 1) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
      return dur;
    }, { id: handleId, to: typeof step.to === "string" ? step.to : undefined, by: step.by, ms: step.ms, at: step.at });
    this.log.scrolls.push([t0, now()]);
    if (box) this.log.actions.push({ t: now(), kind: "scrolled-to", box: await this.page.evaluate((id) => { const e = document.querySelector(`[data-mm-t="${id}"]`); const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, handleId) });
    return ms;
  }

  /** Wait for a condition; the time it takes is what the render speeds up. */
  async wait(cond, step) {
    const t0 = now(), max = step.max ?? (cond.idle ? 180 : 30);
    const check = async () => this.page.evaluate((c) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden"; };
      if (c.selector) return [...document.querySelectorAll(c.selector)].some(vis);
      if (c.gone) return ![...document.querySelectorAll(c.gone)].some(vis);
      if (c.text) return (document.body.innerText || "").toLowerCase().includes(c.text.toLowerCase());
      return true;
    }, cond).catch(() => false);
    if (cond.idle) {
      // Quiet: no change on the page for `quiet` ms (default 2.5 s), and no Stop button (a reply still streaming).
      const quiet = (cond.quiet ?? 2.5) * 1000;
      await this.page.evaluate(() => {
        window.__mmChanged = performance.now();
        if (!window.__mmObs) { window.__mmObs = new MutationObserver(() => { window.__mmChanged = performance.now(); }); window.__mmObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: false }); }
      });
      await sleep(600);
      for (;;) {
        const s = await this.page.evaluate((stop) => {
          const busy = [...document.querySelectorAll(stop)].some((b) => b.getBoundingClientRect().width > 0);
          return { since: performance.now() - window.__mmChanged, busy };
        }, cond.busy ?? 'button[aria-label*="Stop" i], button[aria-label*="Anhalten" i], [data-testid*="stop" i]').catch(() => ({ since: 0, busy: true }));
        if (!s.busy && s.since >= quiet) break;
        if (now() - t0 > max) throw new Error(`still busy after ${max} s`);
        await sleep(250);
      }
    } else {
      while (!(await check())) {
        if (now() - t0 > max) throw new Error(`waited ${max} s for ${JSON.stringify(cond)}`);
        await sleep(150);
      }
    }
    this.log.waits.push([t0, now(), step.speed === "normal" ? "normal" : "fast"]);
  }
}

// ------------------------------------------------------------------ recording
async function record(page, dir) {
  const fdir = path.join(dir, "frames");
  fs.rmSync(fdir, { recursive: true, force: true });
  fs.mkdirSync(fdir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [], writes = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const name = String(++n).padStart(6, "0") + ".jpg";
    frames.push([metadata?.timestamp ?? now(), name]);
    writes.push(fs.promises.writeFile(path.join(fdir, name), Buffer.from(data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.width * DPR, maxHeight: VIEWPORT.height * DPR, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
      // A static page sends no frames: the last one holds. One fresh frame marks the end.
      const name = String(++n).padStart(6, "0") + ".jpg";
      await page.screenshot({ path: path.join(fdir, name), type: "jpeg", quality: 92 });
      frames.push([now(), name]);
      fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify(frames));
      return frames.length;
    },
  };
}

async function run(shotsPath, dir) {
  const shots = JSON.parse(fs.readFileSync(shotsPath, "utf8"));
  const urls = [shots.url, ...(shots.steps ?? []).filter((s) => s.do === "goto").map((s) => s.url)];
  const blocked = urls.filter((u) => !allowed(u));
  if (blocked.length) {
    console.error(`not allowed yet: ${[...new Set(blocked.map(host))].join(", ")}. Ask the user once (AskUserQuestion), then: node recorder.mjs allow <host>`);
    process.exit(3);
  }
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(shotsPath) !== path.resolve(dir, "shots.json")) fs.copyFileSync(shotsPath, path.join(dir, "shots.json"));
  const browser = await launch({ headless: !!shots.headless });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  if (shots.viewport) await page.setViewport({ ...VIEWPORT, ...shots.viewport, deviceScaleFactor: DPR });
  const vp = page.viewport();
  await page.evaluateOnNewDocument(blurScript(shots.blur ?? []));
  const log = { version: 1, url: shots.url, viewport: [vp.width, vp.height], dpr: DPR, mouse: [], clicks: [], actions: [], waits: [], scrolls: [], navs: [], steps: [] };
  const say = (s) => { process.stdout.write(s + "\n"); fs.appendFileSync(path.join(dir, "run.log"), s + "\n"); };
  fs.writeFileSync(path.join(dir, "run.log"), "");
  let failed = null;
  try {
    say(`opening ${shots.url}`);
    await page.goto(shots.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 15000 }).catch(() => {});
    await page.evaluate(blurScript(shots.blur ?? []));
    await sleep(shots.settle ?? 800);
    if (/\/(login|signin|sign-in|auth)\b/i.test(page.url())) throw new Error(`the site asks to sign in (${page.url()}): node recorder.mjs login ${shots.url}`);
    const s = new Session(page, log);
    await page.mouse.move(...s.mouse);
    const rec = await record(page, dir);
    log.t0 = now();
    await sleep(shots.lead ?? 700);
    for (const [i, step] of (shots.steps ?? []).entries()) {
      const t = now();
      say(`step ${i + 1}: ${step.do}${step.text ? ` "${String(step.text).slice(0, 40)}"` : ""}${step.target ? " " + JSON.stringify(step.target) : ""}`);
      try {
        switch (step.do) {
          case "goto": {
            const t0 = now();
            await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
            log.navs.push([t0, now(), step.url]);
            log.waits.push([t0, now(), "fast"]);
            break;
          }
          case "click": await s.click(step.target, step); break;
          case "hover": { const h = await s.find(step.target, step.timeout ?? 10); await s.moveTo(...s.aim(h.box)); log.actions.push({ t: now(), kind: "hover", box: h.box }); break; }
          case "type": await s.type(String(step.text ?? ""), step); break;
          case "press": {
            const keys = String(step.key).split("+");
            for (const k of keys.slice(0, -1)) await page.keyboard.down(k);
            await page.keyboard.press(keys[keys.length - 1]);
            for (const k of keys.slice(0, -1).reverse()) await page.keyboard.up(k);
            log.actions.push({ t: now(), kind: "press", key: step.key });
            break;
          }
          case "wait": await s.wait(step.for ?? { idle: true }, step); break;
          case "scroll": await s.scroll(step); break;
          case "focus": { const h = await s.find(step.target, step.timeout ?? 10); log.actions.push({ t: now(), end: now() + (step.ms ?? 1800) / 1000, kind: "focus", box: h.box }); await sleep(step.ms ?? 1800); break; }
          case "pause": await sleep(step.ms ?? 1000); break;
          default: throw new Error(`unknown step "${step.do}"`);
        }
        if (step.after) await sleep(step.after);
        else if (step.do !== "pause" && step.do !== "wait") await sleep(jitter(250, 450));
        log.steps.push({ i, do: step.do, start: t, end: now(), ok: true });
      } catch (e) {
        log.steps.push({ i, do: step.do, start: t, end: now(), ok: false, error: e.message });
        failed = `step ${i + 1} (${step.do}): ${e.message}`;
        break;
      }
    }
    await sleep(shots.tail ?? 1200);
    log.t1 = now();
    const nf = await rec.stop();
    say(`${nf} frames, ${(log.t1 - log.t0).toFixed(1)} s`);
  } catch (e) {
    failed = failed ?? e.message;
  }
  if (failed) {
    await page.screenshot({ path: path.join(dir, "fail.png") }).catch(() => {});
    say(`FAILED ${failed} (fail.png shows the page)`);
  }
  log.ok = !failed;
  log.error = failed ?? undefined;
  fs.writeFileSync(path.join(dir, "events.json"), JSON.stringify(log));
  await browser.close();
  process.exit(failed ? 1 : 0);
}

/** The page as Claude needs it to plan: a screenshot, and every visible control with a selector that finds it again. */
async function look(url, dir, a) {
  if (!allowed(url)) { console.error(`not allowed yet: ${host(url)}. Ask the user once, then: node recorder.mjs allow ${host(url)}`); process.exit(3); }
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch({ headless: a.includes("--headless") });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(blurScript([]));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 15000 }).catch(() => {});
    await sleep(Number(arg(a, "--settle", 800)));
    const shot = path.join(dir, "look.png");
    await page.screenshot({ path: shot });
    const info = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none"; };
      const q = (v) => '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
      const sel = (el) => {
        const tag = el.tagName.toLowerCase();
        if (el.id && !/\d{4,}|:/.test(el.id) && unique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
        for (const a of ["data-testid", "data-test", "data-qa", "aria-label", "name", "placeholder", "title", "href"]) {
          const v = el.getAttribute(a);
          if (v && v.length < 90) { const s = `${tag}[${a}=${q(v)}]`; if (unique(s)) return s; }
        }
        const path = [];
        for (let x = el; x && x !== document.documentElement; x = x.parentElement) {
          const t = x.tagName.toLowerCase();
          if (x !== el && (x.id && !/\d{4,}|:/.test(x.id))) { path.unshift("#" + CSS.escape(x.id)); break; }
          const sib = [...(x.parentElement?.children ?? [])].filter((y) => y.tagName === x.tagName);
          path.unshift(sib.length > 1 ? `${t}:nth-of-type(${sib.indexOf(x) + 1})` : t);
          if (path.length > 12) break;
        }
        const s = path.join(" > ");
        return unique(s) ? s : null;   // no stable selector: target it by its text or role and name
      };
      const els = [...document.querySelectorAll("a,button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=textbox],[role=combobox],[contenteditable=true]")].filter(vis);
      const controls = els.slice(0, 160).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          role: el.getAttribute("role") || el.tagName.toLowerCase(),
          name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.value || "").replace(/\s+/g, " ").trim().slice(0, 70),
          selector: sel(el), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          inView: r.top < innerHeight && r.bottom > 0,
        };
      });
      const heads = [...document.querySelectorAll("h1,h2,h3")].filter(vis).slice(0, 25).map((h) => h.innerText.trim().slice(0, 90));
      return { title: document.title, url: location.href, headings: heads, text: (document.body.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 2500), controls };
    });
    info.signIn = /\/(login|signin|sign-in|auth)\b/i.test(info.url) || /\b(sign in|log in|anmelden|einloggen)\b/i.test(info.headings.join(" "));
    info.screenshot = shot;
    fs.writeFileSync(path.join(dir, "look.json"), JSON.stringify(info, null, 1));
    console.log(JSON.stringify(info, null, 1));
  } finally {
    await browser.close();
  }
}

async function login(url, minutes) {
  const browser = await launch({ viewport: false });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  console.log(`The recording browser is open at ${url}. Sign in there, then close its window.`);
  const end = Date.now() + minutes * 60_000;
  while (browser.connected && Date.now() < end) {
    await sleep(1000);
    const pages = await browser.pages().catch(() => []);
    if (!pages.length) break;
  }
  const u = browser.connected ? (await browser.pages().catch(() => []))[0]?.url() : undefined;
  await browser.close().catch(() => {});
  console.log(u && /\/(login|signin|auth)/i.test(u) ? "still on the sign-in page" : "done: the sign-in is kept in the recording browser");
}

// ------------------------------------------------------------------ main
const a = process.argv.slice(2);
const cmd = a[0];
if (cmd === "sites") {
  console.log(JSON.stringify(readSites(), null, 1));
} else if (cmd === "allow" && a[1]) {
  const h = a[1] === "all" || a[1] === "*" ? "*" : host(a[1].includes("://") ? a[1] : "https://" + a[1]);
  const s = readSites();
  s[h] = { allowed: new Date().toISOString() };
  fs.mkdirSync(path.dirname(SITES), { recursive: true });
  fs.writeFileSync(SITES, JSON.stringify(s, null, 1));
  console.log(h === "*" ? "allowed: every site" : `allowed: ${h}`);
} else if (cmd === "login" && a[1]) {
  await login(a[1], Number(arg(a, "--minutes", 15)));
} else if (cmd === "look" && a[1]) {
  await look(a[1], arg(a, "--out", path.join(os.tmpdir(), "mm-look")), a);
} else if (cmd === "run" && a[1]) {
  const out = arg(a, "--out", path.dirname(path.resolve(a[1])));
  await run(a[1], path.resolve(out));
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 22).map((l) => l.replace(/^ \*\s?/, "")).join("\n"));
  process.exit(2);
}
