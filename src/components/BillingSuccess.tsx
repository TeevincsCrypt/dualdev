"use client";
import { useEffect, useState } from "react";
import { api, Logo } from "./ui";

type Session = { id: string; status: string | null; paymentStatus: string; email: string | null; amountTotal: number | null; currency: string | null; livemode: boolean; plan: string | null };

export function BillingSuccess({ sessionId }: { sessionId: string }) {
  const [s, setS] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Session>(`/api/checkout/session?id=${encodeURIComponent(sessionId)}`).then(setS, (e: Error) => setError(e.message));
  }, [sessionId]);
  const paid = s?.status === "complete" && (s.paymentStatus === "paid" || s.paymentStatus === "no_payment_required");
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <Logo href="/" />
      <div className="mt-8 rounded-[24px] border border-line bg-panel p-8 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
        {error ? (
          <p className="text-bad">Could not verify the payment: {error}</p>
        ) : !s ? (
          <p className="text-muted">Verifying your payment with Stripe…</p>
        ) : paid ? (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-[22px] text-white">✓</span>
            <h1 className="mt-4 text-[26px] font-bold">Welcome to DualDev Pro</h1>
            <p className="mt-2 text-muted">
              Payment verified with Stripe{s.livemode ? "" : " (test mode)"}: {((s.amountTotal ?? 0) / 100).toFixed(2)} {s.currency?.toUpperCase()}
              {s.email ? ` · ${s.email}` : ""}.
            </p>
          </>
        ) : (
          <p className="text-warn">Checkout not completed yet (status: {s.status}, payment: {s.paymentStatus}).</p>
        )}
        <a href="/app" className="mt-6 inline-block rounded-full bg-accent px-6 py-2.5 text-[14px] font-medium text-white hover:bg-[#435f4e]">Open DualDev</a>
      </div>
    </div>
  );
}
