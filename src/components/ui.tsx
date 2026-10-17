"use client";
import type { ProjectStatus } from "@/lib/types";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-2.5 select-none">
      <span className="relative grid h-7 w-7 place-items-center rounded-md border border-line-strong bg-panel-2">
        <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-[2px] bg-accent" />
        <span className="absolute bottom-1.5 right-1.5 h-2 w-2 rounded-[2px] bg-accent-2" />
      </span>
      {!compact && <span className="text-[15px] font-semibold tracking-[0.18em]">DUALDEV</span>}
    </a>
  );
}

const STATUS: Record<ProjectStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "text-muted border-line-strong" },
  building: { label: "Building", cls: "text-accent border-accent/40" },
  testing: { label: "Testing", cls: "text-accent-2 border-accent-2/40" },
  fixing: { label: "Fixing", cls: "text-warn border-warn/40" },
  passing: { label: "Passing", cls: "text-ok border-ok/40" },
  failing: { label: "Failing", cls: "text-bad border-bad/40" },
  error: { label: "Error", cls: "text-bad border-bad/40" },
  cancelled: { label: "Cancelled", cls: "text-muted border-line-strong" },
};

export function StatusBadge({ status, busy }: { status: ProjectStatus; busy?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${busy ? "pulse-dot" : ""}`} />
      {s.label}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  title?: string;
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const v = {
    primary: "bg-accent text-[#0b0b12] hover:bg-[#93a0ff]",
    secondary: "border border-line-strong bg-panel-2 text-fg hover:border-faint",
    ghost: "text-muted hover:text-fg",
    danger: "border border-bad/40 text-bad hover:bg-bad/10",
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`${base} ${v}`}>
      {children}
    </button>
  );
}

export function Panel({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel ${className}`}>
      {title !== undefined && (
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as { ok: boolean; data?: T; error?: string };
  if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.data as T;
}
