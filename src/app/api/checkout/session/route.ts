import { handle, ok } from "@/lib/http";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Verifies a Checkout Session server-side: the success page never trusts the redirect alone. */
export async function GET(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid session id");
    const s = await stripe().checkout.sessions.retrieve(id);
    return ok({
      id: s.id,
      status: s.status,
      paymentStatus: s.payment_status,
      email: s.customer_details?.email ?? null,
      amountTotal: s.amount_total,
      currency: s.currency,
      livemode: s.livemode,
      plan: s.metadata?.plan ?? null,
    });
  });
}
