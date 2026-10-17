// TEST-ONLY doubles. The product never uses these: production execution goes
// through CreateOSProvider. LocalTestSandbox runs only fixture code authored in
// this repo plus scripted patches, inside a temp dir, to exercise the pipeline.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelProvider } from "@/lib/ai/provider";
import type { SandboxProvider, SandboxSession } from "@/lib/sandbox/types";
import type { ExecRecord } from "@/lib/types";

class LocalTestSession implements SandboxSession {
  constructor(readonly id: string, private dir: string) {}
  async sync(files: Record<string, string>): Promise<ExecRecord> {
    await rm(this.dir, { recursive: true, force: true });
    for (const [p, c] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(this.dir, p)), { recursive: true });
      await writeFile(path.join(this.dir, p), c);
    }
    return { label: "sync", command: "sync", exitCode: 0, stdout: "", stderr: "", durationMs: 0, timedOut: false };
  }
  exec(label: string, script: string, timeoutSec: number): Promise<ExecRecord> {
    const started = Date.now();
    return new Promise((resolve) => {
      execFile("sh", ["-c", `cd ${this.dir} && ${script}`], { timeout: timeoutSec * 1000, env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } }, (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) ?? 1 : 0;
        resolve({ label, command: script, exitCode: typeof code === "number" ? code : 1, stdout, stderr, durationMs: Date.now() - started, timedOut: false });
      });
    });
  }
  async startPreview() {
    return "http://test.invalid";
  }
  async stopPreview() {}
}

export class LocalTestSandbox implements SandboxProvider {
  readonly name = "local-test-sandbox";
  created = 0;
  constructor(private base: string) {}
  configured() {
    return { ok: true as const };
  }
  async acquire(existing?: string) {
    if (existing) return new LocalTestSession(existing, path.join(this.base, existing));
    const id = `sb_test_${++this.created}`;
    return new LocalTestSession(id, path.join(this.base, id));
  }
  async destroy() {}
}

export class ScriptedModel implements ModelProvider {
  readonly name = "scripted-model";
  calls: { system: string; user: string }[] = [];
  constructor(private responses: string[]) {}
  configured() {
    return { ok: true as const };
  }
  async generateJson(args: { system: string; user: string }) {
    this.calls.push(args);
    const next = this.responses.shift();
    if (next === undefined) throw new Error("ScriptedModel: no more responses");
    return next;
  }
}

export async function tempDir(prefix = "dualdev-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
