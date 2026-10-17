import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { validateBuildOutput } from "@/lib/agent/builder";
import { validateRepair } from "@/lib/agent/bug-hunter";
import { Agent, ConflictError } from "@/lib/agent/orchestrator";
import { ProjectStore } from "@/lib/projects/store";
import { LocalTestSandbox, ScriptedModel, tempDir } from "./helpers";

const fixtureDir = path.resolve(import.meta.dirname, "../fixtures/task-manager");
const buggy = readFileSync(path.join(fixtureDir, "src/tasks.js"), "utf8");
const fixed = buggy.replace(
  "  task.completed = !task.completed;\n  return task;",
  "  task.completed = !task.completed;\n  if (task.completed) { store.stats.pending -= 1; store.stats.completed += 1; }\n  else { store.stats.pending += 1; store.stats.completed -= 1; }\n  return task;",
);
const repair = (content: string, p = "src/tasks.js") =>
  JSON.stringify({ summary: "Update counters on toggle", rootCause: "toggleTask never updates stats", filesChanged: [{ path: p, content }], testsToRun: [] });

async function setup(responses: string[]) {
  const dir = await tempDir();
  const model = new ScriptedModel(responses);
  const agent = new Agent({ store: new ProjectStore(path.join(dir, "data")), sandbox: new LocalTestSandbox(path.join(dir, "sb")), model, fixtureDir });
  return { agent, model };
}

describe("Build → Break → Fix → Verify (pipeline, test doubles)", () => {
  beforeEach(() => expect(fixed).not.toBe(buggy));

  it("detects the real failing test, applies the repair, and verifies by re-running", async () => {
    const { agent, model } = await setup([repair(fixed)]);
    const p = await agent.createDemo();
    await agent.demo(p.id);
    await agent.wait(p.id);
    const done = await agent.get(p.id);

    expect(done.runs).toHaveLength(2);
    const [baseline, verify] = done.runs;
    expect(baseline.passed).toBe(false);
    expect(baseline.tests).toMatchObject({ total: 6, passed: 5, failed: 1 });
    expect(baseline.failures[0].testName).toMatch(/pending counter to the completed counter/);
    expect(verify.kind).toBe("verify");
    expect(verify.passed).toBe(true);
    expect(verify.tests).toMatchObject({ total: 6, passed: 6, failed: 0 });
    expect(verify.appStarts).toBe(true);
    expect(done.repairs[0].outcome).toBe("verified");
    expect(done.repairs[0].attempts[0].changes[0].path).toBe("src/tasks.js");
    expect(done.status).toBe("passing");
    // The model saw the real assertion output and the faulty source.
    expect(model.calls[0].user).toContain("Expected values to be strictly deep-equal");
    expect(model.calls[0].user).toContain('<file path="src/tasks.js">');
  }, 60_000);

  it("stops after the attempt limit and reports unresolved honestly", async () => {
    const wrong = buggy.replace("return task;\n}\n\nexport function removeTask", "return { ...task };\n}\n\nexport function removeTask");
    const { agent } = await setup([repair(wrong), repair(wrong + "\n"), repair(wrong + "\n\n"), repair(fixed)]);
    const p = await agent.createDemo();
    await agent.demo(p.id);
    await agent.wait(p.id);
    const done = await agent.get(p.id);
    expect(done.repairs[0].outcome).toBe("unresolved");
    expect(done.repairs[0].attempts).toHaveLength(3);
    expect(done.runs.every((r) => !r.passed)).toBe(true);
    expect(done.status).toBe("failing");
  }, 90_000);

  it("rejects a repair that edits an existing test, without applying it", async () => {
    const { agent } = await setup([repair("// gutted", "test/tasks.test.js"), repair(fixed)]);
    const p = await agent.createDemo();
    await agent.demo(p.id);
    await agent.wait(p.id);
    const done = await agent.get(p.id);
    expect(done.repairs[0].attempts[0].rejected).toMatch(/existing test/);
    expect(done.files["test/tasks.test.js"]).not.toBe("// gutted");
    expect(done.repairs[0].outcome).toBe("verified");
  }, 60_000);

  it("refuses concurrent jobs on the same project", async () => {
    const { agent } = await setup([repair(fixed)]);
    const p = await agent.createDemo();
    await agent.test(p.id);
    await expect(agent.fix(p.id)).rejects.toBeInstanceOf(ConflictError);
    await agent.wait(p.id);
  }, 60_000);

  it("reset restores the fixture defect", async () => {
    const { agent } = await setup([repair(fixed)]);
    const p = await agent.createDemo();
    await agent.demo(p.id);
    await agent.wait(p.id);
    const reset = await agent.reset(p.id);
    expect(reset.files["src/tasks.js"]).toBe(buggy);
    expect(reset.runs).toHaveLength(0);
  }, 60_000);
});

describe("model output validation", () => {
  const files = { "package.json": '{"type":"module"}', "server.js": "", "public/index.html": "", "test/a.test.js": "", "src/a.js": "" };
  const build = (f: Record<string, string>) =>
    JSON.stringify({ name: "x", plan: "p", limitations: "l", files: Object.entries(f).map(([path, content]) => ({ path, content })) });

  it("accepts a valid build", () => {
    expect(Object.keys(validateBuildOutput(build(files)).files)).toHaveLength(5);
  });
  it("rejects traversal, dependencies, missing tests and malformed JSON", () => {
    expect(() => validateBuildOutput(build({ ...files, "../x.js": "" }))).toThrow(/traversal|normalised/);
    expect(() => validateBuildOutput(build({ ...files, "package.json": '{"type":"module","dependencies":{"react":"1"}}' }))).toThrow(/zero-dependency/);
    const { ["test/a.test.js"]: _omit, ...noTests } = files;
    expect(() => validateBuildOutput(build(noTests))).toThrow(/No test files/);
    expect(() => validateBuildOutput("{not json")).toThrow(/valid JSON/);
  });
  it("rejects repairs creating non-test files or making no change", () => {
    expect(() => validateRepair(repair("x", "src/new.js"), files)).toThrow(/non-test file/);
    expect(() => validateRepair(repair("", "src/a.js"), files)).toThrow(/no effective changes/);
    expect(validateRepair(repair("y", "src/a.js"), files).changes).toHaveLength(1);
  });
});

describe("sandbox failures", () => {
  it("records a failed file sync as a failed run instead of crashing", async () => {
    const dir = await tempDir();
    const sandbox = new LocalTestSandbox(path.join(dir, "sb"));
    const original = sandbox.acquire.bind(sandbox);
    sandbox.acquire = async (id?: string) => {
      const s = await original(id);
      s.sync = async () => ({ label: "sync", command: "upload", exitCode: null, stdout: "", stderr: "", durationMs: 1, timedOut: false, error: "Upload failed: CreateosSandboxValidationError: bad path" });
      return s;
    };
    const agent = new Agent({ store: new ProjectStore(path.join(dir, "data")), sandbox, model: new ScriptedModel([]), fixtureDir });
    const p = await agent.createDemo();
    await agent.test(p.id);
    await agent.wait(p.id);
    const done = await agent.get(p.id);
    expect(done.lastError).toBeUndefined();
    expect(done.status).toBe("failing");
    expect(done.runs[0].passed).toBe(false);
    expect(done.runs[0].failures[0].message).toMatch(/Upload failed/);
    expect(done.events.some((e) => /File sync to sandbox failed: Upload failed/.test(e.message))).toBe(true);
  });
});
