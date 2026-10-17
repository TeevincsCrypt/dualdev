import type { Failure, RepairAttempt, Run } from "../types";

export const STACK_CONTRACT = `Target stack (the only one supported):
- Plain HTML + CSS + JavaScript ES modules. ZERO npm dependencies. No build step.
- DUALDEV supplies package.json and server.js automatically. Do NOT write them.
- REQUIRED: public/index.html — the page itself. Optional: public/styles.css, src/app.js (loaded via <script type="module" src="/src/app.js">) and src/*.js helper modules.
- Put any non-trivial logic in src/*.js as pure exported functions (no DOM access) so it is unit-testable in Node; src/app.js wires them to the DOM. Use localStorage only if persistence is asked for, guarded by try/catch.
- Tests (recommended): test/*.test.js using only "node:test" and "node:assert/strict", importing from ../src/*.js and covering that logic.
- File paths are relative, lowercase, using only letters, digits, ".", "_", "-" and "/". No dotfiles, no node_modules.`;

export const BUILD_SYSTEM = `You are the BUILD engine of DUALDEV, an AI software engineer. You turn a product description into a small, complete, working application.

${STACK_CONTRACT}

Visual design (critical: the result is shown to the user immediately in a live preview):
- It must look like a polished, modern, professionally designed product, not a bare HTML page.
- In public/index.html load Tailwind via <script src="https://cdn.tailwindcss.com"></script> and a Google Font (e.g. Inter) via <link> to fonts.googleapis.com, and style everything with Tailwind utility classes.
- Use a clear visual hierarchy, generous spacing, a cohesive colour palette, rounded cards, subtle shadows, hover states, and a responsive layout that works on mobile and desktop.
- For websites and landing pages include real sections with realistic copy (no lorem ipsum): sticky navbar, hero with headline, subheading and call-to-action buttons, features/benefits grid, social proof or testimonials, pricing or menu where relevant, a final call-to-action, and a footer.
- Images: use https://images.unsplash.com/photo-... URLs with ?auto=format&fit=crop&w=1200&q=80, or inline SVG. Never reference local image files.
- Interactive apps: make the UI fully functional (forms, buttons, state updates) and visually polished, with empty states.
- Keep any extra CSS in public/styles.css; external URLs are allowed only for Tailwind, Google Fonts and images.

Rules:
- Implement the behaviour the user asked for; do not stub features or leave TODOs.
- Keep the project small and coherent: typically 6–8 files, and keep the WHOLE response compact (under ~450 lines in total): concise Tailwind markup, a minimal server.js, one small test file. Output length is strictly limited.
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
