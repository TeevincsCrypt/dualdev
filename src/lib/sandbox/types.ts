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
  /** Reconnect to an existing sandbox (resuming if paused) or create a new one. Throws SandboxQuotaError at the concurrency limit. */
  acquire(existingId: string | undefined): Promise<SandboxSession>;
  destroy(id: string): Promise<void>;
  /** Pauses a sandbox so it stops holding the concurrency slot but can be resumed (saves the daily creation quota). */
  park(id: string): Promise<void>;
  /** Destroys running sandboxes DUALDEV created (by name prefix) except `keep`. Returns how many were destroyed. */
  reclaimOrphans?(keep: string[]): Promise<number>;
}

/** Name prefix for every sandbox DUALDEV creates, so leaks can be identified safely. */
export const SANDBOX_NAME_PREFIX = "dualdev-";

export function sandboxName(kind = "job"): string {
  return `${SANDBOX_NAME_PREFIX}${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Quota errors detected by name/status, not instanceof (robust to duplicate module copies). */
export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; statusCode?: number; message?: string } | null;
  if (!e) return false;
  return (e.name === "CreateosSandboxRateLimitError" || e.statusCode === 429) && /quota/i.test(e.message ?? "");
}

export class SandboxUnavailableError extends Error {}

/** The account's concurrent-sandbox limit is reached. */
export class SandboxQuotaError extends SandboxUnavailableError {}
