import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A render or a script running on a video shows on its page whatever the stage: a re-render after the edit was
// approved ran with no status at all (the status said "approved" and the editor showed progress only while cutting
// or making).
const LIB = mkdtempSync(path.join(os.tmpdir(), "mm-working-"));
process.env.MM_LIBRARY = LIB;
let lib: typeof import("../library.js");
const kids: ChildProcess[] = [];

const edit = (id: string, record: object) => {
  const d = path.join(LIB, "edits", id);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "studio.json"), JSON.stringify({ title: id, createdAt: new Date().toISOString(), ...record }));
  writeFileSync(path.join(d, "render.mp4"), "old render");
  return d;
};

beforeAll(async () => { lib = await import("../library.js"); });
afterAll(() => { for (const k of kids) k.kill(); });

describe("working", () => {
  it("an approved video being rendered again is being made, with its frame count", () => {
    const d = edit("approved-render", { stage: "done", approved: { cut: "x", edit: "y" } });
    writeFileSync(path.join(d, "progress.jsonl"), `${JSON.stringify({ t: Date.now() / 1000, job: "edit", step: "Making the video", detail: "render.renderer.log" })}\n`);
    writeFileSync(path.join(d, "render.renderer.log"), "Rendered 1793/2060\n");
    expect(lib.status("approved-render")).toBe("making");
    expect(lib.working("approved-render")).toMatchObject({ step: "Making the video", detail: "1793 of 2060 frames" });
    writeFileSync(path.join(d, "render.renderer.log"), "Rendered 2060/2060\nrendered render.mp4 in 312.4 s\n");
    expect(lib.working("approved-render")).toBeNull();
    expect(lib.status("approved-render")).toBe("approved");
  });

  it("a script on the edit folder shows as its step, from the library or by its full path, never another edit's", async () => {
    const d = edit("busy", { stage: "done", approved: { cut: "x", edit: "y" } });
    edit("busy-2", { stage: "done", approved: { cut: "x", edit: "y" } });
    expect(lib.working("busy")).toBeNull();
    // what Claude's Bash runs from the library: a relative edits/<id> (a shell's own command line stands in for it;
    // "; true" keeps the shell from exec'ing sleep, which would drop the arguments)
    kids.push(spawn("/bin/sh", ["-c", "sleep 20; true", "motionmaxxing/plugin/skills/edit/scripts/matte.py", "edits/busy"], { cwd: LIB }));
    await new Promise((r) => setTimeout(r, 1700));   // the process list is read at most every 1.5 s
    expect(lib.working("busy")).toEqual({ step: "Cutting you out for the background" });
    expect(lib.status("busy")).toBe("making");
    expect(lib.working("busy-2")).toBeNull();   // edits/busy is not edits/busy-2
    kids.push(spawn("/bin/sh", ["-c", "sleep 20; true", "motionmaxxing/plugin/skills/edit/scripts/check.py", "render", path.join(d, "x")], { cwd: os.tmpdir() }));
    await new Promise((r) => setTimeout(r, 1700));
    expect(lib.working("busy")?.step).toBe("Checking the video");   // the most telling of the two
  });
});
