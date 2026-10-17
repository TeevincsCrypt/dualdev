import { handle, ok } from "@/lib/http";
import { createCheckout, PLANS, type PlanId } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Body: { plan: "pro" } → { url } of a Stripe-hosted Checkout page. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { plan?: unknown };
    const plan = (typeof body.plan === "string" && body.plan in PLANS ? body.plan : null) as PlanId | null;
    if (!plan) throw new Error("Unknown plan");
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const session = await createCheckout(plan, origin);
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return ok({ url: session.url, id: session.id });
  });
}
