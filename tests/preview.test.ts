import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreviewDocument, resolveRef } from "@/lib/preview";

function loadDir(root: string, dir = root, out: Record<string, string> = {}) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) loadDir(root, full, out);
    else out[path.relative(root, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
}

const decode = (url: string) => Buffer.from(url.split(",")[1], "base64").toString("utf8");

describe("instant preview document", () => {
  const files = loadDir(path.resolve(import.meta.dirname, "../fixtures/task-manager"));

  it("inlines CSS and turns module scripts (and their imports) into data URLs", () => {
    const doc = buildPreviewDocument(files)!;
    expect(doc).toContain("<style");
    expect(doc).toContain(".stats");
    const src = /<script[^>]*src="(data:[^"]+)"/.exec(doc)![1];
    const app = decode(src);
    expect(app).toContain("render()");
    const imported = /from "(data:[^"]+)"/.exec(app)![1];
    expect(decode(imported)).toContain("export function toggleTask");
  });

  it("resolves absolute, relative and external references", () => {
    expect(resolveRef("/src/app.js", "public/index.html", files)).toBe("src/app.js");
    expect(resolveRef("styles.css", "public/index.html", files)).toBe("public/styles.css");
    expect(resolveRef("https://cdn.example.com/x.js", "public/index.html", files)).toBeNull();
  });

  it("returns null when there is no HTML entry", () => {
    expect(buildPreviewDocument({ "src/a.js": "" })).toBeNull();
  });
});
