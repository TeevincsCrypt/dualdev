/**
 * CreateOS execution proof from the command line (same code path as the
 * dashboard's "Run proof"). Needs CREATEOS_SANDBOX_API_KEY and network access
 * to the CreateOS control plane.
 *   npm run sandbox:check
 */
import { existsSync } from "node:fs";
import { runCreateOSProof } from "../src/lib/sandbox/proof";

// Next.js loads .env.local automatically; this standalone script must do it
// itself. Real environment variables win over file values.
const loaded: string[] = [];
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  process.loadEnvFile(file);
  loaded.push(file);
}
console.log(`env files loaded: ${loaded.join(", ") || "none"} (cwd: ${process.cwd()})`);
console.log(`CREATEOS_SANDBOX_API_KEY: ${process.env.CREATEOS_SANDBOX_API_KEY ? "set" : "MISSING"}`);

const r = await runCreateOSProof();
const { program: _p, ...summary } = r;
console.log(JSON.stringify(summary, null, 2));
console.log(r.ok ? "\nVERIFIED: Python ran inside CreateOS sandbox " + r.sandbox?.id : "\nNOT VERIFIED: " + (r.error ?? "unexpected output"));
process.exitCode = r.ok ? 0 : 1;
