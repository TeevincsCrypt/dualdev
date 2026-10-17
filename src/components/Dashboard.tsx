"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ProjectStatus } from "@/lib/types";
import { SandboxProof } from "./SandboxProof";
import { BugHunter } from "./BugHunter";
import { IntegrationStatus, MissingConfigNotice, useIntegrationStatus } from "./IntegrationStatus";
import { api, Button, Logo, StatusBadge, timeAgo } from "./ui";

type Summary = {
  id: string;
  name: string;
  spec: string;
  origin: "generated" | "fixture";
  status: ProjectStatus;
  busy: boolean;
  updatedAt: string;
  fileCount: number;
  lastRun: { finishedAt: string; passed: boolean; tests: { passed: number; failed: number; total: number } | null } | null;
};

const STARTERS = [
  { label: "Expense tracker", spec: "An expense tracker: add expenses with amount, category and date; list them newest first; show totals per category and a monthly total; delete expenses. Persist to localStorage." },
  { label: "Task manager", spec: "A task manager with task creation, completion toggles, priority levels (low/medium/high), category filters, and a dashboard showing completed versus pending tasks." },
  { label: "Habit tracker", spec: "A habit tracker: create habits, check them off per day, show the current streak and the longest streak for each habit, and a weekly completion percentage." },
  { label: "Finance dashboard", spec: "A personal finance dashboard: record income and expense transactions, compute balance, savings rate, and the top three spending categories for the current month." },
  { label: "Inventory manager", spec: "A simple inventory manager: add items with SKU, name, quantity and reorder level; adjust stock up and down (never below zero); list items that need reordering." },
];

export function Dashboard() {
  const router = useRouter();
  const status = useIntegrationStatus();
  const [spec, setSpec] = useState("");
  const [autoFix, setAutoFix] = useState(true);
  const [projects, setProjects] = useState<Summary[] | null>(null);
  const [pending, setPending] = useState<"build" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api<Summary[]>("/api/projects").then(setProjects).catch(() => setProjects([]));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function create(body: object, kind: "build" | "demo") {
    setPending(kind);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify(body) });
      if (kind === "demo") await api(`/api/projects/${id}/demo`, { method: "POST" }).catch(() => undefined);
      router.push(`/projects/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-16">
      <nav className="flex flex-wrap items-center justify-between gap-4 pt-8 pb-6">
        <div className="flex items-center gap-5">
          <Logo />
          <div className="hidden border-l border-line-strong pl-5 sm:block">
            <p className="text-[20px] font-semibold leading-tight">Hello, builder!</p>
            <p className="text-[13px] text-muted">One AI. Two superpowers. Build and fix.</p>
          </div>
        </div>
        <div className="rounded-full border border-line bg-panel px-4 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <IntegrationStatus status={status} />
        </div>
      </nav>

      <section className="grid gap-4 pb-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" value={projects?.length ?? "—"} />
        <StatCard label="Passing" value={projects?.filter((p) => p.status === "passing").length ?? "—"} tone="ok" />
        <StatCard label="Failing" value={projects?.filter((p) => p.status === "failing" || p.status === "error").length ?? "—"} tone="bad" />
        <StatCard label="Running now" value={projects?.filter((p) => p.busy).length ?? "—"} accent />
      </section>

      <section className="grid gap-4 pb-6 md:grid-cols-2">
        <ModeCard tone="accent" title="Build" body="Describe an app. DualDev writes the code and tests, runs them in an isolated CreateOS sandbox, and shows a live preview." />
        <ModeCard tone="accent-2" title="Fix" body="Reads real test and runtime output, patches the faulty code, and re-runs the tests to verify — at most 3 attempts. Or scan any website for bugs." />
      </section>

      <div className="mb-6 space-y-4">
        <MissingConfigNotice status={status} />
      </div>

      <section className="rounded-[22px] border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.03)] p-4">
        <label htmlFor="spec" className="text-[12px] font-medium text-muted">New project</label>
        <textarea
          id="spec"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="e.g. A habit tracker that shows daily streaks and a weekly completion rate…"
          className="mt-2 w-full resize-y rounded-md border border-line bg-bg px-3 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-faint focus:border-accent/60"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-faint">Start from an idea:</span>
          {STARTERS.map((s) => (
            <button key={s.label} onClick={() => setSpec(s.spec)} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted hover:border-line-strong hover:text-fg">
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={autoFix} onChange={(e) => setAutoFix(e.target.checked)} className="accent-[#4f6f5b]" />
            Automatically try to fix failing tests (up to 3 attempts)
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending !== null} onClick={() => create({ demo: true }, "demo")} title="Load a prebuilt task-manager fixture with one known bug, then run tests and fix it live">
              {pending === "demo" ? "Starting…" : "Run Build → Break → Fix demo"}
            </Button>
            <Button variant="primary" disabled={pending !== null || spec.trim().length < 10} onClick={() => create({ spec, autoFix }, "build")}>
              {pending === "build" ? "Creating…" : "Build it"}
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}
      </section>

      <div className="mt-6"><BugHunter /></div>
      <div className="mt-6"><SandboxProof /></div>

      <section className="mt-10">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Recent projects</h2>
        {projects === null ? (
          <p className="text-[13px] text-faint">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-faint">
            No projects yet. Describe an app above, or run the demo to watch DUALDEV find and repair a real bug.
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`/projects/${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-panel-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium">{p.name}</span>
                      {p.origin === "fixture" && <span className="rounded border border-line px-1.5 text-[10px] uppercase tracking-wider text-faint">fixture</span>}
                    </div>
                    <p className="truncate text-[12px] text-faint">{p.spec}</p>
                  </div>
                  <div className="hidden text-right text-[12px] text-muted sm:block">
                    {p.lastRun?.tests ? (
                      <span className="mono">
                        <span className="text-ok">{p.lastRun.tests.passed}✓</span> <span className={p.lastRun.tests.failed ? "text-bad" : "text-faint"}>{p.lastRun.tests.failed}✗</span>
                      </span>
                    ) : (
                      <span className="text-faint">no runs</span>
                    )}
                    <div className="text-faint">{p.lastRun ? `ran ${timeAgo(p.lastRun.finishedAt)}` : `updated ${timeAgo(p.updatedAt)}`}</div>
                  </div>
                  <StatusBadge status={p.status} busy={p.busy} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, tone, accent }: { label: string; value: number | string; tone?: "ok" | "bad"; accent?: boolean }) {
  return (
    <div className={`rounded-[22px] border px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${accent ? "border-transparent bg-gradient-to-br from-[#5f8069] to-[#4f6f5b] text-white" : "border-line bg-panel"}`}>
      <p className={`text-[13px] ${accent ? "text-white/80" : "text-muted"}`}>{label}</p>
      <p className={`mt-1 text-[28px] font-bold leading-none ${accent ? "" : tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-fg"}`}>{value}</p>
    </div>
  );
}

function ModeCard({ title, body, tone }: { title: string; body: string; tone: "accent" | "accent-2" }) {
  return (
    <div className="flex gap-4 rounded-[22px] border border-line bg-panel px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone === "accent" ? "bg-accent text-white" : "bg-[#e3ebe5] text-accent"} text-[15px] font-bold`}>{title[0]}</span>
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}
