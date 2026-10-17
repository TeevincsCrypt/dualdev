import { randomBytes } from "node:crypto";
import type { SandboxSession } from "../sandbox/types";
import { collectFailures, parseTap, TEST_SCRIPT } from "../tests/runner";
import type { ExecRecord, Run } from "../types";

export const COMPILE_SCRIPT =
  "fail=0; for f in $(find . -name '*.js' -not -path './node_modules/*' | sort); do " +
  'node --check "$f" || { echo "compile failed: $f" >&2; fail=1; }; done; exit $fail';

export const SMOKE_PORT = 4173;
export const STARTUP_SCRIPT =
  `PORT=${SMOKE_PORT} node server.js >/tmp/startup.log 2>&1 & pid=$!; ok=1; ` +
  `for i in $(seq 1 30); do ` +
  `if node -e "fetch('http://127.0.0.1:${SMOKE_PORT}/').then(r=>{console.log('GET / -> '+r.status);process.exit(r.status===200?0:2)}).catch(()=>process.exit(1))"; then ok=0; break; fi; ` +
  `kill -0 $pid 2>/dev/null || break; sleep 0.3; done; ` +
  `kill $pid 2>/dev/null; cat /tmp/startup.log; ` +
  `[ $ok -ne 0 ] && echo "server.js did not answer GET / with HTTP 200" >&2; exit $ok`;

export type CheckStage = "executing" | "running_tests";

/** Syncs files into the sandbox and runs the approved checks. All results are real exec output. */
export async function runChecks(
  session: SandboxSession,
  files: Record<string, string>,
  meta: { kind: Run["kind"]; repairAttempt: number | null },
  onStage: (stage: CheckStage, message: string) => Promise<void>,
): Promise<Run> {
  const startedAt = new Date().toISOString();
  const execs: ExecRecord[] = [];

  await onStage("executing", `Uploading ${Object.keys(files).length} files to sandbox ${session.id}.`);
  const sync = await session.sync(files);
  execs.push(sync);
  if (sync.exitCode !== 0) return finish();

  const version = await session.exec("env", "node --version", 15);
  execs.push(version);
  const compile = await session.exec("compile", COMPILE_SCRIPT, 60);
  execs.push(compile);
  await onStage("executing", compile.exitCode === 0 ? "Syntax check passed for all .js files." : "Syntax check failed.");

  await onStage("running_tests", "Running test suite: node --test.");
  execs.push(await session.exec("tests", TEST_SCRIPT, 120));

  if ("server.js" in files) {
    await onStage("executing", "Starting server.js for a startup smoke check.");
    execs.push(await session.exec("startup", STARTUP_SCRIPT, 40));
  }
  return finish();

  function finish(): Run {
    const testExec = execs.find((e) => e.label === "tests");
    const tests = testExec ? parseTap(testExec.stdout) : null;
    const compileExec = execs.find((e) => e.label === "compile");
    const startup = execs.find((e) => e.label === "startup");
    const compiles = compileExec ? compileExec.exitCode === 0 : null;
    const appStarts = startup ? startup.exitCode === 0 : null;
    const failures = collectFailures(execs, tests);
    const testsOk = !!testExec && testExec.exitCode === 0 && !!tests && tests.failed === 0 && tests.total > 0;
    return {
      id: `r_${randomBytes(5).toString("hex")}`,
      kind: meta.kind,
      repairAttempt: meta.repairAttempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      sandboxId: session.id,
      nodeVersion: version.exitCode === 0 ? version.stdout.trim() : undefined,
      execs,
      tests,
      compiles,
      appStarts,
      failures,
      passed: compiles === true && testsOk && appStarts !== false,
    };
  }
}
