import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// New video's clips (takes and b-roll dropped at once) and the library's b-roll.
const LIB = mkdtempSync(path.join(os.tmpdir(), "mm-clips-"));
process.env.MM_LIBRARY = LIB;
let lib: typeof import("../library.js");
let clips: typeof import("../clips.js");
const file = (name: string) => { const f = path.join(LIB, "videos", name); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, "x"); return f; };

beforeAll(async () => { lib = await import("../library.js"); clips = await import("../clips.js"); });

describe("clips", () => {
  it("adds clips, moves a take and remembers the order, removes one", () => {
    const id = lib.newEdit("take one", file("a.mp4"));
    clips.addClip(id, path.join(LIB, "videos", "a.mp4"), "a.mp4");
    clips.addClip(id, file("b.mp4"), "b.mp4");
    clips.addClip(id, file("c.mp4"), "c.mp4");
    const r = lib.record(id);
    r.files = r.files!.map((c) => ({ ...c, kind: "take" as const }));
    lib.saveRecord(id, r);
    clips.setClip(id, 2, { move: -1 });
    expect(clips.clips(id).map((c) => c.name)).toEqual(["a.mp4", "c.mp4", "b.mp4"]);
    expect(lib.record(id).ordered).toBe(true);
    clips.setClip(id, 0, { kind: "broll" });
    expect(clips.clips(id)[0]).toMatchObject({ kind: "broll", chosen: true });
    const gone = clips.removeClip(id, 0);
    expect(gone.name).toBe("a.mp4");
    expect(lib.record(id).source).toBe(path.join(LIB, "videos", "c.mp4"));   // the video's source moves to a clip left
  });

  it("a clip whose file vanished before its check leaves the list, never 'checking' for ever", async () => {
    const id = lib.newEdit("vanished", file("v.mp4"));
    clips.addClip(id, path.join(LIB, "videos", "gone.mp4"), "gone.mp4");
    let done = 0;
    clips.resume(id, () => { done++; });
    await new Promise((r) => setTimeout(r, 1800));
    expect(done).toBe(1);
    expect(clips.clips(id).some((c) => c.name === "gone.mp4")).toBe(false);
  });
});

describe("the library's b-roll", () => {
  it("saves a clip under a readable name, lists it, renames it (the file too)", () => {
    const src = path.join(LIB, "incoming.mov");
    writeFileSync(src, "clip");
    const saved = clips.saveBroll(src, "City at night", { id: "v1", title: "My video" }, 4.2);
    expect(path.basename(saved)).toBe("city-at-night.mov");
    expect(existsSync(src)).toBe(false);
    const list = clips.brollList();
    expect(list[0]).toMatchObject({ file: "city-at-night.mov", title: "City at night", from: { id: "v1" }, duration: 4.2 });
    const to = clips.renameBroll("city-at-night.mov", "Kolkata street");
    expect(to).toBe("kolkata-street.mov");
    expect(clips.brollList().map((b) => b.title)).toEqual(["Kolkata street"]);
    expect(JSON.parse(readFileSync(path.join(clips.BROLL, "broll.json"), "utf8")).clips["kolkata-street.mov"].from.title).toBe("My video");
    writeFileSync(path.join(clips.BROLL, "by-hand.mp4"), "x");   // put in the folder in Finder: listed too
    expect(clips.brollList().map((b) => b.file).sort()).toEqual(["by-hand.mp4", "kolkata-street.mov"]);
  });
});
