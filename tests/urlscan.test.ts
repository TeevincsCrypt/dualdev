import { describe, expect, it } from "vitest";
import { staticChecks, validateScanUrl } from "@/lib/bughunt/url-scan";

describe("bug hunter url scan", () => {
  it("blocks local and private targets", async () => {
    await expect(validateScanUrl("http://localhost:3000")).rejects.toThrow(/Local/);
    await expect(validateScanUrl("http://127.0.0.1")).rejects.toThrow(/Private/);
    await expect(validateScanUrl("http://192.168.1.4")).rejects.toThrow(/Private/);
    await expect(validateScanUrl("ftp://example.com")).rejects.toThrow();
  });
  it("finds real issues in HTML", () => {
    const html = `<html><head></head><body><img src="a.png"><a href="#">x</a><script src="http://cdn.x/y.js"></script></body></html>`;
    const titles = staticChecks(html, new URL("https://site.test"), 200).map((f) => f.title);
    expect(titles).toEqual(expect.arrayContaining(["Missing or empty <title>", "No viewport meta tag", "1 image without alt text", '1 placeholder link (href="#" or empty)', "1 insecure http:// resource on an https page"]));
  });
  it("reports nothing for a clean page", () => {
    const html = `<html lang="en"><head><title>T</title><meta name="viewport" content="x"><meta name="description" content="d"></head><body><h1>Hi</h1><img src="a" alt="a"></body></html>`;
    expect(staticChecks(html, new URL("https://site.test"), 200)).toEqual([]);
  });
});

import { sandboxName, SANDBOX_NAME_PREFIX } from "@/lib/sandbox/types";
describe("sandbox names", () => {
  it("fit CreateOS's 22-character limit and keep the dualdev prefix", () => {
    for (const k of ["job", "proof"]) {
      const n = sandboxName(k);
      expect(n.length).toBeLessThanOrEqual(22);
      expect(n.startsWith(SANDBOX_NAME_PREFIX)).toBe(true);
    }
  });
});
