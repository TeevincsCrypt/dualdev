import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, collectFailures, parseTap } from "@/lib/tests/runner";

const sample = readFileSync(new URL("./samples/tap-one-failure.txt", import.meta.url), "utf8");

describe("parseTap", () => {
  it("parses a real node --test TAP report", () => {
    const s = parseTap(sample);
    expect(s).toMatchObject({ total: 6, passed: 5, failed: 1, skipped: 0, parsed: true });
    const failing = s.cases.filter((c) => !c.ok);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe("completing a task moves it from the pending counter to the completed counter");
    expect(failing[0].error).toContain("Expected values to be strictly deep-equal");
    expect(failing[0].location).toBe("/root/app/test/tasks.test.js:26:1");
    expect(failing[0].expected).toContain("completed: 1");
  });
  it("reports unparsed output honestly", () => {
    expect(parseTap("garbage").parsed).toBe(false);
  });
});

describe("failure classification", () => {
  it("classifies common errors", () => {
    expect(classify("SyntaxError: Unexpected token")).toBe("syntax_error");
    expect(classify("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x.js'")).toBe("import_resolution");
    expect(classify("Cannot find package 'lodash'")).toBe("missing_dependency");
    expect(classify("TypeError: x is not a function")).toBe("runtime_exception");
    expect(classify("anything", true)).toBe("timeout");
  });
  it("derives failures from the failing test", () => {
    const tests = parseTap(sample);
    const f = collectFailures(
      [{ label: "tests", command: "", exitCode: 1, stdout: sample, stderr: "", durationMs: 1, timedOut: false }],
      tests,
    );
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("failing_test");
  });
});
