"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { diffLines, diffStats } from "@/lib/diff";
import type { ActivityEvent, ExecRecord, Project, RepairSession, Run, Stage } from "@/lib/types";
import { IntegrationStatus, MissingConfigNotice, useIntegrationStatus } from "./IntegrationStatus";
import { api, Button, Logo, Panel, StatusBadge, timeAgo } from "./ui";

type ProjectView = Omit<Project, "originalFiles"> & { hasOriginal: boolean };
type Tab = "code" | "changes" | "preview";

const PIPELINE: { stage: Stage; label: string }[] = [
  { stage: "understanding", label: "Understanding request" },
  { stage: "generating", label: "Generating code" },
  { stage: "preparing_sandbox", label: "Preparing sandbox" },
  { stage: "executing", label: "Executing application" },
  { stage: "running_tests", label: "Running tests" },
  { stage: "investigating", label: "Investigating failure" },
  { stage: "applying_repair", label: "Applying repair" },
  { stage: "verifying", label: "Verifying fix" },
];

export function Workspace({ id }: { id: string }) {
  const status = useIntegrationStatus();
  const [p, setP] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("code");
  const [file, setFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<ProjectView>(`/api/projects/${id}`);
      setP(data);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(load, p?.busy ? 1000 : 5000);
    return () => clearInterval(t);
  }, [load, p?.busy]);

  const files = useMemo(() => Object.keys(p?.files ?? {}).sort(sortFiles), [p?.files]);
  useEffect(() => {
    if (!file && files.length) setFile(files.find((f) => f.startsWith("src/") && !f.endsWith("app.js")) ?? files[0]);
  }, [files, file]);

  const changed = useMemo(() => {
    const set = new Set<string>();
    for (const s of p?.repairs ?? []) for (const a of s.attempts) for (const c of a.changes) set.add(c.path);
    return set;
  }, [p?.repairs]);

  async function act(action: string, body?: object) {
    setActionError(null);
    try {
      await api(`/api/projects/${id}/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) });
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function runDemoAgain() {
    await act("reset");
    await act("demo");
  }

  async function remove() {
    if (!confirm("Delete this project and destroy its sandbox?")) return;
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      location.href = "/";
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (loadError && !p) {
    return (
      <div className="grid min-h-screen place-items-center text-[14px] text-muted">
        <div className="text-center">
          <p>{loadError}</p>
          <a href="/" className="mt-2 inline-block text-accent">Back to dashboard</a>
        </div>
      </div>
    );
  }
  if (!p) return <div className="grid min-h-screen place-items-center text-[13px] text-faint">Loading project…</div>;

  const busy = p.busy;
  const hasFiles = files.length > 0;
  const lastRun = p.runs.at(-1);
  const isFixture = p.origin === "fixture";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-4">
        <Logo compact />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[15px] font-semibold">{p.name}</h1>
          <StatusBadge status={p.status} busy={busy} />
          {isFixture && <span className="rounded border border-line px-1.5 text-[10px] uppercase tracking-wider text-faint" title="Prebuilt fixture: code was not generated live. Execution, detection, repair and verification run live.">prebuilt fixture</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="mr-2 hidden xl:block"><IntegrationStatus status={status} /></span>
          {busy ? (
            <Button variant="danger" onClick={() => act("cancel")}>Cancel</Button>
          ) : (
            <>
              {!isFixture && <Button onClick={() => act("build", { autoFix: true })} disabled={busy} title="Regenerate the project from the specification">{hasFiles ? "Rebuild" : "Build"}</Button>}
              <Button onClick={() => act("test")} disabled={!hasFiles}>Run tests</Button>
              <Button variant="primary" onClick={() => act("fix")} disabled={!hasFiles || lastRun?.passed === true} title={lastRun?.passed ? "All checks pass" : "Investigate failures and attempt a verified repair"}>Fix bugs</Button>
              {isFixture && <Button onClick={runDemoAgain} title="Restore the fixture's original bug and run the full demo again">Run demo again</Button>}
              {p.hasOriginal && !isFixture && <Button variant="ghost" onClick={() => act("reset")} title="Restore the originally generated files">Reset</Button>}
              <Button variant="ghost" onClick={remove}>Delete</Button>
            </>
          )}
        </div>
      </header>

      {(actionError || p.lastError || (status && (!status.sandbox.ok || !status.model.ok))) && (
        <div className="space-y-2 border-b border-line px-4 py-2">
          <MissingConfigNotice status={status} />
          {(actionError || p.lastError) && <p className="text-[13px] text-bad">{actionError || p.lastError}</p>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        <Panel title={`Files${hasFiles ? ` · ${files.length}` : ""}`} className="max-h-64 lg:max-h-none">
          <FileTree files={files} active={file} changed={changed} onSelect={(f) => { setFile(f); setTab("code"); }} />
        </Panel>

        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,0.85fr)] gap-3">
          <Panel
            title={
              <div className="flex items-center gap-1">
                {(["code", "changes", "preview"] as Tab[]).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`rounded px-2 py-0.5 normal-case tracking-normal text-[12px] ${tab === t ? "bg-panel-2 text-fg" : "text-faint hover:text-muted"}`}>
                    {t === "code" ? "Code" : t === "changes" ? `Repairs${p.repairs.length ? ` · ${p.repairs.reduce((n, s) => n + s.attempts.length, 0)}` : ""}` : "Preview"}
                  </button>
                ))}
              </div>
            }
            right={tab === "code" && file ? <span className="mono truncate text-[11px] text-faint">{file}</span> : undefined}
          >
            {tab === "code" && <CodeView content={file ? p.files[file] : undefined} empty={busy ? "Waiting for generated files…" : "No files yet. Click Build to generate the application."} />}
            {tab === "changes" && <RepairHistory repairs={p.repairs} runs={p.runs} />}
            {tab === "preview" && <Preview p={p} onStart={() => act("preview")} onStop={() => act("preview-stop")} />}
          </Panel>
          <Panel title="Test results" right={lastRun && <span className="text-[11px] text-faint">{lastRun.kind === "verify" ? `verification run · attempt ${lastRun.repairAttempt}` : lastRun.kind} · {timeAgo(lastRun.finishedAt)}</span>}>
            <TestResults runs={p.runs} />
          </Panel>
        </div>

        <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
          <Panel title="Agent pipeline">
            <Pipeline p={p} />
          </Panel>
          <Panel title="Verification">
            <VerificationStates p={p} />
          </Panel>
          <Panel title="Activity">
            <Activity events={p.events} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function sortFiles(a: string, b: string) {
  const depth = (s: string) => s.split("/").length;
  return depth(a) - depth(b) || a.localeCompare(b);
}

function FileTree({ files, active, changed, onSelect }: { files: string[]; active: string | null; changed: Set<string>; onSelect: (f: string) => void }) {
  if (!files.length) return <p className="p-3 text-[12px] text-faint">No files</p>;
  return (
    <ul className="h-full overflow-auto py-1">
      {files.map((f) => {
        const depth = f.split("/").length - 1;
        const name = f.split("/").at(-1);
        const dir = f.split("/").slice(0, -1).join("/");
        return (
          <li key={f}>
            <button onClick={() => onSelect(f)} className={`mono flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] ${active === f ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`} style={{ paddingLeft: 12 + depth * 4 }}>
              <span className="truncate">
                {dir && <span className="text-faint">{dir}/</span>}
                {name}
              </span>
              {changed.has(f) && <span className="ml-auto text-[10px] text-warn" title="Modified by a repair">M</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CodeView({ content, empty }: { content?: string; empty: string }) {
  if (content === undefined) return <p className="p-4 text-[13px] text-faint">{empty}</p>;
  const lines = content.split("\n");
  return (
    <div className="h-full overflow-auto">
      <pre className="mono min-w-max py-2 text-[12.5px] leading-[1.6]">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-12 shrink-0 select-none pr-4 text-right text-faint/70">{i + 1}</span>
            <span className="pr-6 text-[#d4d4dc]">{l || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function Pipeline({ p }: { p: ProjectView }) {
  const since = p.job?.startedAt ?? "";
  const entered = new Set(p.events.filter((e) => e.ts >= since && e.stage).map((e) => e.stage as Stage));
  const failed = p.stage === "failed" && !p.busy;
  const completed = p.stage === "completed" && !p.busy;
  return (
    <ol className="space-y-0.5 px-3 py-2">
      {PIPELINE.map(({ stage, label }) => {
        const current = p.busy && p.stage === stage;
        const reached = entered.has(stage);
        return (
          <li key={stage} className={`flex items-center gap-2.5 py-0.5 text-[12.5px] ${current ? "text-fg" : reached ? "text-muted" : "text-faint/60"}`}>
            <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${current ? "border-accent" : reached ? "border-ok/60" : "border-line-strong"}`}>
              {current ? <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> : reached ? <span className="h-1.5 w-1.5 rounded-full bg-ok/80" /> : null}
            </span>
            {label}
          </li>
        );
      })}
      <li className={`flex items-center gap-2.5 pt-1.5 text-[12.5px] font-medium ${failed ? "text-bad" : completed ? "text-ok" : "text-faint/60"}`}>
        <span className={`h-3.5 w-3.5 rounded-full border ${failed ? "border-bad bg-bad/30" : completed ? "border-ok bg-ok/30" : "border-line-strong"}`} />
        {failed ? "Failed" : completed ? "Completed" : p.busy ? `Running ${p.job?.kind ?? ""}…` : "Idle"}
      </li>
    </ol>
  );
}

function VerificationStates({ p }: { p: ProjectView }) {
  const v = p.verification;
  const rows: { label: string; value: boolean | null; note?: string }[] = [
    { label: "Code generated", value: v.codeGenerated, note: p.origin === "fixture" ? "prebuilt fixture" : undefined },
    { label: "Code compiles", value: v.compiles, note: "node --check" },
    { label: "Application starts", value: v.appStarts, note: "GET / → 200" },
    { label: "Unit tests pass", value: v.unitTestsPass, note: "node --test" },
    { label: "Behaviour verified (E2E)", value: v.behaviourVerified, note: "no browser E2E harness" },
    { label: "Preview available", value: v.previewAvailable || null },
  ];
  return (
    <ul className="grid grid-cols-1 gap-y-1 px-3 py-2 text-[12.5px]">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className={`w-12 shrink-0 text-[11px] font-semibold ${r.value === true ? "text-ok" : r.value === false ? "text-bad" : "text-faint"}`}>
            {r.value === true ? "PASS" : r.value === false ? "FAIL" : "—"}
          </span>
          <span className="text-muted">{r.label}</span>
          {r.note && <span className="ml-auto text-[11px] text-faint">{r.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function Activity({ events }: { events: ActivityEvent[] }) {
  const ordered = [...events].reverse();
  if (!ordered.length) return <p className="p-3 text-[12px] text-faint">No activity yet.</p>;
  const color = { info: "text-muted", success: "text-ok", warn: "text-warn", error: "text-bad" };
  return (
    <ul className="h-full space-y-1.5 overflow-auto px-3 py-2">
      {ordered.map((e, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-snug">
          <span className="mono shrink-0 text-faint">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
          <span className={color[e.level]}>{e.message}</span>
        </li>
      ))}
    </ul>
  );
}

function TestResults({ runs }: { runs: Run[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const run = runs.find((r) => r.id === selected) ?? runs.at(-1);
  const [open, setOpen] = useState<string | null>(null);
  if (!run) return <p className="p-4 text-[13px] text-faint">No runs yet. Tests execute inside the CreateOS sandbox.</p>;
  const t = run.tests;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-3 py-2 text-[12px]">
        <Stat label="Total" value={t?.total ?? "—"} />
        <Stat label="Passed" value={t?.passed ?? "—"} tone="ok" />
        <Stat label="Failed" value={t?.failed ?? "—"} tone={t?.failed ? "bad" : undefined} />
        <Stat label="Skipped" value={t?.skipped ?? "—"} />
        <span className={`font-semibold ${run.passed ? "text-ok" : "text-bad"}`}>{run.passed ? "ALL CHECKS PASSED" : "CHECKS FAILED"}</span>
        {runs.length > 1 && (
          <select value={run.id} onChange={(e) => setSelected(e.target.value)} className="ml-auto rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-muted">
            {runs.map((r, i) => (
              <option key={r.id} value={r.id}>
                #{i + 1} {r.kind}
                {r.repairAttempt ? ` (attempt ${r.repairAttempt})` : ""} — {r.passed ? "pass" : "fail"}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {t && t.cases.length > 0 && (
          <ul className="divide-y divide-line/60">
            {t.cases.map((c) => (
              <li key={c.name} className="px-3 py-1.5">
                <div className="flex items-start gap-2 text-[12.5px]">
                  <span className={`mono mt-px w-4 shrink-0 ${c.skipped ? "text-faint" : c.ok ? "text-ok" : "text-bad"}`}>{c.skipped ? "–" : c.ok ? "✓" : "✗"}</span>
                  <span className={c.ok ? "text-muted" : "text-fg"}>{c.name}</span>
                  {c.durationMs !== undefined && <span className="mono ml-auto shrink-0 text-[11px] text-faint">{c.durationMs.toFixed(1)}ms</span>}
                </div>
                {!c.ok && c.error && <pre className="mono mt-1 ml-6 overflow-auto whitespace-pre-wrap rounded border border-bad/20 bg-bad/5 p-2 text-[11.5px] leading-relaxed text-[#fca5a5]">{c.error}{c.location ? `\n\nat ${c.location}` : ""}</pre>}
              </li>
            ))}
          </ul>
        )}
        {t && !t.parsed && <p className="px-3 py-2 text-[12px] text-warn">Test output could not be fully parsed; see the raw output below.</p>}
        <div className="border-t border-line px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Sandbox executions · {run.sandboxId}{run.nodeVersion ? ` · node ${run.nodeVersion}` : ""}</p>
          <ul className="space-y-1">
            {run.execs.map((e, i) => (
              <ExecRow key={i} e={e} open={open === `${run.id}-${i}`} toggle={() => setOpen(open === `${run.id}-${i}` ? null : `${run.id}-${i}`)} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "bad" }) {
  return (
    <span className="text-faint">
      {label} <span className={`mono font-semibold ${tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-fg"}`}>{value}</span>
    </span>
  );
}

function ExecRow({ e, open, toggle }: { e: ExecRecord; open: boolean; toggle: () => void }) {
  const ok = e.exitCode === 0 && !e.error;
  return (
    <li className="rounded border border-line">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px]">
        <span className={`mono w-14 shrink-0 ${ok ? "text-ok" : "text-bad"}`}>{e.timedOut ? "timeout" : e.exitCode === null ? "error" : `exit ${e.exitCode}`}</span>
        <span className="w-16 shrink-0 text-muted">{e.label}</span>
        <span className={`mono truncate ${e.error ? "text-bad" : "text-faint"}`} title={e.error ?? e.command}>{e.error ?? e.command}</span>
        <span className="mono ml-auto shrink-0 text-[11px] text-faint">{(e.durationMs / 1000).toFixed(2)}s</span>
      </button>
      {open && (
        <div className="border-t border-line p-2">
          {e.error && <pre className="mono whitespace-pre-wrap text-[11.5px] text-bad">{e.error}</pre>}
          <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#c8c8d0]">{e.stdout || "(no stdout)"}</pre>
          {e.stderr && <pre className="mono mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#fca5a5]">{e.stderr}</pre>}
        </div>
      )}
    </li>
  );
}

function RepairHistory({ repairs, runs }: { repairs: RepairSession[]; runs: Run[] }) {
  if (!repairs.length) return <p className="p-4 text-[13px] text-faint">No repairs yet. When tests fail, click <span className="text-fg">Fix bugs</span>: DUALDEV sends the real failure output and relevant code to the model, applies its patch, and re-runs the tests.</p>;
  const outcome = {
    running: ["In progress", "text-accent"],
    verified: ["Fix verified", "text-ok"],
    unresolved: ["Unresolved", "text-bad"],
    error: ["Error", "text-bad"],
    cancelled: ["Cancelled", "text-muted"],
  } as const;
  return (
    <div className="h-full space-y-4 overflow-auto p-3">
      {[...repairs].reverse().map((s) => {
        const baseline = runs.find((r) => r.id === s.baselineRunId);
        return (
          <article key={s.id} className="rounded-lg border border-line">
            <header className="flex items-center gap-3 border-b border-line px-3 py-2 text-[12px]">
              <span className={`font-semibold ${outcome[s.outcome][1]}`}>{outcome[s.outcome][0]}</span>
              <span className="text-faint">{s.attempts.length} attempt{s.attempts.length === 1 ? "" : "s"} · started {timeAgo(s.startedAt)}</span>
              {baseline?.tests && <span className="mono ml-auto text-faint">before: {baseline.tests.passed}/{baseline.tests.total} passing</span>}
            </header>
            <div className="px-3 py-2 text-[12.5px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Original failure</p>
              <ul className="mt-1 space-y-0.5">
                {s.originalFailures.map((f, i) => (
                  <li key={i} className="text-muted"><span className="mono text-bad">[{f.category}]</span> {f.testName && <span className="text-fg">{f.testName}: </span>}{f.message}</li>
                ))}
              </ul>
              {s.note && <p className="mt-2 text-warn">{s.note}</p>}
            </div>
            {s.attempts.map((a) => {
              const verify = runs.find((r) => r.id === a.verifyRunId);
              return (
                <div key={a.attempt} className="border-t border-line px-3 py-2">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-semibold">Attempt {a.attempt}</span>
                    {a.rejected ? <span className="text-warn">rejected before applying</span> : a.verified === true ? <span className="text-ok">verified by re-run</span> : a.verified === false ? <span className="text-bad">re-run still failing</span> : <span className="text-accent">verifying…</span>}
                    {verify?.tests && <span className="mono ml-auto text-faint">after: {verify.tests.passed}/{verify.tests.total} passing</span>}
                  </div>
                  {a.rejected && <p className="mt-1 text-[12px] text-warn">{a.rejected}</p>}
                  {a.summary && <p className="mt-1 text-[12.5px] text-muted"><span className="text-faint">Patch:</span> {a.summary}</p>}
                  {a.rootCause && <p className="mt-0.5 text-[12.5px] text-muted"><span className="text-faint">Root cause (model hypothesis):</span> {a.rootCause}</p>}
                  {a.changes.map((c) => <Diff key={c.path} path={c.path} before={c.before} after={c.after} />)}
                </div>
              );
            })}
          </article>
        );
      })}
    </div>
  );
}

function Diff({ path, before, after }: { path: string; before: string | null; after: string }) {
  const lines = diffLines(before ?? "", after);
  const { added, removed } = diffStats(lines);
  // Show changed lines with 3 lines of context.
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = i - 3; k <= i + 3; k++) keep.add(k);
  });
  return (
    <div className="mt-2 overflow-hidden rounded border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-2 py-1 text-[11.5px]">
        <span className="mono text-fg">{path}</span>
        {before === null && <span className="text-ok">new file</span>}
        <span className="mono ml-auto"><span className="text-ok">+{added}</span> <span className="text-bad">−{removed}</span></span>
      </div>
      <pre className="mono max-h-80 overflow-auto py-1 text-[11.5px] leading-[1.55]">
        {lines.map((l, i) =>
          keep.has(i) ? (
            <div key={i} className={`flex ${l.type === "add" ? "bg-ok/10 text-[#a7f3d0]" : l.type === "del" ? "bg-bad/10 text-[#fecaca]" : "text-faint"}`}>
              <span className="w-10 shrink-0 select-none pr-2 text-right opacity-60">{l.oldNo ?? ""}</span>
              <span className="w-10 shrink-0 select-none pr-2 text-right opacity-60">{l.newNo ?? ""}</span>
              <span className="w-4 shrink-0 select-none">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
              <span className="pr-4">{l.text || " "}</span>
            </div>
          ) : keep.has(i - 1) ? (
            <div key={i} className="px-2 text-faint/60">⋯</div>
          ) : null,
        )}
      </pre>
    </div>
  );
}

function Preview({ p, onStart, onStop }: { p: ProjectView; onStart: () => void; onStop: () => void }) {
  if (!p.files["server.js"]) return <p className="p-4 text-[13px] text-faint">No server.js in this project yet.</p>;
  if (!p.preview) {
    return (
      <div className="p-4 text-[13px] text-muted">
        <p>Start the app inside its CreateOS sandbox and expose port 3000 through sandbox ingress.</p>
        <p className="mt-1 text-faint">This enables a public preview URL for this sandbox until you stop it.</p>
        <div className="mt-3"><Button onClick={onStart} disabled={p.busy}>Start live preview</Button></div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
        <a href={p.preview.url} target="_blank" rel="noreferrer" className="mono truncate text-accent hover:underline">{p.preview.url}</a>
        <span className="ml-auto text-faint">started {timeAgo(p.preview.startedAt)}</span>
        <Button variant="ghost" onClick={onStop} disabled={p.busy}>Stop</Button>
      </div>
      <iframe src={p.preview.url} className="min-h-0 flex-1 bg-white" sandbox="allow-scripts allow-forms allow-same-origin" title="Application preview" />
    </div>
  );
}
