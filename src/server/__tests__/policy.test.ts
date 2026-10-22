import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { needsPermission } from "../claude.js";
import { isKept } from "../library.js";
import { LIBRARY, REPO, inside, slug } from "../paths.js";

describe("what Claude may do without asking", () => {
  it("runs the studio's own tools freely", () => {
    expect(needsPermission("Read", { file_path: path.join(LIBRARY, "edits", "a", "spans.json") })).toBeNull();
    expect(needsPermission("Write", { file_path: path.join(LIBRARY, "edits", "a", "spans.json") })).toBeNull();
    expect(needsPermission("Bash", { command: `python3 ${REPO}/plugin/skills/cut/scripts/render.py src edits/a` })).toBeNull();
    expect(needsPermission("AskUserQuestion", {})).toBeNull();
  });
  it("asks for writes outside the studio's folders", () => {
    expect(needsPermission("Write", { file_path: path.join(os.homedir(), "Documents", "x.txt") })).toMatch(/outside/);
  });
  it("asks before anything leaves the Mac or deletes broadly", () => {
    expect(needsPermission("Bash", { command: "git push origin main" })).toMatch(/outside this Mac/);
    expect(needsPermission("Bash", { command: "curl -X POST https://example.com -d x" })).toMatch(/outside this Mac/);
    expect(needsPermission("Bash", { command: "rm -rf ~/" })).toMatch(/deletes broadly/);
    expect(needsPermission("Bash", { command: `cat ${path.join(os.homedir(), ".ssh", "id_rsa")}` })).toMatch(/outside/);
  });
  it("asks before a connected service is used", () => {
    expect(needsPermission("mcp__claude-in-chrome__navigate", { url: "https://claude.ai" })).toMatch(/connected service/);
  });
  it("knows its folders", () => {
    expect(inside(path.join(LIBRARY, "edits"))).toBe(true);
    expect(inside(path.join(os.homedir(), "Desktop"))).toBe(false);
  });
});

describe("names and words", () => {
  it("makes folder-safe names", () => {
    expect(slug("IMG 1234.MOV")).toBe("img-1234");
    expect(slug("Über Jarvis – Teil 2")).toBe("ueber-jarvis-teil-2");
    expect(slug("Café crème.mov")).toBe("cafe-creme");
    expect(slug("...")).toBe("video");
  });
  it("calls a word kept the way the timeline builder does", () => {
    const spans = [{ start: 1, end: 2 }];
    expect(isKept({ start: 1.2, end: 1.5 }, spans)).toBe(true);
    expect(isKept({ start: 1.95, end: 2.4 }, spans)).toBe(false);
    expect(isKept({ start: 1.88, end: 2.3 }, spans)).toBe(true);
  });
});
