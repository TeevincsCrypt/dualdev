import { describe, expect, it } from "vitest";
import { buildBlocksToJson, parseBlocks, repairBlocksToJson } from "@/lib/ai/blocks";
import { validateBuildOutput } from "@/lib/agent/builder";

const sample = `<<<NAME>>>
coffee-landing
<<<PLAN>>>
- hero, menu, contact
<<<LIMITATIONS>>>
static only
<<<FILE package.json>>>
{"type":"module","scripts":{"start":"node server.js","test":"node --test test/"}}
<<<END>>>
<<<FILE public/index.html>>>
<!doctype html><h1 class="x">Say "hi" \\n it's {fine}</h1>
<script type="module" src="/src/app.js"></script>
<<<END>>>
<<<FILE server.js>>>
\`\`\`js
console.log("srv");
\`\`\`
<<<END>>>
<<<FILE src/app.js>>>
export const a = 1;
<<<END>>>
<<<FILE test/app.test.js>>>
import { test } from "node:test";
test("x", () => {});`;

describe("file-block protocol", () => {
  it("keeps file contents verbatim (quotes, backslashes, braces) and strips stray fences", () => {
    const { sections, files } = parseBlocks(sample);
    expect(sections.NAME).toBe("coffee-landing");
    expect(files.map((f) => f.path)).toEqual(["package.json", "public/index.html", "server.js", "src/app.js", "test/app.test.js"]);
    expect(files[1].content).toContain(`Say "hi" \\n it's {fine}`);
    expect(files[2].content).toBe('console.log("srv");\n');
    expect(files[4].content).toContain('test("x"'); // unterminated last block tolerated
  });

  it("feeds the existing build validator", () => {
    const out = validateBuildOutput(buildBlocksToJson(sample));
    expect(out.name).toBe("coffee-landing");
    expect(Object.keys(out.files)).toHaveLength(5);
  });

  it("parses repairs", () => {
    const json = JSON.parse(repairBlocksToJson(`<<<SUMMARY>>>\nfix\n<<<ROOT_CAUSE>>>\nbug\n<<<FILE src/a.js>>>\nx\n<<<END>>>`));
    expect(json).toMatchObject({ summary: "fix", rootCause: "bug", filesChanged: [{ path: "src/a.js", content: "x\n" }] });
  });
});
