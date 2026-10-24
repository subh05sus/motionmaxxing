import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PLUGIN, ROOT, type Profile, profiles, python } from "./paths.js";

const run = promisify(execFile);

/**
 * Profiles for the studio: one creator each (plugin/lib/mm/profiles.py makes the folders and profiles.json, so the
 * layout lives in one place). The studio lists them, adds one, and reads and writes a profile's own settings in its
 * profile.json: language, brand kit, names and terms, social handles, export folder, the usual call to action.
 */

export const OWN = ["lang", "brand", "names", "handles", "export_dir", "cta", "defaults"] as const;

/** What a new video starts with (its adjust.json), unless the profile's own "defaults" say otherwise: studio sound with
 *  the music dipping under the voice; no look (a profile turns it on with a reference, e.g. another profile's reels). */
export const NEW_VIDEO = {
  audio: { on: true, duck: true, echo: false, breaths: false, match: false },
  look: { on: false, strength: 1 },
};
export function newVideoAdjust(p: Profile | undefined): Record<string, unknown> {
  const d = (p ? (settings(p).defaults as Record<string, Record<string, unknown>> | undefined) : undefined) ?? {};
  return { audio: { ...NEW_VIDEO.audio, ...(d.audio ?? {}) }, look: { ...NEW_VIDEO.look, ...(d.look ?? {}) } };
}
export type Settings = Partial<Record<(typeof OWN)[number], unknown>>;

export const byId = (id: string): Profile | undefined => profiles().find((p) => p.id === id);
export const folder = (p: Profile): string => path.join(ROOT, p.folder);

export function settings(p: Profile): Settings & Record<string, unknown> {
  try { return JSON.parse(readFileSync(path.join(folder(p), "profile.json"), "utf8")); } catch { return {}; }
}

/** Only a profile's own keys are written here; the shared answers stay in $MM_HOME/profile.json. */
export function saveSettings(p: Profile, patch: Record<string, unknown>): Settings {
  const next: Record<string, unknown> = { ...settings(p) };
  for (const k of OWN) if (k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }   // null: cleared
  writeFileSync(path.join(folder(p), "profile.json"), JSON.stringify(next, null, 1));
  return next;
}

/** A new profile through profiles.py add (its folders, its colour, settings copied from another when asked). */
export async function add(name: string, opts: { lang?: string; copyFrom?: string } = {}): Promise<Profile> {
  const args = [path.join(PLUGIN, "lib", "mm", "profiles.py"), "add", name,
    ...(opts.lang ? ["--lang", opts.lang] : []), ...(opts.copyFrom ? ["--from", opts.copyFrom] : [])];
  const { stdout } = await run(python(), args, { env: { ...process.env, MM_LIBRARY: ROOT } });
  return JSON.parse(stdout.trim().split("\n").pop()!) as Profile;
}

function write(list: Profile[]): void {
  const f = path.join(ROOT, "profiles.json");
  const d = (() => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } })();
  writeFileSync(f, JSON.stringify({ ...d, profiles: list }, null, 1));
}

export function rename(id: string, name: string): Profile {
  const list = profiles(), p = list.find((x) => x.id === id);
  if (!p) throw new Error("no such profile");
  p.name = name.trim().slice(0, 40) || p.name;   // the folder keeps its name: paths in the profile's videos stay right
  write(list);
  return p;
}

/** The profile's picture: a file in its folder (picture.jpg, .png...), named in profiles.json. */
export function setPicture(id: string, file: string): Profile {
  const list = profiles(), p = list.find((x) => x.id === id);
  if (!p) throw new Error("no such profile");
  p.picture = path.basename(file);
  write(list);
  return p;
}
export const picturePath = (p: Profile): string | undefined => (p.picture && existsSync(path.join(folder(p), p.picture)) ? path.join(folder(p), p.picture) : undefined);

/** What the studio shows of a profile. */
export function card(p: Profile) {
  const s = settings(p);
  return { id: p.id, name: p.name, color: p.color, picture: picturePath(p) ? `/api/profiles/${encodeURIComponent(p.id)}/picture?v=${encodeURIComponent(p.picture ?? "")}` : null,
    lang: (s.lang as string | undefined) ?? null, handles: (s.handles as Record<string, string> | undefined) ?? {} };
}
