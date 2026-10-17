import path from "node:path";
import type { ModelProvider } from "../ai/provider";
import { REPAIR_SYSTEM, repairUserPrompt } from "../ai/prompts";
import { RepairJsonSchema, RepairOutput } from "../ai/schemas";
import { validateFileSet, validateRelativePath } from "../security/validation";
import type { FileChange, Failure, RepairAttempt, Run } from "../types";

const MAX_CONTEXT_CHARS = 120_000;
const isTest = (p: string) => p.startsWith("test/");

/**
 * Picks the files the model needs: those named in failure locations/stacks,
 * their relative imports, and package.json. Falls back to all source files.
 */
export function selectRelevantFiles(files: Record<string, string>, run: Run): Record<string, string> {
  const evidence = [
    ...run.failures.map((f) => `${f.location ?? ""} ${f.message}`),
    ...(run.tests?.cases.filter((c) => !c.ok).map((c) => `${c.location ?? ""} ${c.error ?? ""}`) ?? []),
    ...run.execs.filter((e) => e.exitCode !== 0).map((e) => `${e.stdout} ${e.stderr}`),
  ].join("\n");

  const picked = new Set<string>();
  for (const p of Object.keys(files)) if (evidence.includes(p)) picked.add(p);
  // A startup failure involves server.js and what it serves, even when the log names neither.
  if (run.appStarts === false) for (const p of Object.keys(files)) if (p.endsWith(".js") && !isTest(p)) picked.add(p);

  // Follow relative imports one level from what we picked.
  for (const p of [...picked]) {
    for (const m of files[p].matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1]));
      if (target in files) picked.add(target);
    }
  }
  if ([...picked].filter((p) => p.endsWith(".js") && !isTest(p)).length === 0) {
    for (const p of Object.keys(files)) if (p.endsWith(".js") && !isTest(p)) picked.add(p);
  }
  if ("package.json" in files) picked.add("package.json");

  const out: Record<string, string> = {};
  let budget = MAX_CONTEXT_CHARS;
  for (const p of [...picked].sort((a, b) => Number(isTest(a)) - Number(isTest(b)))) {
    if (files[p].length > budget) continue;
    out[p] = files[p];
    budget -= files[p].length;
  }
  return out;
}

export interface ValidatedRepair {
  summary: string;
  rootCause: string;
  changes: FileChange[];
  testsToRun: string[];
}

/** Validates a model's repair and computes the changes; never touches disk. */
export function validateRepair(raw: string, files: Record<string, string>): ValidatedRepair {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Repair response was not valid JSON");
  }
  const parsed = RepairOutput.safeParse(json);
  if (!parsed.success) throw new Error(`Repair did not match the schema: ${parsed.error.issues[0]?.message}`);

  const changes: FileChange[] = [];
  const seen = new Set<string>();
  for (const f of parsed.data.filesChanged) {
    const p = validateRelativePath(f.path);
    if (seen.has(p)) throw new Error(`Duplicate file in repair: ${p}`);
    seen.add(p);
    const before = p in files ? files[p] : null;
    if (before === null && !/^test\/.+\.test\.m?js$/.test(p)) {
      throw new Error(`Repair tried to create a non-test file: ${p}`);
    }
    if (before !== null && isTest(p)) {
      throw new Error(`Repair tried to modify an existing test (${p}); tests define expected behaviour`);
    }
    if (before === f.content) continue;
    changes.push({ path: p, before, after: f.content });
  }
  if (changes.length === 0) throw new Error("Repair made no effective changes");
  validateFileSet(applyChanges(files, changes));
  return { summary: parsed.data.summary, rootCause: parsed.data.rootCause, changes, testsToRun: parsed.data.testsToRun };
}

export function applyChanges(files: Record<string, string>, changes: FileChange[]): Record<string, string> {
  const next = { ...files };
  for (const c of changes) next[c.path] = c.after;
  return next;
}

export async function proposeRepair(
  model: ModelProvider,
  args: { spec: string; files: Record<string, string>; run: Run; failures: Failure[]; attempt: number; maxAttempts: number; previousAttempts: RepairAttempt[] },
): Promise<ValidatedRepair> {
  const relevantFiles = selectRelevantFiles(args.files, args.run);
  const raw = await model.generateJson({
    system: REPAIR_SYSTEM,
    user: repairUserPrompt({ ...args, fileList: Object.keys(args.files).sort(), relevantFiles }),
    schema: RepairJsonSchema,
    maxTokens: 32000,
  });
  return validateRepair(raw, args.files);
}
