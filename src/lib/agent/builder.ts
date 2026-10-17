import type { ModelProvider } from "../ai/provider";
import { BUILD_SYSTEM, buildUserPrompt } from "../ai/prompts";
import { BuildJsonSchema, BuildOutput } from "../ai/schemas";
import { BUILD_FORMAT, buildBlocksToJson } from "../ai/blocks";
import { validateFileSet, validateRelativePath } from "../security/validation";

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
  const parsed = BuildOutput.safeParse(json);
  if (!parsed.success) throw new Error(`Response did not match the schema: ${parsed.error.issues[0]?.message}`);
  const out = parsed.data;

  const files: Record<string, string> = {};
  for (const f of out.files) {
    const p = validateRelativePath(f.path);
    if (p in files) throw new Error(`Duplicate file: ${p}`);
    files[p] = f.content;
  }
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

  return { name: out.name.trim(), plan: out.plan, limitations: out.limitations, files };
}

export async function generateProject(model: ModelProvider, spec: string, onRetry?: (reason: string) => void) {
  let lastError: string | undefined;
  for (let i = 0; i < 2; i++) {
    const user = buildUserPrompt(spec, lastError);
    const raw = model.generateText
      ? buildBlocksToJson(await model.generateText({ system: `${BUILD_SYSTEM}\n\n${BUILD_FORMAT}`, user }))
      : await model.generateJson({ system: BUILD_SYSTEM, user, schema: BuildJsonSchema });
    try {
      return validateBuildOutput(raw);
    } catch (err) {
      lastError = (err as Error).message;
      if (i === 0) onRetry?.(lastError);
    }
  }
  throw new Error(`Generated project failed validation: ${lastError}`);
}
