import type { ExecRecord } from "../types";

export interface SandboxSession {
  readonly id: string;
  /** Replace the project workspace inside the sandbox with exactly these files. */
  sync(files: Record<string, string>): Promise<ExecRecord>;
  /** Run an approved shell script in the workspace with a hard timeout. */
  exec(label: string, script: string, timeoutSec: number): Promise<ExecRecord>;
  startPreview(port: number): Promise<string>;
  stopPreview(port: number): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  configured(): { ok: true } | { ok: false; reason: string };
  /** Reconnect to an existing sandbox (resuming if paused) or create a new one. */
  acquire(existingId: string | undefined): Promise<SandboxSession>;
  destroy(id: string): Promise<void>;
}

export class SandboxUnavailableError extends Error {}
