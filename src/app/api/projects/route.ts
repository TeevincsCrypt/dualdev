import { after } from "next/server";
import { agent } from "@/lib/server";
import { handle, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return handle(async () => {
    const projects = await agent().list();
    return ok(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        spec: p.spec,
        origin: p.origin,
        status: p.status,
        stage: p.stage,
        busy: p.busy,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        fileCount: Object.keys(p.files).length,
        lastRun: p.runs.at(-1)
          ? { finishedAt: p.runs.at(-1)!.finishedAt, passed: p.runs.at(-1)!.passed, tests: p.runs.at(-1)!.tests && { passed: p.runs.at(-1)!.tests!.passed, failed: p.runs.at(-1)!.tests!.failed, total: p.runs.at(-1)!.tests!.total } }
          : null,
      })),
    );
  });
}

/** Body: { spec: string, autoFix?: boolean } to build, or { demo: true } for the fixture. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { spec?: unknown; demo?: unknown; autoFix?: unknown };
    const a = agent();
    if (body.demo === true) {
      const p = await a.createDemo();
      return ok({ id: p.id }, 201);
    }
    if (typeof body.spec !== "string") throw new Error("spec is required");
    const p = await a.createFromSpec(body.spec);
    await a.build(p.id, { autoFix: body.autoFix !== false });
    after(() => a.wait(p.id));
    return ok({ id: p.id }, 201);
  });
}
