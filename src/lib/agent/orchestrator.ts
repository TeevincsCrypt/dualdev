import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ModelUnavailableError, type ModelProvider } from "../ai/provider";
import { ProjectStore, type Store } from "../projects/store";
import { SandboxQuotaError, SandboxUnavailableError, type SandboxProvider, type SandboxSession } from "../sandbox/types";
import { LIMITS, validateFileSet } from "../security/validation";
import type { ActivityEvent, Project, RepairAttempt, RepairSession, Run, Stage } from "../types";
import { applyChanges, proposeRepair } from "./bug-hunter";
import { generateProject } from "./builder";
import { runChecks } from "./verifier";

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
class CancelledError extends Error {}

export const DEMO_SPEC =
  "Task manager: create tasks with a title and a priority (low/medium/high), toggle completion, " +
  "filter by priority, and show a dashboard with pending and completed counters.";

export interface AgentDeps {
  store: Store;
  sandbox: SandboxProvider;
  model: ModelProvider;
  fixtureDir: string;
  maxRepairAttempts?: number;
}

// One sandbox per job: created on first use, shared by every check and repair
// attempt in the job, destroyed when the job ends (unless a preview needs it).
/** Short non-reversible tag of the CreateOS key, so switching accounts never reuses another account's sandbox. */
function accountTag(): string {
  return createHash("sha256").update(process.env.CREATEOS_SANDBOX_API_KEY ?? "").digest("hex").slice(0, 12);
}

const HEARTBEAT_MS = 15_000;
const HEARTBEAT_STALE_MS = 2 * 60_000;

type Job = { cancelled: boolean; promise: Promise<void>; session?: SandboxSession };

function now() {
  return new Date().toISOString();
}

function freshVerification(): Project["verification"] {
  return { codeGenerated: false, compiles: null, appStarts: null, unitTestsPass: null, behaviourVerified: null, previewAvailable: false };
}

/**
 * Drives Build → Execute → Detect → Repair → Verify. HTTP handlers only start
 * jobs; every state transition here is caused by real model or sandbox output.
 */
export class Agent {
  readonly jobs = new Map<string, Job>();
  private readonly maxAttempts: number;

  constructor(private readonly deps: AgentDeps) {
    this.maxAttempts = Math.min(deps.maxRepairAttempts ?? LIMITS.maxRepairAttempts, LIMITS.maxRepairAttempts);
  }

  // ---------- queries ----------

  async get(id: string): Promise<Project> {
    const p = await this.deps.store.get(id);
    if (!p) throw new NotFoundError("Project not found");
    const beat = p.job?.heartbeatAt ?? p.job?.startedAt ?? p.updatedAt;
    const stale = Date.now() - new Date(beat).getTime() > HEARTBEAT_STALE_MS;
    if (p.busy && !this.jobs.has(id) && stale) {
      // The server restarted mid-job; don't leave the project stuck.
      p.busy = false;
      p.stage = "failed";
      p.status = "error";
      p.lastError = "The previous job was interrupted (server restart).";
      for (const r of p.repairs) if (r.outcome === "running") r.outcome = "error";
      await this.deps.store.save(p);
    }
    return p;
  }

  list() {
    return this.deps.store.list();
  }

  get store() {
    return this.deps.store;
  }

  /** The shared sandbox id, only if it was created with the currently configured API key. */
  async sharedSandboxId(): Promise<string | undefined> {
    const meta = await this.deps.store.getMeta<{ id: string; account?: string }>("sandbox");
    return meta && meta.account === accountTag() ? meta.id : undefined;
  }

  status() {
    return {
      sandbox: { name: this.deps.sandbox.name, ...this.deps.sandbox.configured() },
      model: { name: this.deps.model.name, ...this.deps.model.configured() },
      storage: { kind: this.deps.store.kind, durable: this.deps.store.durable },
    };
  }

  // ---------- project creation ----------

  async createFromSpec(spec: string): Promise<Project> {
    const clean = spec.trim();
    if (clean.length < 10) throw new Error("Describe the application in at least a sentence.");
    if (clean.length > LIMITS.maxSpecLength) throw new Error(`Description is too long (max ${LIMITS.maxSpecLength} characters).`);
    const p = this.blank(clean.split(/[.\n]/)[0].slice(0, 60) || "Untitled app", clean, "generated");
    await this.deps.store.save(p);
    return p;
  }

  async createDemo(): Promise<Project> {
    const files = await this.loadFixture();
    const p = this.blank("Task Manager (demo fixture)", DEMO_SPEC, "fixture");
    p.files = files;
    p.originalFiles = { ...files };
    p.plan = "Prebuilt fixture shipped with DUALDEV. Execution, failure detection, repair and verification run live.";
    p.limitations = "This project was not generated live; it is a controlled fixture with one known defect.";
    p.verification.codeGenerated = true;
    this.event(p, null, "info", `Loaded prebuilt demo fixture (${Object.keys(files).length} files).`);
    await this.deps.store.save(p);
    return p;
  }

  private blank(name: string, spec: string, origin: Project["origin"]): Project {
    const ts = now();
    return {
      id: ProjectStore.newId(),
      name,
      spec,
      origin,
      createdAt: ts,
      updatedAt: ts,
      status: "draft",
      stage: null,
      busy: false,
      files: {},
      events: [],
      runs: [],
      repairs: [],
      verification: freshVerification(),
    };
  }

  private async loadFixture(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const walk = async (dir: string) => {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else out[path.relative(this.deps.fixtureDir, full).split(path.sep).join("/")] = await readFile(full, "utf8");
      }
    };
    await walk(this.deps.fixtureDir);
    validateFileSet(out);
    return out;
  }

  // ---------- jobs ----------

  build(id: string, opts: { autoFix: boolean }) {
    return this.start("build", id, async (p, job) => {
      this.setStage(p, "understanding", "building", `Reading the specification (${p.spec.length} characters).`);
      await this.save(p);
      this.ensureModel();
      this.setStage(p, "generating", "building", `Generating application code with ${this.deps.model.name}.`);
      await this.save(p);
      const gen = await generateProject(this.deps.model, p.spec, async (reason) => {
        this.event(p, "generating", "warn", `First draft rejected by validator (${reason}); regenerating.`);
        await this.save(p);
      });
      this.checkCancel(job);
      p.name = gen.name;
      p.plan = gen.plan;
      p.limitations = gen.limitations;
      p.files = gen.files;
      p.originalFiles = { ...gen.files };
      p.verification = { ...freshVerification(), codeGenerated: true };
      const tests = Object.keys(gen.files).filter((f) => f.startsWith("test/")).length;
      this.event(p, "generating", "success", `Generated ${Object.keys(gen.files).length} project files (${tests} test file${tests === 1 ? "" : "s"}).`);
      await this.save(p);

      let run: Run;
      try {
        run = await this.check(p, job, "baseline", null);
      } catch (err) {
        if (!(err instanceof SandboxUnavailableError)) throw err;
        // Keep the generated code usable (instant preview) when CreateOS is unavailable.
        p.status = "draft";
        this.setStage(p, "completed", "draft", `Code generated. Sandbox checks skipped — ${this.userMessage(err)}`, "warn");
        return;
      }
      if (!run.passed && opts.autoFix) await this.repairLoop(p, job, run);
    });
  }

  test(id: string) {
    return this.start("test", id, async (p, job) => {
      if (Object.keys(p.files).length === 0) throw new Error("Nothing to test yet — build the project first.");
      await this.check(p, job, "check", null);
    });
  }

  fix(id: string) {
    return this.start("fix", id, async (p, job) => {
      if (Object.keys(p.files).length === 0) throw new Error("Nothing to fix yet — build the project first.");
      const last = p.runs.at(-1);
      // Always start the repair loop from a fresh, real baseline.
      const baseline = last && !last.passed && last.finishedAt > (p.repairs.at(-1)?.finishedAt ?? "") ? last : await this.check(p, job, "baseline", null);
      if (baseline.passed) {
        this.event(p, "completed", "success", "All checks pass — nothing to fix.");
        return;
      }
      await this.repairLoop(p, job, baseline);
    });
  }

  demo(id: string) {
    return this.start("demo", id, async (p, job) => {
      const baseline = await this.check(p, job, "baseline", null);
      if (baseline.passed) {
        this.event(p, "completed", "warn", "Baseline passed — the fixture defect is not present (was it already repaired?). Reset the demo to restore it.");
        return;
      }
      await this.repairLoop(p, job, baseline);
    });
  }

  preview(id: string) {
    return this.start("preview", id, async (p, job) => {
      if (!("server.js" in p.files)) throw new Error("This project has no server.js to preview.");
      this.setStage(p, "preparing_sandbox", p.status, "Preparing sandbox for preview.");
      await this.save(p);
      const session = await this.session(p, job);
      const sync = await session.sync(p.files);
      if (sync.exitCode !== 0) throw new Error(`File sync failed: ${sync.error ?? sync.stderr}`);
      this.setStage(p, "executing", p.status, "Starting preview server on port 3000 and enabling sandbox ingress.");
      await this.save(p);
      const url = await session.startPreview(3000);
      p.preview = { url, startedAt: now() };
      p.verification.previewAvailable = true;
      this.event(p, "completed", "success", `Preview is live at ${url}`);
    }, { keepStatus: true });
  }

  stopPreview(id: string) {
    return this.start("preview", id, async (p, job) => {
      if (p.preview && p.sandboxId) {
        const session = await this.session(p, job);
        await session.stopPreview(3000).catch(() => undefined);
      }
      // Clearing the preview lets the job's sandbox be destroyed on release.
      p.preview = undefined;
      p.verification.previewAvailable = false;
      this.event(p, "completed", "info", "Preview stopped.");
    }, { keepStatus: true });
  }

  async reset(id: string): Promise<Project> {
    const p = await this.get(id);
    if (p.busy) throw new ConflictError("A job is running for this project.");
    if (!p.originalFiles) throw new Error("This project has no original snapshot to reset to.");
    p.files = { ...p.originalFiles };
    p.runs = [];
    p.repairs = [];
    p.status = "draft";
    p.stage = null;
    p.lastError = undefined;
    p.verification = { ...freshVerification(), codeGenerated: true, previewAvailable: p.verification.previewAvailable };
    this.event(p, null, "info", `Reset files to the ${p.origin === "fixture" ? "demo fixture" : "originally generated version"}.`);
    await this.save(p);
    return p;
  }

  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }

  async remove(id: string) {
    const p = await this.get(id);
    if (p.busy) throw new ConflictError("A job is running for this project.");
    const shared = (await this.sharedSandboxId());
    if (p.sandboxId && p.sandboxId !== shared && this.deps.sandbox.configured().ok) {
      await this.deps.sandbox.destroy(p.sandboxId).catch(() => undefined);
    }
    await this.deps.store.delete(id);
  }

  /** Waits for a running job (used by tests and scripts). */
  async wait(id: string) {
    await this.jobs.get(id)?.promise;
  }

  // ---------- internals ----------

  private async start(kind: NonNullable<Project["job"]>["kind"], id: string, body: (p: Project, job: Job) => Promise<void>, opts: { keepStatus?: boolean } = {}) {
    const p = await this.get(id);
    if (p.busy || this.jobs.has(id)) throw new ConflictError("A job is already running for this project.");
    if (this.jobs.size > 0) {
      throw new ConflictError("Another project's job is running. DUALDEV runs one job at a time in its shared CreateOS sandbox; wait for it to finish.");
    }
    p.busy = true;
    p.lastError = undefined;
    p.job = { kind, startedAt: now(), heartbeatAt: now() };
    await this.save(p);

    const job: Job = { cancelled: false, promise: Promise.resolve() };
    this.jobs.set(id, job);
    // Heartbeat so other server instances (or a reloaded module) never mistake
    // a long model call for a dead job.
    const heartbeat = setInterval(() => {
      if (p.job) p.job.heartbeatAt = now();
      this.save(p).catch(() => undefined);
    }, HEARTBEAT_MS);
    job.promise = (async () => {
      try {
        await body(p, job);
        if (!opts.keepStatus) this.finalStatus(p);
      } catch (err) {
        if (err instanceof CancelledError) {
          p.status = "cancelled";
          this.setStage(p, "failed", "cancelled", "Cancelled by user.", "warn");
        } else {
          const msg = this.userMessage(err);
          p.lastError = msg;
          p.status = opts.keepStatus ? p.status : "error";
          this.setStage(p, "failed", p.status, msg, "error");
          console.error(`[dualdev] job failed for ${id}:`, err);
        }
      } finally {
        clearInterval(heartbeat);
        await this.releaseSession(p, job);
        p.busy = false;
        this.jobs.delete(id);
        await this.save(p).catch((e) => console.error("[dualdev] failed to persist project", e));
      }
    })();
    return p;
  }

  private finalStatus(p: Project) {
    const last = p.runs.at(-1);
    if (!last) return;
    p.status = last.passed ? "passing" : "failing";
    if (p.stage !== "failed") p.stage = "completed";
  }

  private userMessage(err: unknown): string {
    if (err instanceof SandboxUnavailableError) return `CreateOS sandbox unavailable: ${err.message}`;
    if (err instanceof ModelUnavailableError) return `AI model unavailable: ${err.message}`;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
  }

  private ensureModel() {
    const c = this.deps.model.configured();
    if (!c.ok) throw new ModelUnavailableError(c.reason);
  }

  private checkCancel(job: Job) {
    if (job.cancelled) throw new CancelledError("cancelled");
  }

  private async session(p: Project, job: Job): Promise<SandboxSession> {
    if (job.session) return job.session;
    // One shared sandbox for all projects, resumed here and paused on release.
    const shared = (await this.sharedSandboxId());
    let session: SandboxSession;
    try {
      session = await this.deps.sandbox.acquire(shared);
    } catch (err) {
      if (!(err instanceof SandboxQuotaError)) throw err;
      let freed = await this.reclaimStaleSandboxes(p.id);
      if (freed === 0 && this.deps.sandbox.reclaimOrphans) {
        const keep = [...this.jobs.values()].flatMap((j) => (j.session ? [j.session.id] : []));
        if (shared) keep.push(shared);
        freed = await this.deps.sandbox.reclaimOrphans(keep).catch(() => 0);
      }
      if (freed === 0) {
        throw new SandboxQuotaError(
          `${err.message} If this is the daily limit, wait for it to reset or ask a CreateOS operator to raise it; otherwise destroy running sandboxes in the CreateOS dashboard, then retry.`,
        );
      }
      this.event(p, "preparing_sandbox", "info", `Freed ${freed} stale DUALDEV sandbox${freed === 1 ? "" : "es"} to stay within the CreateOS limits.`);
      session = await this.deps.sandbox.acquire(shared);
    }
    job.session = session;
    if (session.id === shared) {
      this.event(p, "preparing_sandbox", "info", `Resumed shared ${this.deps.sandbox.name} ${session.id}.`);
    } else {
      this.event(p, "preparing_sandbox", "info", `Created shared ${this.deps.sandbox.name} ${session.id}.`);
      await this.deps.store.saveMeta("sandbox", { id: session.id, account: accountTag() });
    }
    p.sandboxId = session.id;
    await this.save(p);
    return session;
  }

  /** Pauses the shared sandbox after a job (frees the concurrency slot, keeps the daily quota), unless a preview is live. */
  private async releaseSession(p: Project, job: Job) {
    if (!job.session || p.preview) return;
    try {
      await this.deps.sandbox.park(job.session.id);
      this.event(p, null, "info", `Paused sandbox ${job.session.id}.`);
    } catch (err) {
      this.event(p, null, "warn", `Could not pause sandbox ${job.session.id}: ${this.userMessage(err)}`);
    }
  }

  private async discardSandbox(p: Project, sandboxId: string) {
    try {
      await this.deps.sandbox.destroy(sandboxId);
      this.event(p, null, "info", `Destroyed sandbox ${sandboxId}.`);
    } catch (err) {
      this.event(p, null, "warn", `Could not destroy sandbox ${sandboxId}: ${this.userMessage(err)}`);
    }
    if (p.sandboxId === sandboxId) p.sandboxId = undefined;
  }

  /** Destroys sandboxes DUALDEV recorded for other idle projects. Never touches sandboxes it did not create. */
  private async reclaimStaleSandboxes(exceptId: string): Promise<number> {
    let freed = 0;
    for (const other of await this.deps.store.list()) {
      const shared = (await this.sharedSandboxId());
      if (other.id === exceptId || !other.sandboxId || other.sandboxId === shared || other.preview || this.jobs.has(other.id)) continue;
      const fresh = await this.deps.store.get(other.id);
      if (!fresh?.sandboxId || fresh.busy) continue;
      await this.discardSandbox(fresh, fresh.sandboxId);
      await this.save(fresh);
      freed++;
    }
    return freed;
  }

  private async check(p: Project, job: Job, kind: Run["kind"], repairAttempt: number | null): Promise<Run> {
    this.checkCancel(job);
    this.setStage(p, kind === "verify" ? "verifying" : "preparing_sandbox", kind === "verify" ? "fixing" : "testing", "Preparing CreateOS sandbox.");
    await this.save(p);
    const session = await this.session(p, job);
    const run = await runChecks(session, p.files, { kind, repairAttempt }, async (stage, message) => {
      this.setStage(p, kind === "verify" ? "verifying" : stage, p.status, message);
      await this.save(p);
    });
    p.runs.push(run);
    p.verification.compiles = run.compiles;
    p.verification.appStarts = run.appStarts;
    const testExec = run.execs.find((e) => e.label === "tests");
    p.verification.unitTestsPass = testExec ? testExec.exitCode === 0 && !!run.tests && run.tests.total > 0 && run.tests.failed === 0 : null;

    const t = run.tests;
    const sync = run.execs.find((e) => e.label === "sync");
    if (sync && sync.exitCode !== 0) {
      this.event(p, "executing", "error", `File sync to sandbox failed: ${sync.error ?? sync.stderr}`);
    } else if (t) {
      const summary = `Test suite completed: ${t.passed} passed, ${t.failed} failed${t.skipped ? `, ${t.skipped} skipped` : ""}.`;
      this.event(p, "running_tests", t.failed === 0 && t.total > 0 ? "success" : "error", summary);
    }
    if (run.appStarts !== null) {
      this.event(p, "executing", run.appStarts ? "success" : "error", run.appStarts ? "server.js started and answered GET / with HTTP 200." : "server.js failed the startup check.");
    }
    for (const f of run.failures.slice(0, 5)) {
      this.event(p, "running_tests", "warn", `Detected ${f.category.replace(/_/g, " ")}${f.testName ? ` in "${f.testName}"` : ""}: ${f.message}`);
    }
    await this.save(p);
    return run;
  }

  private async repairLoop(p: Project, job: Job, baseline: Run) {
    this.ensureModel();
    const session: RepairSession = {
      id: `fx_${Date.now().toString(36)}`,
      startedAt: now(),
      originalFailures: baseline.failures,
      baselineRunId: baseline.id,
      attempts: [],
      outcome: "running",
    };
    p.repairs.push(session);
    const originallyFailing = new Set(baseline.tests?.cases.filter((c) => !c.ok).map((c) => c.name) ?? []);
    let current = baseline;

    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        this.checkCancel(job);
        this.setStage(p, "investigating", "fixing", `Attempt ${attempt}/${this.maxAttempts}: investigating ${current.failures.length} failure${current.failures.length === 1 ? "" : "s"} with real sandbox output.`);
        await this.save(p);

        const record: RepairAttempt = { attempt, startedAt: now(), summary: "", rootCause: "", changes: [], verified: null };
        session.attempts.push(record);
        let repair;
        try {
          repair = await proposeRepair(this.deps.model, {
            spec: p.spec,
            files: p.files,
            run: current,
            failures: current.failures,
            attempt,
            maxAttempts: this.maxAttempts,
            previousAttempts: session.attempts.slice(0, -1),
          });
        } catch (err) {
          if (err instanceof ModelUnavailableError) throw err;
          record.rejected = this.userMessage(err);
          record.verified = false;
          this.event(p, "investigating", "warn", `Repair proposal rejected: ${record.rejected}`);
          await this.save(p);
          continue;
        }
        this.checkCancel(job);

        record.summary = repair.summary;
        record.rootCause = repair.rootCause;
        record.changes = repair.changes;
        this.setStage(p, "applying_repair", "fixing", `Root cause (model hypothesis): ${repair.rootCause.slice(0, 240)}`);
        p.files = applyChanges(p.files, repair.changes);
        for (const c of repair.changes) {
          this.event(p, "applying_repair", "info", `${c.before === null ? "Added" : "Updated"} ${c.path}.`);
        }
        await this.save(p);

        const run = await this.check(p, job, "verify", attempt);
        record.verifyRunId = run.id;
        record.verified = run.passed;
        for (const name of originallyFailing) {
          const tc = run.tests?.cases.find((c) => c.name === name);
          this.event(p, "verifying", tc?.ok ? "success" : "error", `Reran failing test "${name}": ${tc ? (tc.ok ? "passed" : "still failing") : "not found in output"}.`);
        }
        await this.save(p);
        if (run.passed) {
          session.outcome = "verified";
          this.event(p, "completed", "success", `Fix verified by re-running the full suite in the sandbox (attempt ${attempt}).`);
          return;
        }
        current = run;
      }
      session.outcome = "unresolved";
      session.note = `Stopped after ${this.maxAttempts} attempts; failures remain.`;
      this.setStage(p, "failed", "failing", `Could not verify a fix within ${this.maxAttempts} attempts. Remaining failures are shown in the latest run.`, "error");
    } catch (err) {
      session.outcome = err instanceof CancelledError ? "cancelled" : "error";
      session.note = this.userMessage(err);
      throw err;
    } finally {
      session.finishedAt = now();
    }
  }

  private setStage(p: Project, stage: Stage, status: Project["status"], message: string, level: ActivityEvent["level"] = "info") {
    p.stage = stage;
    p.status = status;
    this.event(p, stage, level, message);
  }

  private event(p: Project, stage: Stage | null, level: ActivityEvent["level"], message: string) {
    p.events.push({ ts: now(), stage, level, message });
    if (p.events.length > 400) p.events.splice(0, p.events.length - 400);
  }

  private save(p: Project) {
    return this.deps.store.save(p);
  }
}
