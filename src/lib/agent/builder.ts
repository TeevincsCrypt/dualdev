import type { ModelProvider } from "../ai/provider";
import { BUILD_SYSTEM, buildUserPrompt } from "../ai/prompts";
import { BuildJsonSchema, BuildOutput } from "../ai/schemas";
import { BUILD_FORMAT, buildBlocksToJson } from "../ai/blocks";
import { validateFileSet, validateRelativePath } from "../security/validation";

/** Standard files DUALDEV supplies so the model only has to write the app itself. */
export const PACKAGE_JSON = JSON.stringify({ name: "app", version: "1.0.0", private: true, type: "module", scripts: { start: "node server.js", test: "node --test" } }, null, 2) + "\n";

export const SERVER_JS = `// Zero-dependency static server (supplied by DUALDEV). Serves public/ and src/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

async function tryRead(rel) {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root)) return null;
  try { return { path, body: await readFile(path) }; } catch { return null; }
}

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\\/+/, "");
  const candidates = pathname === "" ? ["public/index.html"] : [\`public/\${pathname}\`, pathname];
  for (const rel of candidates) {
    if (!(rel.startsWith("public/") || rel.startsWith("src/"))) continue;
    const hit = await tryRead(rel);
    if (hit) return res.writeHead(200, { "content-type": types[extname(hit.path)] || "application/octet-stream" }).end(hit.body);
  }
  res.writeHead(404).end("Not found");
}).listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("listening"));
`;

export const SMOKE_TEST = `// Smoke test added by DUALDEV because the generated project had no tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("public/index.html exists and has a body with content", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<body[\\s\\S]*<\\/body>/i);
  assert.ok(html.replace(/<[^>]+>/g, "").trim().length > 20);
});
`;

/** Adds the standard boilerplate; returns a note for each thing DUALDEV added. */
export function completeProject(files: Record<string, string>): string[] {
  const notes: string[] = [];
  if (!("public/index.html" in files) && "index.html" in files) {
    files["public/index.html"] = files["index.html"];
    delete files["index.html"];
  }
  files["package.json"] = PACKAGE_JSON;
  files["server.js"] = SERVER_JS;
  if (!Object.keys(files).some((p) => /^test\/.+\.test\.m?js$/.test(p))) {
    files["test/smoke.test.js"] = SMOKE_TEST;
    notes.push("The model returned no tests; DUALDEV added a smoke test (test/smoke.test.js).");
  }
  return notes;
}

export interface GeneratedProject {
  name: string;
  plan: string;
  limitations: string;
  files: Record<string, string>;
}

/** Validates a model's build output against the supported-stack contract. */
export function validateBuildOutput(raw: string): GeneratedProject {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Response was not valid JSON");
  }
  if (Array.isArray((json as { files?: unknown[] })?.files) && (json as { files: unknown[] }).files.length === 0) {
    throw new Error("The model returned no files. Use the exact <<<FILE path>>> ... <<<END>>> blocks for every file.");
  }
  const parsed = BuildOutput.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Response did not match the schema at "${issue?.path.join(".")}": ${issue?.message}`);
  }
  const out = parsed.data;

  const files: Record<string, string> = {};
  for (const f of out.files) {
    let p: string;
    try {
      p = validateRelativePath(f.path.replace(/^\.?\//, ""));
    } catch {
      continue; // skip unusable paths instead of rejecting the whole project
    }
    if (p === "package.json" || p === "server.js") continue; // supplied by DUALDEV
    files[p] = f.content;
  }
  if (!("public/index.html" in files) && !("index.html" in files)) throw new Error("The model returned no public/index.html.");
  const notes = completeProject(files);
  validateFileSet(files);

  for (const required of ["package.json", "server.js", "public/index.html"]) {
    if (!(required in files)) throw new Error(`Missing required file: ${required}`);
  }
  if (!Object.keys(files).some((p) => /^test\/.+\.test\.m?js$/.test(p))) {
    throw new Error("No test files found (expected test/*.test.js)");
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(files["package.json"]);
  } catch {
    throw new Error("package.json is not valid JSON");
  }
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = pkg[key];
    if (deps && typeof deps === "object" && Object.keys(deps).length > 0) {
      throw new Error(`package.json declares ${key}; the supported stack is zero-dependency`);
    }
  }
  if (pkg.type !== "module") throw new Error('package.json must set "type": "module"');

  const limitations = [out.limitations, ...notes].filter(Boolean).join("\n");
  return { name: out.name.trim() || "generated-app", plan: out.plan, limitations, files };
}

export async function generateProject(model: ModelProvider, spec: string, onRetry?: (reason: string) => void) {
  let lastError: string | undefined;
  for (let i = 0; i < 2; i++) {
    const user = buildUserPrompt(spec, lastError);
    let reply = "";
    let raw: string;
    if (model.generateText) {
      reply = await model.generateText({ system: `${BUILD_SYSTEM}\n\n${BUILD_FORMAT}`, user });
      raw = buildBlocksToJson(reply);
    } else {
      raw = reply = await model.generateJson({ system: BUILD_SYSTEM, user, schema: BuildJsonSchema });
    }
    try {
      return validateBuildOutput(raw);
    } catch (err) {
      const excerpt = reply.trim().replace(/\s+/g, " ").slice(0, 240);
      lastError = `${(err as Error).message}${excerpt ? ` (model replied: "${excerpt}${reply.length > 240 ? "…" : ""}")` : " (model reply was empty)"}`;
      if (i === 0) onRetry?.(lastError);
    }
  }
  throw new Error(`Generated project failed validation: ${lastError}`);
}
