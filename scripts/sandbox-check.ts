/**
 * Minimal CreateOS connectivity check. Run once credentials are set:
 *   npm run sandbox:check
 * Creates one small sandbox, runs a command, round-trips a file, destroys it.
 */
import { CreateosSandboxClient } from "@nodeops-createos/sandbox";

const client = new CreateosSandboxClient();
console.log("control plane:", client.baseUrl);
const me = await client.whoami();
console.log("authenticated as:", me.user_id);

const sandbox = await client.createSandbox({
  shape: process.env.CREATEOS_SANDBOX_SHAPE || "s-1vcpu-1gb",
  rootfs: process.env.CREATEOS_SANDBOX_ROOTFS || "devbox:1",
  egress: ["registry.npmjs.org:443"],
});
console.log("sandbox:", sandbox.id, sandbox.status);
try {
  await sandbox.runCommand("mkdir", ["-p", "/root/check"]);
  await sandbox.files.upload("/root/check/hello.mjs", "console.log('hello from', process.version)\n");
  const { result, exec_ms } = await sandbox.runCommand("node", ["/root/check/hello.mjs"], { timeoutMs: 60_000 });
  console.log(`exit=${result.exit_code} (${exec_ms}ms) stdout=${JSON.stringify(result.stdout.trim())} stderr=${JSON.stringify(result.stderr.trim())}`);
  if (result.exit_code !== 0) process.exitCode = 1;
} finally {
  await sandbox.destroy().catch((e) => console.error("destroy failed:", e instanceof Error ? e.message : e));
  console.log("sandbox destroyed");
}
