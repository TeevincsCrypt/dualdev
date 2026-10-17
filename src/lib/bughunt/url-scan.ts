import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ModelProvider } from "../ai/provider";
import { proxyFetch } from "../net";

export interface Finding {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  fix: string;
  source: "check" | "ai";
}

export interface UrlScanResult {
  url: string;
  finalUrl: string;
  status: number;
  fetchMs: number;
  bytes: number;
  findings: Finding[];
  aiError?: string;
  scannedAt: string;
}

const MAX_BYTES = 1_000_000;

function isPrivate(ip: string): boolean {
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  const m = /^(\d+)\.(\d+)\./.exec(ip.replace(/^::ffff:/, ""));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Rejects non-http(s) URLs and anything resolving to a private/loopback address (SSRF guard). */
export async function validateScanUrl(raw: string): Promise<URL> {
  const input = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) throw new Error("Only http(s) URLs can be scanned.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("Enter a valid website URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs can be scanned.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local addresses cannot be scanned.");
  if (!isIP(host) && !host.includes(".")) throw new Error("Enter a public website address (e.g. example.com).");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0 && !process.env.HTTPS_PROXY) throw new Error(`Could not resolve ${host}.`);
  if (addrs.some(isPrivate)) throw new Error("Private network addresses cannot be scanned.");
  return url;
}

/** Deterministic checks on the fetched HTML. */
export function staticChecks(html: string, pageUrl: URL, status: number): Finding[] {
  const f: Finding[] = [];
  const add = (severity: Finding["severity"], title: string, detail: string, fix: string) => f.push({ severity, title, detail, fix, source: "check" });
  if (status >= 400) add("high", `Page returned HTTP ${status}`, "The server responded with an error status.", "Check the route, server logs and deployment.");
  if (!/<title>[^<]+<\/title>/i.test(html)) add("medium", "Missing or empty <title>", "Browsers tabs and search results will show no page title.", "Add a descriptive <title> in <head>.");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add("medium", "No viewport meta tag", "The page will render zoomed-out on mobile devices.", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  if (!/<meta[^>]+name=["']description["']/i.test(html)) add("low", "No meta description", "Search engines will pick arbitrary text for the snippet.", 'Add <meta name="description" content="…">.');
  if (!/<html[^>]+lang=/i.test(html)) add("low", "Missing lang attribute on <html>", "Screen readers cannot determine the page language.", 'Use <html lang="en"> (or the right language).');
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  if (noAlt) add("medium", `${noAlt} image${noAlt === 1 ? "" : "s"} without alt text`, "Images without alt are invisible to screen readers.", "Add meaningful alt text (or alt=\"\" for decorative images).");
  const emptyLinks = (html.match(/<a\b[^>]*href=["'](#|javascript:void\(0\);?)?["'][^>]*>/gi) ?? []).length;
  if (emptyLinks) add("low", `${emptyLinks} placeholder link${emptyLinks === 1 ? "" : "s"} (href="#" or empty)`, "These links do not navigate anywhere.", "Point them to real destinations or use <button> for actions.");
  if (pageUrl.protocol === "https:") {
    const mixed = (html.match(/(?:src|href)=["']http:\/\/[^"']+["']/gi) ?? []).length;
    if (mixed) add("high", `${mixed} insecure http:// resource${mixed === 1 ? "" : "s"} on an https page`, "Browsers block or warn about mixed content.", "Load these resources over https.");
  }
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  if (h1 === 0) add("low", "No <h1> heading", "Hurts accessibility and SEO structure.", "Add one descriptive <h1>.");
  return f;
}

const AI_SYSTEM = `You are the BUG HUNTER of DUALDEV. You review the HTML (with inline scripts/styles) of a live web page and report concrete, actionable bugs: JavaScript errors you can see in the code, broken logic, broken forms, accessibility and security problems, performance problems, and broken links or assets. Only report issues supported by the HTML you are given; do not invent problems. You cannot run the page.
Output one finding per line, nothing else, in exactly this format:
SEVERITY | TITLE | DETAIL (cite the code) | FIX
where SEVERITY is high, medium or low. At most 10 findings, most severe first. If you find nothing substantive, output: NONE`;

export async function scanUrl(raw: string, model: ModelProvider): Promise<UrlScanResult> {
  const url = await validateScanUrl(raw);
  const started = Date.now();
  const res = await (proxyFetch() ?? fetch)(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "DUALDEV-BugHunter/0.1" } }).catch((e: Error) => {
    throw new Error(`Could not fetch ${url.href}: ${e.message}`);
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const html = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
  const fetchMs = Date.now() - started;
  const findings = staticChecks(html, url, res.status);

  let aiError: string | undefined;
  if (!model.generateText || !model.configured().ok) {
    aiError = model.configured().ok ? "The configured model does not support free-text review." : (model.configured() as { reason: string }).reason;
  } else {
    try {
      const text = await model.generateText({ system: AI_SYSTEM, user: `URL: ${res.url || url.href}\nHTTP status: ${res.status}\n\n<html_source>\n${html.slice(0, 60_000)}\n</html_source>`, maxTokens: 8000 });
      for (const line of text.split("\n")) {
        const parts = line.split("|").map((x) => x.trim());
        if (parts.length < 4) continue;
        const sev = parts[0].toLowerCase().replace(/[^a-z]/g, "");
        if (!["high", "medium", "low"].includes(sev)) continue;
        findings.push({ severity: sev as Finding["severity"], title: parts[1], detail: parts[2], fix: parts.slice(3).join(" | "), source: "ai" });
      }
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { url: url.href, finalUrl: res.url || url.href, status: res.status, fetchMs, bytes: buf.length, findings, aiError, scannedAt: new Date().toISOString() };
}
