import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Profiles: a request (or the work it starts) runs as one creator's profile, and every per-profile path follows it.
const LIB = mkdtempSync(path.join(os.tmpdir(), "mm-profiles-"));
process.env.MM_LIBRARY = LIB;
process.env.MM_HOME = mkdtempSync(path.join(os.tmpdir(), "mm-profiles-home-"));
let paths: typeof import("../paths.js");
let lib: typeof import("../library.js");
let trash: typeof import("../trash.js");

beforeAll(async () => { paths = await import("../paths.js"); lib = await import("../library.js"); trash = await import("../trash.js"); });

const take = (folder: string, name: string) => { const f = path.join(LIB, folder, "videos", name); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, "x"); return f; };

describe("profiles", () => {
  it("uses the library as it always was without profiles", () => {
    expect(paths.profiles()).toEqual([]);
    expect(paths.profileId()).toBeNull();
    expect(paths.LIBRARY()).toBe(LIB);
    expect(paths.EDITS()).toBe(path.join(LIB, "edits"));
    expect(paths.profileEnv()).toEqual({ MM_LIBRARY: LIB });
  });

  it("works in the request's profile, else the one last picked here, else the first", () => {
    writeFileSync(path.join(LIB, "profiles.json"), JSON.stringify({ profiles: [
      { id: "anna", name: "Anna", folder: "Anna" }, { id: "ben", name: "Ben K", folder: "Ben K" }] }));
    expect(paths.withProfile("ben", () => paths.LIBRARY())).toBe(path.join(LIB, "Ben K"));
    expect(paths.withProfile("ben", () => paths.SESSIONS())).toBe(path.join(LIB, "Ben K", ".studio", "sessions"));
    expect(paths.withProfile("ben", () => paths.profileEnv())).toEqual({ MM_LIBRARY: LIB, MM_PROFILE: "ben" });
    expect(paths.withProfile(null, () => paths.profileId())).toBe("anna");
    paths.pickProfile("ben");
    expect(paths.withProfile(null, () => paths.profileId())).toBe("ben");
    expect(paths.withProfile("nobody", () => paths.profileId())).toBe("ben");   // a stale cookie: the last pick
    expect(paths.withProfile("anna", () => trash.TRASH())).toBe(path.join(LIB, "Anna", ".trash"));
  });

  it("keeps the profile across the work a request starts", async () => {
    const got = await paths.withProfile("anna", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Promise<string | null>((resolve) => setImmediate(() => resolve(paths.profileId())));
    });
    expect(got).toBe("anna");
  });

  it("shows each profile its own videos, and the shared b-roll and recordings to both", () => {
    const id = paths.withProfile("anna", () => lib.newEdit("Talk", take("Anna", "talk.mp4")));
    expect(paths.withProfile("anna", () => lib.ids())).toContain(id);
    expect(paths.withProfile("ben", () => lib.ids())).not.toContain(id);
    expect(paths.withProfile("anna", () => lib.editDir(id))).toBe(path.join(LIB, "Anna", "edits", id));
    for (const p of ["anna", "ben"]) {
      expect(paths.withProfile(p, () => paths.BROLL)).toBe(path.join(LIB, "broll"));
      expect(paths.withProfile(p, () => paths.RECORDINGS)).toBe(path.join(LIB, "recordings"));
    }
  });
});
