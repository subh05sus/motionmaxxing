import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where everything lives. The code never holds a video: the library does. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PLUGIN = path.join(REPO, "plugin");
export const WEB_DIST = path.join(REPO, "web", "dist");
export const HOME = process.env.MM_HOME || path.join(os.homedir(), ".motionmaxxing");
export const LIBRARY = process.env.MM_LIBRARY || path.join(os.homedir(), "Movies", "motionmaxxing");
export const EDITS = path.join(LIBRARY, "edits");
export const VIDEOS = path.join(LIBRARY, "videos");
export const RECORDINGS = path.join(LIBRARY, "recordings");
export const SESSIONS = path.join(HOME, "studio", "sessions");
export const VPY = path.join(HOME, "venv", "bin", "python");
export const PORT = Number(process.env.MM_PORT || 5199);

export const CUT = path.join(PLUGIN, "skills", "cut", "scripts");
export const SETUP = path.join(PLUGIN, "skills", "setup", "scripts", "setup.py");

export function ensureDirs(): void {
  for (const d of [EDITS, VIDEOS, RECORDINGS, SESSIONS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/** The engine's Python when setup has made it, else the system one (stdlib scripts run on either). */
export const python = (): string => (existsSync(VPY) ? VPY : "python3");

/** Folders Claude may read, write and run in without asking. */
export const ALLOWED_ROOTS = (): string[] => [REPO, LIBRARY, HOME, os.tmpdir(), "/private/tmp", "/tmp"];

export function inside(p: string, roots = ALLOWED_ROOTS()): boolean {
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  return roots.some((root) => abs === root || abs.startsWith(root + path.sep));
}

const GERMAN: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

// Devanagari in Latin letters, for a Hindi file name: consonants carry an "a" unless a vowel sign or a virama follows,
// and a word's last one drops it (मेरा वीडियो -> mera-vidiyo). Dropping the vowel signs as marks left "मर-वडय".
const DEVA_C: Record<string, string> = Object.fromEntries(
  "क k ख kh ग g घ gh ङ n च ch छ chh ज j झ jh ञ n ट t ठ th ड d ढ dh ण n त t थ th द d ध dh न n प p फ ph ब b भ bh म m य y र r ल l ळ l व v श sh ष sh स s ह h"
    .split(" ").reduce<string[][]>((a, x, i) => (i % 2 ? (a[a.length - 1]!.push(x), a) : [...a, [x]]), []));
const DEVA_NUKTA: Record<string, string> = { क: "q", ख: "kh", ग: "g", ज: "z", ड: "r", ढ: "rh", फ: "f", य: "y" };
const DEVA_V: Record<string, string> = { अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e",
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
  "ं": "n", "ँ": "n", "ः": "h", "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };
function devanagari(s: string): string {
  const cs = [...s.normalize("NFD")];
  let out = "";
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!;
    if (DEVA_C[c]) {
      const nukta = cs[i + 1] === "\u093c";
      out += nukta ? DEVA_NUKTA[c] ?? DEVA_C[c] : DEVA_C[c];
      const next = cs[i + (nukta ? 2 : 1)];
      if (nukta) i++;
      if (next === "\u094d") { i++; continue; }                     // virama: no vowel
      if (next && "\u093e\u093f\u0940\u0941\u0942\u0943\u0947\u0948\u094b\u094c\u0949\u0945".includes(next)) continue;   // its vowel sign follows
      if (next && /[\u0900-\u0903\u0915-\u0939\u0958-\u095f]/.test(next)) out += "a";   // the "a" inside a word, not at its end
      continue;
    }
    out += DEVA_V[c] ?? (c === "\u093c" || c === "\u094d" ? "" : c);
  }
  return out;
}

/** A folder- and URL-safe slug: "IMG 1234.MOV" -> "img-1234", "Über Jarvis" -> "ueber-jarvis", "मेरा वीडियो" -> "mera-vidiyo". */
export function slug(s: string): string {
  return s.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[äöüÄÖÜß]/g, (c) => GERMAN[c]!).replace(/[\u0900-\u097f]+/g, devanagari)
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "video";
}
