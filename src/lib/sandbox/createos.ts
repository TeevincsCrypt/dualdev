import {
  type CreateosSandboxClient,
  CreateosSandboxError,
  CreateosSandboxNotFoundError,
  Sandbox,
} from "@nodeops-createos/sandbox";
import path from "node:path";
import type { ExecRecord } from "../types";
import { createosClient, createosClientOptions } from "./client";
import { redact, truncate, validateRelativePath } from "../security/validation";
import { isQuotaError, SANDBOX_NAME_PREFIX, sandboxName, SandboxQuotaError, SandboxUnavailableError, type SandboxProvider, type SandboxSession } from "./types";

export const WORKDIR = "/root/app";
const SHAPE = process.env.CREATEOS_SANDBOX_SHAPE || "s-1vcpu-1gb";
const ROOTFS = process.env.CREATEOS_SANDBOX_ROOTFS || "devbox:1";
// Generated apps are zero-dependency, so the sandbox needs no general egress.
// The API treats an empty list as "allow all", so we pin a narrow allowlist.
const EGRESS = ["registry.npmjs.org:443"];
// Sandboxes are created per job and destroyed afterwards; auto-pause is only a
// safety net if the server dies mid-job (paused sandboxes do not hold the
// account's concurrency slot).
const AUTO_PAUSE_SECONDS = 300;

function describe(err: unknown): string {
  if (err instanceof CreateosSandboxError) return `${err.name}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

class CreateOSSession implements SandboxSession {
  constructor(private readonly sb: Sandbox) {}

  get id() {
    return this.sb.id;
  }

  async sync(files: Record<string, string>): Promise<ExecRecord> {
    const started = Date.now();
    const paths = Object.keys(files).map((p) => validateRelativePath(p));
    const dirs = [...new Set(paths.map((p) => path.posix.dirname(p)).filter((d) => d !== "."))];
    // Paths are validated to [A-Za-z0-9._-/] so single-quoting is safe.
    const mk = [`rm -rf ${WORKDIR}`, `mkdir -p ${WORKDIR}`, ...dirs.map((d) => `mkdir -p '${WORKDIR}/${d}'`)].join(" && ");
    const prep = await this.exec("sync", mk, 30, false);
    if (prep.exitCode !== 0) return prep;
    try {
      for (const p of paths) await this.sb.files.upload(`${WORKDIR}/${p}`, files[p], { timeoutMs: 30_000 });
    } catch (err) {
      return { ...prep, label: "sync", exitCode: null, error: `Upload failed: ${describe(err)}`, durationMs: Date.now() - started };
    }
    return {
      label: "sync",
      command: `upload ${paths.length} files → ${WORKDIR}`,
      exitCode: 0,
      stdout: `Uploaded ${paths.length} files`,
      stderr: "",
      durationMs: Date.now() - started,
      timedOut: false,
    };
  }

  async exec(label: string, script: string, timeoutSec: number, inWorkdir = true): Promise<ExecRecord> {
    const body = `export CI=1 NODE_ENV=test; ${inWorkdir ? `cd ${WORKDIR} && ${script}` : script}`;
    // `timeout` bounds the guest process (when the image has it); the request
    // timeout bounds the HTTP call either way.
    const quoted = shellQuote(body);
    const command = `if command -v timeout >/dev/null 2>&1; then timeout -k 5 ${timeoutSec} sh -c ${quoted}; else sh -c ${quoted}; fi`;
    const started = Date.now();
    try {
      const { result, exec_ms } = await this.sb.runCommand("sh", ["-c", command], {
        timeoutMs: (timeoutSec + 20) * 1000,
      });
      return {
        label,
        command: script,
        exitCode: result.exit_code,
        stdout: truncate(redact(result.stdout ?? "")),
        stderr: truncate(redact(result.stderr ?? "")),
        durationMs: exec_ms ?? Date.now() - started,
        timedOut: result.exit_code === 124 || result.exit_code === 137,
        error: result.error ? redact(result.error) : undefined,
      };
    } catch (err) {
      return {
        label,
        command: script,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut: /timeout/i.test(describe(err)),
        error: redact(describe(err)),
      };
    }
  }

  async startPreview(port: number): Promise<string> {
    await this.exec("preview-stop", `pkill -f 'node server.js' || true`, 10);
    const start = await this.exec(
      "preview-start",
      `PORT=${port} nohup setsid node server.js >/tmp/preview.log 2>&1 &`,
      15,
    );
    if (start.exitCode !== 0) throw new Error(start.stderr || start.error || "Failed to start preview server");
    await this.sb.waitForPortReady(port, { timeoutMs: 20_000 });
    await this.sb.setIngress(true);
    // The SDK tutorial uses http until the ingress domain has TLS; override if yours does.
    const scheme = process.env.CREATEOS_PREVIEW_SCHEME === "https" ? "https" : "http";
    return this.sb.previewUrl(port, { scheme });
  }

  async stopPreview(_port: number): Promise<void> {
    await this.exec("preview-stop", `pkill -f 'node server.js' || true`, 10);
    await this.sb.setIngress(false);
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class CreateOSProvider implements SandboxProvider {
  readonly name = "CreateOS Sandbox";
  #client: CreateosSandboxClient | null = null;

  configured() {
    if (!process.env.CREATEOS_SANDBOX_API_KEY) {
      return { ok: false as const, reason: "CREATEOS_SANDBOX_API_KEY is not set on the server." };
    }
    return { ok: true as const };
  }

  private client(): CreateosSandboxClient {
    const c = this.configured();
    if (!c.ok) throw new SandboxUnavailableError(c.reason);
    this.#client ??= createosClient();
    return this.#client;
  }

  async acquire(existingId: string | undefined): Promise<SandboxSession> {
    const client = this.client();
    if (existingId) {
      try {
        const sb = await Sandbox.connect(existingId, { ...createosClientOptions(), baseUrl: client.baseUrl });
        if (sb.status === "paused" || sb.status === "pausing") {
          if (sb.status === "pausing") await sb.waitUntilPaused({ timeoutMs: 60_000 });
          await sb.resume();
          await sb.waitUntilRunning({ timeoutMs: 60_000 });
        }
        if (sb.status === "running") return new CreateOSSession(sb);
      } catch (err) {
        if (isQuotaError(err)) throw this.quotaError(err);
        // Unusable (gone, stuck or failed to resume): discard it and start fresh.
      }
      await this.destroy(existingId).catch(() => undefined);
    }
    const request = { shape: SHAPE, rootfs: ROOTFS, egress: EGRESS, auto_pause_after_seconds: AUTO_PAUSE_SECONDS };
    try {
      try {
        return new CreateOSSession(await client.createSandbox({ ...request, name: sandboxName() }));
      } catch (err) {
        // If the control plane rejects our name format, create without one.
        if (isQuotaError(err) || (err as { statusCode?: number }).statusCode !== 400) throw err;
        return new CreateOSSession(await client.createSandbox(request));
      }
    } catch (err) {
      if (isQuotaError(err)) throw this.quotaError(err);
      throw new SandboxUnavailableError(`Sandbox creation failed: ${describe(err)}`);
    }
  }

  async reclaimOrphans(keep: string[]): Promise<number> {
    const running = await this.client().listSandboxes({ status: "running" });
    let freed = 0;
    for (const sb of running) {
      if (!sb.name?.startsWith(SANDBOX_NAME_PREFIX) || keep.includes(sb.id)) continue;
      await sb.destroy().then(() => freed++, () => undefined);
    }
    return freed;
  }

  private quotaError(err: unknown) {
    return new SandboxQuotaError(`CreateOS concurrent sandbox limit reached (${describe(err)}).`);
  }

  async destroy(id: string): Promise<void> {
    try {
      const sb = await Sandbox.connect(id, { ...createosClientOptions(), baseUrl: this.client().baseUrl });
      await sb.destroy();
    } catch (err) {
      if (!(err instanceof CreateosSandboxNotFoundError)) throw err;
    }
  }
}
