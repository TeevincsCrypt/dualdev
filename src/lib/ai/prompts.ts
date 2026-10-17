import type { Failure, RepairAttempt, Run } from "../types";

export const STACK_CONTRACT = `Target stack (the only one supported):
- Plain JavaScript ES modules, Node 20+, ZERO npm dependencies. Do not add "dependencies" or "devDependencies".
- package.json with "type": "module", scripts {"start": "node server.js", "test": "node --test test/"}.
- Business logic in src/*.js as pure, exported functions with no DOM access, so it is unit-testable in Node.
- Browser UI in public/index.html (+ optional public/styles.css) loading src/app.js via <script type="module" src="/src/app.js">.
  src/app.js imports the logic modules and wires them to the DOM. Persist state with localStorage only if the spec asks for persistence, guarded by try/catch.
- server.js: a zero-dependency node:http static server that serves "/" as public/index.html and files under public/ and src/ only, listening on Number(process.env.PORT || 3000) at host "0.0.0.0".
- Tests in test/*.test.js using only "node:test" and "node:assert/strict", importing from ../src/*.js. Cover every behaviour in the spec with focused assertions.
- File paths are relative, lowercase, using only letters, digits, ".", "_", "-" and "/". No dotfiles, no node_modules, no build step.`;

export const BUILD_SYSTEM = `You are the BUILD engine of DUALDEV, an AI software engineer. You turn a product description into a small, complete, working application.

${STACK_CONTRACT}

Rules:
- Implement the behaviour the user asked for; do not stub features or leave TODOs.
- Keep the project small and coherent: typically 6–10 files.
- Write tests that would genuinely catch regressions in the requested behaviour.
- Do not claim the code was run or tested; it has not been run yet.
- "plan" is a short bullet list of what you built. "limitations" honestly lists what is out of scope or not covered by tests.
- Return every file with its complete content.`;

export function buildUserPrompt(spec: string, previousError?: string): string {
  let out = `Build this application:\n\n<spec>\n${spec}\n</spec>`;
  if (previousError) {
    out += `\n\nYour previous response was rejected by the validator for this reason:\n${previousError}\nFix that and return the full project again.`;
  }
  return out;
}

export const REPAIR_SYSTEM = `You are the FIX engine of DUALDEV, an autonomous bug hunter. You receive real output from tests and checks that were executed in an isolated sandbox, plus the relevant source files.

Your job:
1. Use the actual error output as evidence. Identify the most likely root cause.
2. Propose the minimal repair to the APPLICATION code that makes the failing behaviour correct.
3. Do not refactor unrelated code. Preserve existing behaviour that is not broken.
4. Do not modify existing test files to make them pass — the tests describe the expected behaviour. You may ADD a new test file under test/ if it helps cover the fix.
5. Return complete file contents for every file you change. Only change files that exist in the project unless you are adding a new test file.
6. "testsToRun" is informational only; DUALDEV always runs its own approved test command.
7. Never claim the fix is verified — DUALDEV will re-run the tests itself.

${STACK_CONTRACT}`;

export function repairUserPrompt(args: {
  spec: string;
  fileList: string[];
  relevantFiles: Record<string, string>;
  failures: Failure[];
  run: Run;
  attempt: number;
  maxAttempts: number;
  previousAttempts: RepairAttempt[];
}): string {
  const { spec, fileList, relevantFiles, failures, run, attempt, maxAttempts, previousAttempts } = args;
  const failing = run.tests?.cases.filter((c) => !c.ok) ?? [];
  const parts: string[] = [];
  parts.push(`Repair attempt ${attempt} of ${maxAttempts}.`);
  parts.push(`<spec>\n${spec}\n</spec>`);
  parts.push(`<project_files>\n${fileList.join("\n")}\n</project_files>`);
  parts.push(
    `<failures>\n${failures
      .map((f) => `- [${f.category}] ${f.testName ? `test "${f.testName}": ` : ""}${f.message}${f.location ? ` (at ${f.location})` : ""}`)
      .join("\n")}\n</failures>`,
  );
  for (const c of failing) {
    parts.push(
      `<failing_test name=${JSON.stringify(c.name)}>\n${c.error ?? ""}\n${c.expected ? `expected:\n${c.expected}\n` : ""}${c.actual ? `actual:\n${c.actual}\n` : ""}</failing_test>`,
    );
  }
  for (const e of run.execs.filter((e) => e.exitCode !== 0)) {
    parts.push(
      `<exec label="${e.label}" exit_code="${e.exitCode}" timed_out="${e.timedOut}">\n$ ${e.command}\n--- stdout ---\n${e.stdout.slice(-6000)}\n--- stderr ---\n${e.stderr.slice(-6000)}${e.error ? `\n--- error ---\n${e.error}` : ""}\n</exec>`,
    );
  }
  if (previousAttempts.length) {
    parts.push(
      `<previous_attempts>\n${previousAttempts
        .map((a) => `Attempt ${a.attempt}: ${a.summary}\nFiles: ${a.changes.map((c) => c.path).join(", ") || "none"}\nResult: ${a.rejected ? `rejected (${a.rejected})` : a.verified ? "verified" : "tests still failing"}`)
        .join("\n\n")}\nThose attempts did not resolve the failure. Re-examine the evidence and try a different fix.\n</previous_attempts>`,
    );
  }
  for (const [p, content] of Object.entries(relevantFiles)) {
    parts.push(`<file path="${p}">\n${content}\n</file>`);
  }
  return parts.join("\n\n");
}
