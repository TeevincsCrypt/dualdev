export type Stage =
  | "understanding"
  | "generating"
  | "preparing_sandbox"
  | "executing"
  | "running_tests"
  | "investigating"
  | "applying_repair"
  | "verifying"
  | "completed"
  | "failed";

export type ProjectStatus =
  | "draft"
  | "building"
  | "testing"
  | "fixing"
  | "passing"
  | "failing"
  | "error"
  | "cancelled";

export type FailureCategory =
  | "syntax_error"
  | "import_resolution"
  | "missing_dependency"
  | "runtime_exception"
  | "failing_test"
  | "startup_failure"
  | "timeout"
  | "configuration_error"
  | "unknown";

export interface ExecRecord {
  label: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

export interface TestCase {
  name: string;
  ok: boolean;
  skipped: boolean;
  durationMs?: number;
  location?: string;
  error?: string;
  expected?: string;
  actual?: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: TestCase[];
  parsed: boolean;
}

export interface Failure {
  category: FailureCategory;
  message: string;
  testName?: string;
  location?: string;
}

/** Each success state is tracked separately; `null` means "not checked". */
export interface Verification {
  codeGenerated: boolean;
  compiles: boolean | null;
  appStarts: boolean | null;
  unitTestsPass: boolean | null;
  behaviourVerified: null; // no browser E2E harness yet; never inferred
  previewAvailable: boolean;
}

export interface Run {
  id: string;
  kind: "baseline" | "check" | "verify";
  repairAttempt: number | null;
  startedAt: string;
  finishedAt: string;
  sandboxId: string;
  nodeVersion?: string;
  execs: ExecRecord[];
  tests: TestSummary | null;
  compiles: boolean | null;
  appStarts: boolean | null;
  failures: Failure[];
  passed: boolean;
}

export interface FileChange {
  path: string;
  before: string | null; // null = added
  after: string;
}

export interface RepairAttempt {
  attempt: number;
  startedAt: string;
  summary: string;
  rootCause: string;
  changes: FileChange[];
  rejected?: string;
  verifyRunId?: string;
  verified: boolean | null;
}

export interface RepairSession {
  id: string;
  startedAt: string;
  finishedAt?: string;
  originalFailures: Failure[];
  baselineRunId: string;
  attempts: RepairAttempt[];
  outcome: "running" | "verified" | "unresolved" | "error" | "cancelled";
  note?: string;
}

export interface ActivityEvent {
  ts: string;
  stage: Stage | null;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

export interface Project {
  id: string;
  name: string;
  spec: string;
  origin: "generated" | "fixture";
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  stage: Stage | null;
  busy: boolean;
  job?: { kind: "build" | "test" | "fix" | "demo" | "preview"; startedAt: string };
  plan?: string;
  limitations?: string;
  files: Record<string, string>;
  originalFiles?: Record<string, string>;
  events: ActivityEvent[];
  runs: Run[];
  repairs: RepairSession[];
  verification: Verification;
  sandboxId?: string;
  preview?: { url: string; startedAt: string };
  lastError?: string;
}
