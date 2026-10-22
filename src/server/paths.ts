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
export const SESSIONS = path.join(HOME, "studio", "sessions");
export const VPY = path.join(HOME, "venv", "bin", "python");
export const PORT = Number(process.env.MM_PORT || 5199);

export const CUT = path.join(PLUGIN, "skills", "cut", "scripts");
export const SETUP = path.join(PLUGIN, "skills", "setup", "scripts", "setup.py");

export function ensureDirs(): void {
  for (const d of [EDITS, VIDEOS, SESSIONS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
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

/** A folder- and URL-safe slug: "IMG 1234.MOV" -> "img-1234", "Über Jarvis" -> "ueber-jarvis". */
export function slug(s: string): string {
  return s.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[äöüÄÖÜß]/g, (c) => GERMAN[c]!).normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "video";
}
