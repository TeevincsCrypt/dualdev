import { agent } from "@/lib/server";
import { fail, handle, ok } from "@/lib/http";
import { runCreateOSProof, type ProofResult } from "@/lib/sandbox/proof";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running: Promise<ProofResult> | null = null;

/** Last recorded proof run (real CreateOS results only). */
export async function GET() {
  return handle(async () => ok({ running: running !== null, result: await agent().store.getMeta<ProofResult>("proof") }));
}

/** Creates a fresh sandbox, runs a Python program in it, destroys it. */
export async function POST() {
  return handle(async () => {
    if (running) return fail(409, "A proof run is already in progress.");
    running = runCreateOSProof(await agent().sharedSandboxId());
    try {
      const result = await running;
      await agent().store.saveMeta("proof", result);
      return ok({ running: false, result });
    } finally {
      running = null;
    }
  });
}
