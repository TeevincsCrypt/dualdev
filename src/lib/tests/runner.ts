import type { ExecRecord, Failure, FailureCategory, TestCase, TestSummary } from "../types";

/** Approved command for the test stage. Model output never chooses commands. */
export const TEST_SCRIPT =
  "files=$(find test -name '*.test.js' -o -name '*.test.mjs' | sort); " +
  'if [ -z "$files" ]; then echo "No test files found under test/" >&2; exit 3; fi; ' +
  "node --test --test-reporter=tap $files";

/** Parses Node's built-in test runner TAP output (top-level test points). */
export function parseTap(output: string): TestSummary {
  const lines = output.split("\n");
  const cases: TestCase[] = [];
  const point = /^(not ok|ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/;

  for (let i = 0; i < lines.length; i++) {
    const m = point.exec(lines[i]);
    if (!m) continue;
    const tc: TestCase = { name: m[2].trim(), ok: m[1] === "ok", skipped: Boolean(m[4]) };
    // YAML diagnostic block follows, indented by two spaces.
    if (lines[i + 1]?.trim() === "---") {
      const block: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== "...") block.push(lines[j++]);
      i = j;
      Object.assign(tc, parseYamlBlock(block));
    }
    cases.push(tc);
  }

  const count = (key: string) => {
    const m = new RegExp(`^# ${key} (\\d+)$`, "m").exec(output);
    return m ? Number(m[1]) : null;
  };
  const total = count("tests");
  const pass = count("pass");
  const fail = count("fail");
  const skipped = (count("skipped") ?? 0) + (count("todo") ?? 0);
  const parsed = total !== null && pass !== null && fail !== null;

  return {
    total: total ?? cases.length,
    passed: pass ?? cases.filter((c) => c.ok && !c.skipped).length,
    failed: (fail ?? cases.filter((c) => !c.ok).length) + (count("cancelled") ?? 0),
    skipped,
    cases,
    parsed,
  };
}

function parseYamlBlock(block: string[]): Partial<TestCase> {
  const out: Partial<TestCase> = {};
  const indentOf = (s: string) => s.length - s.trimStart().length;
  for (let k = 0; k < block.length; k++) {
    const line = block[k];
    const m = /^\s*(duration_ms|location|error|expected|actual):\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rest] = m;
    let value = rest;
    if (rest === "|-" || rest === "|" || rest === "") {
      const base = indentOf(line);
      const body: string[] = [];
      while (k + 1 < block.length && (block[k + 1].trim() === "" || indentOf(block[k + 1]) > base)) {
        body.push(block[++k].slice(base + 2));
      }
      value = body.join("\n").trimEnd();
    }
    value = value.replace(/^'(.*)'$/, "$1");
    if (key === "duration_ms") out.durationMs = Number(value);
    else if (key === "location") out.location = value;
    else if (key === "error") out.error = value;
    else if (key === "expected") out.expected = value;
    else if (key === "actual") out.actual = value;
  }
  return out;
}

export function classify(text: string, timedOut = false): FailureCategory {
  if (timedOut) return "timeout";
  if (/SyntaxError/.test(text)) return "syntax_error";
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/.test(text)) {
    return /Cannot find package/.test(text) ? "missing_dependency" : "import_resolution";
  }
  if (/does not provide an export named/.test(text)) return "import_resolution";
  if (/AssertionError|ERR_ASSERTION/.test(text)) return "failing_test";
  if (/(TypeError|ReferenceError|RangeError)/.test(text)) return "runtime_exception";
  return "unknown";
}

/** Turns real exec output into structured failures. Never invents any. */
export function collectFailures(execs: ExecRecord[], tests: TestSummary | null): Failure[] {
  const failures: Failure[] = [];
  for (const e of execs) {
    if (e.label === "tests") continue;
    if (e.exitCode === 0 && !e.timedOut && !e.error) continue;
    const text = `${e.stderr}\n${e.stdout}\n${e.error ?? ""}`;
    let category = classify(text, e.timedOut);
    if (e.label === "startup" && category === "unknown") category = "startup_failure";
    if (e.label === "compile" && category === "unknown") category = "syntax_error";
    failures.push({ category, message: firstMeaningfulLine(text) || `${e.label} exited with ${e.exitCode}` });
  }
  const testExec = execs.find((e) => e.label === "tests");
  if (testExec && tests) {
    for (const c of tests.cases.filter((c) => !c.ok)) {
      const text = `${c.error ?? ""}`;
      failures.push({
        category: classify(`${text} ${c.name}`) === "unknown" ? "failing_test" : classify(text),
        message: firstMeaningfulLine(text) || "Test failed",
        testName: c.name,
        location: c.location,
      });
    }
    if (failures.length === 0 && (testExec.exitCode !== 0 || testExec.timedOut)) {
      const text = `${testExec.stderr}\n${testExec.stdout}\n${testExec.error ?? ""}`;
      failures.push({
        category: classify(text, testExec.timedOut) === "unknown" ? "configuration_error" : classify(text, testExec.timedOut),
        message: firstMeaningfulLine(testExec.stderr || testExec.error || "") || `Test command exited with ${testExec.exitCode}`,
      });
    }
  }
  return failures;
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("at ") && !l.startsWith("#") && l !== "^") ?? ""
  ).slice(0, 300);
}
