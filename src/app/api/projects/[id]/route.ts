import { agent } from "@/lib/server";
import { handle, ok, projectId } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = projectId((await params).id);
    const p = await agent().get(id);
    const { originalFiles: _o, ...rest } = p;
    return ok({ ...rest, hasOriginal: Boolean(p.originalFiles) });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await agent().remove(projectId((await params).id));
    return ok({ deleted: true });
  });
}
