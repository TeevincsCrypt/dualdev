import { agent } from "@/lib/server";
import { ok } from "@/lib/http";
import { stripeStatus } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Reports only whether integrations are configured — never credential values.
export async function GET() {
  return ok({ ...agent().status(), stripe: stripeStatus() });
}
