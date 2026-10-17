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

describe("tolerant parsing", () => {
  it("accepts marker variants", () => {
    const { files } = parseBlocks("**<<<FILE: public/index.html>>>**\n<h1>x</h1>\n<<<end>>>\n<<< FILE `src/a.js` >>>\nexport {}\n<<<END>>>");
    expect(files.map((f) => f.path)).toEqual(["public/index.html", "src/a.js"]);
  });
  it("falls back to markdown headings and fenced blocks", () => {
    const md = "Here you go.\n\n### public/index.html\n```html\n<h1>Hi</h1>\n```\n\n**src/app.js**\n```js\nconsole.log(1)\n```\n\n```css title=\"public/styles.css\"\nbody{}\n```";
    const { files } = parseBlocks(md);
    expect(files).toEqual([
      { path: "public/index.html", content: "<h1>Hi</h1>\n" },
      { path: "src/app.js", content: "console.log(1)\n" },
      { path: "public/styles.css", content: "body{}\n" },
    ]);
  });
});

describe("salvaging replies that ignore the format", () => {
  it("accepts a bare HTML document", () => {
    const out = validateBuildOutput(buildBlocksToJson("Sure! Here is your page:\n<!DOCTYPE html><html><body><h1>Coffee</h1></body></html>\nEnjoy."));
    expect(out.files["public/index.html"]).toContain("<h1>Coffee</h1>");
    expect(out.files["server.js"]).toBeDefined();
  });
  it("accepts JSON with a files array", () => {
    const out = validateBuildOutput(buildBlocksToJson('{"files":[{"path":"public/index.html","content":"<body>x</body>"}]}'));
    expect(out.files["public/index.html"]).toBe("<body>x</body>");
  });
  it("accepts unlabeled fenced blocks by language", () => {
    const out = validateBuildOutput(buildBlocksToJson("```html\n<body>hey</body>\n```\n```css\nbody{color:red}\n```"));
    expect(out.files["public/styles.css"]).toContain("color:red");
  });
});
