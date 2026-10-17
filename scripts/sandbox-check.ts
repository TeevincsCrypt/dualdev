/**
 * CreateOS execution proof from the command line (same code path as the
 * dashboard's "Run proof"). Needs CREATEOS_SANDBOX_API_KEY and network access
 * to the CreateOS control plane.
 *   npm run sandbox:check
 */
import { runCreateOSProof } from "../src/lib/sandbox/proof";

const r = await runCreateOSProof();
const { program: _p, ...summary } = r;
console.log(JSON.stringify(summary, null, 2));
console.log(r.ok ? "\nVERIFIED: Python ran inside CreateOS sandbox " + r.sandbox?.id : "\nNOT VERIFIED: " + (r.error ?? "unexpected output"));
process.exitCode = r.ok ? 0 : 1;
