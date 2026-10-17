"use client";
import { useEffect, useState } from "react";
import type { ProofResult } from "@/lib/sandbox/proof";
import { api, Button, timeAgo } from "./ui";

export function SandboxProof() {
  const [result, setResult] = useState<ProofResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProgram, setShowProgram] = useState(false);

  useEffect(() => {
    api<{ running: boolean; result: ProofResult | null }>("/api/sandbox/proof")
      .then((d) => { setResult(d.result); setRunning(d.running); })
      .catch(() => undefined);
  }, []);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const d = await api<{ result: ProofResult }>("/api/sandbox/proof", { method: "POST" });
      setResult(d.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const r = result;
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">CreateOS execution proof</h2>
          <p className="text-[12px] text-faint">Creates a fresh CreateOS sandbox, runs a Python program in it with <span className="mono">python3</span>, records the output, then destroys the sandbox.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {r && <span className={`text-[12px] font-semibold ${r.ok ? "text-ok" : "text-bad"}`}>{r.ok ? "VERIFIED" : "FAILED"} · {timeAgo(r.finishedAt)}</span>}
          <Button onClick={run} disabled={running}>{running ? "Running in sandbox…" : r ? "Run again" : "Run proof"}</Button>
        </div>
      </header>
      {error && <p className="px-4 py-2 text-[13px] text-bad">{error}</p>}
      {!r ? (
        <p className="px-4 py-3 text-[13px] text-faint">No proof recorded yet.</p>
      ) : (
        <div className="grid gap-4 px-4 py-3 text-[12.5px] lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {r.error && <p className="mb-2 text-bad">{r.error}</p>}
            <p className="mono text-faint">$ {r.command} → <span className={r.exitCode === 0 ? "text-ok" : "text-bad"}>exit {r.exitCode ?? "—"}</span>{r.execMs !== undefined && ` · ${r.execMs}ms`}</p>
            <pre className="mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-bg p-2 text-[12px] text-[#d4d4dc]">{r.stdout || "(no stdout)"}</pre>
            {r.stderr && <pre className="mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-bad/20 bg-bad/5 p-2 text-[12px] text-[#fca5a5]">{r.stderr}</pre>}
            <button onClick={() => setShowProgram(!showProgram)} className="mt-2 text-[12px] text-accent">{showProgram ? "Hide" : "Show"} program</button>
            {showProgram && <pre className="mono mt-1 overflow-auto rounded border border-line bg-bg p-2 text-[12px] text-muted">{r.program}</pre>}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 self-start text-[12px]">
            <Row k="Control plane" v={r.baseUrl} />
            <Row k="Account" v={r.userId} />
            <Row k="Sandbox id" v={r.sandbox?.id} />
            <Row k="Status" v={r.sandbox?.status} />
            <Row k="Shape / rootfs" v={r.sandbox ? `${r.sandbox.shape ?? "?"} / ${r.sandbox.rootfs ?? "?"}` : undefined} />
            <Row k="Region / IP" v={r.sandbox ? `${r.sandbox.region ?? "?"} / ${r.sandbox.ip ?? "?"}` : undefined} />
            <Row k="Guest host" v={r.guest ? `${r.guest.hostname} (${r.guest.kernel})` : undefined} />
            <Row k="This server" v={`${r.host.hostname} (${r.host.platform})`} />
            <Row k="Expected output" v={r.outputMatchesExpected ? "matches" : "does not match"} />
            <Row k="Destroyed" v={r.destroyed ? "yes" : "no"} />
          </dl>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="mono truncate text-muted" title={v}>{v ?? "—"}</dd>
    </>
  );
}
