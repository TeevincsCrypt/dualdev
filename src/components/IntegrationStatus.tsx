"use client";
import { useEffect, useState } from "react";
import { api } from "./ui";

type Status = { sandbox: { name: string; ok: boolean; reason?: string }; model: { name: string; ok: boolean; reason?: string } };

export function useIntegrationStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  return status;
}

export function IntegrationStatus({ status }: { status: Status | null }) {
  if (!status) return null;
  const items = [
    { label: "Sandbox", ...status.sandbox },
    { label: "Model", ...status.model },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px]">
      {items.map((i) => (
        <span key={i.label} title={i.ok ? i.name : i.reason} className="inline-flex items-center gap-1.5 text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${i.ok ? "bg-ok" : "bg-bad"}`} />
          <span className="text-faint">{i.label}</span>
          <span>{i.ok ? i.name : "not configured"}</span>
        </span>
      ))}
    </div>
  );
}

export function MissingConfigNotice({ status }: { status: Status | null }) {
  if (!status || (status.sandbox.ok && status.model.ok)) return null;
  return (
    <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-[13px] text-warn">
      <p className="font-medium">Setup incomplete — runs will fail with a clear error until this is fixed.</p>
      <ul className="mt-1 list-disc pl-5 text-warn/80">
        {!status.sandbox.ok && <li>CreateOS: {status.sandbox.reason}</li>}
        {!status.model.ok && <li>AI model: {status.model.reason}</li>}
      </ul>
    </div>
  );
}
