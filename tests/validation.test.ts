import { describe, expect, it } from "vitest";
import { isValidProjectId, redact, truncate, validateFileSet, validateRelativePath } from "@/lib/security/validation";

describe("validateRelativePath", () => {
  it.each(["src/tasks.js", "test/a.test.js", "public/index.html", "package.json", "./src/x.js"])("accepts %s", (p) => {
    expect(() => validateRelativePath(p)).not.toThrow();
  });
  it.each([
    "../etc/passwd",
    "src/../../x.js",
    "/etc/passwd.js",
    "C:/x.js",
    "src\\x.js",
    ".env",
    "src/.hidden.js",
    "node_modules/x/index.js",
    "src/x.sh",
    "src/a b.js",
    "src//x.js",
    "",
  ])("rejects %s", (p) => {
    expect(() => validateRelativePath(p)).toThrow();
  });
});

describe("misc guards", () => {
  it("validates project ids", () => {
    expect(isValidProjectId("p_0123456789ab")).toBe(true);
    expect(isValidProjectId("../p_0123456789ab")).toBe(false);
    expect(isValidProjectId("p_0123")).toBe(false);
  });
  it("bounds file sets", () => {
    expect(() => validateFileSet({ "a.js": "x".repeat(300_000) })).toThrow(/too large/);
    expect(() => validateFileSet({})).toThrow();
  });
  it("truncates long logs and redacts secrets", () => {
    expect(truncate("a".repeat(50_000)).length).toBeLessThan(21_000);
    expect(redact("key sk-ant-abcdefghijklmnop123")).toBe("key [redacted]");
  });
});
