"use client";
import { useState } from "react";
import type { UrlScanResult } from "@/lib/bughunt/url-scan";
import { api, Button } from "./ui";

export function BugHunter() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UrlScanResult | null>(null);

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<UrlScanResult>("/api/bughunt", { method: "POST", body: JSON.stringify({ url }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sev = { high: "text-bad border-bad/40", medium: "text-warn border-warn/40", low: "text-muted border-line-strong" };
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-[2px] bg-accent-2" />
        <h2 className="text-[13px] font-semibold">Bug Hunter: scan a website</h2>
      </div>
      <p className="mt-1 text-[12px] text-faint">
        Fetches the page, runs automatic checks and an AI code review of its HTML and scripts. Static analysis: the page is not executed. To test, repair and re-run source code, use <span className="text-muted">Fix bugs</span> inside a project.
      </p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); scan(); }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-accent/60" />
        <Button type="submit" variant="primary" disabled={busy || !url.trim()}>{busy ? "Scanning…" : "Scan for bugs"}</Button>
      </form>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      {result && (
        <div className="mt-3">
          <p className="mono text-[12px] text-faint">
            GET {result.finalUrl} → <span className={result.status < 400 ? "text-ok" : "text-bad"}>{result.status}</span> · {result.fetchMs}ms · {(result.bytes / 1024).toFixed(0)} KB · {result.findings.length} finding{result.findings.length === 1 ? "" : "s"}
          </p>
          {result.aiError && <p className="mt-1 text-[12px] text-warn">AI review unavailable: {result.aiError}. Showing automatic checks only.</p>}
          <ul className="mt-2 space-y-2">
            {result.findings.map((f, i) => (
              <li key={i} className="rounded-md border border-line px-3 py-2 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-1.5 text-[10px] font-semibold uppercase ${sev[f.severity]}`}>{f.severity}</span>
                  <span className="font-medium">{f.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-faint">{f.source === "ai" ? "AI review" : "automatic check"}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">{f.detail}</p>
                <p className="mt-0.5 text-[12.5px] text-ok/90">Fix: {f.fix}</p>
              </li>
            ))}
            {result.findings.length === 0 && <li className="text-[13px] text-ok">No issues found by the checks and review.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
