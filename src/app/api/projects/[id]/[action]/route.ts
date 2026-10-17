import { agent } from "@/lib/server";
import { fail, handle, ok, projectId } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Each action starts a background job (202) or performs a quick state change.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id: raw, action } = await params;
    const id = projectId(raw);
    const a = agent();
    switch (action) {
      case "build": {
        const body = (await req.json().catch(() => ({}))) as { autoFix?: unknown };
        await a.build(id, { autoFix: body.autoFix !== false });
        return ok({ started: action }, 202);
      }
      case "test":
        await a.test(id);
        return ok({ started: action }, 202);
      case "fix":
        await a.fix(id);
        return ok({ started: action }, 202);
      case "demo":
        await a.demo(id);
        return ok({ started: action }, 202);
      case "preview":
        await a.preview(id);
        return ok({ started: action }, 202);
      case "preview-stop":
        await a.stopPreview(id);
        return ok({ started: action }, 202);
      case "reset":
        await a.reset(id);
        return ok({ reset: true });
      case "cancel":
        return ok({ cancelling: await a.cancel(id) });
      default:
        return fail(404, "Unknown action");
    }
  });
}
