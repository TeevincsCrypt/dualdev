"use client";
import { useState } from "react";

export function CheckoutButton({ plan }: { plan: "pro" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
      const body = (await res.json()) as { ok: boolean; data?: { url: string }; error?: string };
      if (!body.ok || !body.data?.url) throw new Error(body.error || "Checkout failed");
      window.location.href = body.data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div>
      <button onClick={go} disabled={busy} className="rounded-full bg-white px-6 py-2.5 text-[14px] font-semibold text-accent shadow-sm hover:bg-white/90 disabled:opacity-60">
        {busy ? "Opening Stripe…" : "Upgrade to Pro"}
      </button>
      {error && <p className="mt-2 text-[13px] text-white">{error}</p>}
    </div>
  );
}
