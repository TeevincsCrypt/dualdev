import "server-only";
import Stripe from "stripe";

export const PLANS = {
  pro: { name: "DualDev Pro", amount: 1900, currency: "usd", interval: "month" as const },
};
export type PlanId = keyof typeof PLANS;

export function stripeStatus(): { ok: true; mode: "test" | "live" } | { ok: false; reason: string } {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "STRIPE_SECRET_KEY is not set on the server." };
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (live && process.env.STRIPE_ALLOW_LIVE !== "1") {
    return { ok: false, reason: "A live Stripe key is configured; set STRIPE_ALLOW_LIVE=1 to accept real payments, or use a test key (sk_test_…)." };
  }
  return { ok: true, mode: live ? "live" : "test" };
}

let client: Stripe | null = null;

export function stripe(): Stripe {
  const s = stripeStatus();
  if (!s.ok) throw new Error(`Stripe unavailable: ${s.reason}`);
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}

/** Creates a Stripe Checkout Session for a subscription plan. Uses STRIPE_PRICE_ID if set, else inline price data. */
export async function createCheckout(plan: PlanId, origin: string) {
  const p = PLANS[plan];
  const lineItem = process.env.STRIPE_PRICE_ID
    ? { price: process.env.STRIPE_PRICE_ID, quantity: 1 }
    : {
        quantity: 1,
        price_data: { currency: p.currency, unit_amount: p.amount, recurring: { interval: p.interval }, product_data: { name: p.name } },
      };
  return stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [lineItem],
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: true,
    metadata: { plan },
  });
}
