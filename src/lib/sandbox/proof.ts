import { CreateosSandboxError } from "@nodeops-createos/sandbox";
import { createosClient } from "./client";
import { sandboxName } from "./types";
import os from "node:os";
import { redact, truncate } from "../security/validation";

/** A deterministic Python program; its output can be checked by hand. */
export const PROOF_PROGRAM = `import hashlib, platform, socket, sys
primes = [n for n in range(2, 10000) if all(n % d for d in range(2, int(n ** 0.5) + 1))]
print("hello from inside a CreateOS sandbox")
print("python", sys.version.split()[0], "on", platform.system(), platform.machine())
print("hostname", socket.gethostname())
print("primes below 10000:", len(primes), "sum:", sum(primes))
print("sha256('dualdev'):", hashlib.sha256(b"dualdev").hexdigest()[:16])
`;
export const PROOF_EXPECTED = ["primes below 10000: 1229 sum: 5736396", "sha256('dualdev'):"];

export interface ProofResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  userId?: string;
  sandbox?: { id: string; status: string; shape?: string; rootfs?: string; region?: string; ip?: string; createdAt?: string; spawnMs?: number };
  program: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  execMs?: number;
  guest?: { hostname: string; kernel: string };
  host: { hostname: string; platform: string };
  outputMatchesExpected: boolean;
  destroyed: boolean;
  error?: string;
}

const describe = (e: unknown) => (e instanceof CreateosSandboxError ? `${e.name}: ${e.message}` : e instanceof Error ? e.message : String(e));

/**
 * Creates a fresh CreateOS sandbox, runs PROOF_PROGRAM with python3, records the
 * control-plane metadata and in-guest identity next to this server's identity,
 * then destroys the sandbox. Every field comes from real API responses.
 */
export async function runCreateOSProof(): Promise<ProofResult> {
  const startedAt = new Date().toISOString();
  const host = { hostname: os.hostname(), platform: `${os.platform()} ${os.release()}` };
  const base: ProofResult = {
    ok: false,
    startedAt,
    finishedAt: startedAt,
    baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || "https://api.sb.createos.sh",
    program: PROOF_PROGRAM,
    command: "python3 /root/proof/hello.py",
    exitCode: null,
    stdout: "",
    stderr: "",
    host,
    outputMatchesExpected: false,
    destroyed: false,
  };
  if (!process.env.CREATEOS_SANDBOX_API_KEY) {
    return { ...base, error: "CREATEOS_SANDBOX_API_KEY is not set on the server." };
  }

  const client = createosClient();
  base.baseUrl = client.baseUrl;
  try {
    base.userId = (await client.whoami()).user_id;
  } catch (e) {
    return { ...base, finishedAt: new Date().toISOString(), error: `Could not authenticate with CreateOS: ${redact(describe(e))}` };
  }

  let sandbox;
  try {
    sandbox = await client.createSandbox({
      shape: process.env.CREATEOS_SANDBOX_SHAPE || "s-1vcpu-1gb",
      rootfs: process.env.CREATEOS_SANDBOX_ROOTFS || "devbox:1",
      egress: ["registry.npmjs.org:443"],
      name: sandboxName("proof"),
    });
  } catch (e) {
    return { ...base, finishedAt: new Date().toISOString(), error: `Sandbox creation failed: ${redact(describe(e))}` };
  }

  try {
    await sandbox.refresh().catch(() => undefined);
    const v = sandbox.data;
    base.sandbox = { id: v.id, status: v.status, shape: v.shape, rootfs: v.rootfs, region: v.region, ip: v.ip, createdAt: v.created_at, spawnMs: v.spawn_ms };

    await sandbox.runCommand("mkdir", ["-p", "/root/proof"], { timeoutMs: 30_000 });
    await sandbox.files.upload("/root/proof/hello.py", PROOF_PROGRAM, { timeoutMs: 30_000 });
    const { result, exec_ms } = await sandbox.runCommand("python3", ["/root/proof/hello.py"], { timeoutMs: 60_000 });
    base.exitCode = result.exit_code;
    base.stdout = truncate(redact(result.stdout ?? ""));
    base.stderr = truncate(redact((result.stderr ?? "") + (result.error ? `\n${result.error}` : "")));
    base.execMs = exec_ms;

    const id = await sandbox.runCommand("sh", ["-c", "hostname; uname -sr"], { timeoutMs: 30_000 });
    const [hostname = "", kernel = ""] = id.result.stdout.trim().split("\n");
    base.guest = { hostname, kernel };
    base.outputMatchesExpected = PROOF_EXPECTED.every((s) => base.stdout.includes(s));
    base.ok = result.exit_code === 0 && base.outputMatchesExpected;
  } catch (e) {
    base.error = `Execution failed: ${redact(describe(e))}`;
  } finally {
    try {
      await sandbox.destroy();
      base.destroyed = true;
    } catch (e) {
      base.error = `${base.error ? `${base.error}; ` : ""}destroy failed: ${describe(e)}`;
    }
  }
  return { ...base, finishedAt: new Date().toISOString() };
}
