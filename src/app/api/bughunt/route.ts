import { createModelProvider } from "@/lib/ai";
import { handle, ok } from "@/lib/http";
import { scanUrl } from "@/lib/bughunt/url-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Body: { url: string }. Fetches the page and reports findings (static analysis, nothing executed). */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) throw new Error("url is required");
    return ok(await scanUrl(body.url, createModelProvider()));
  });
}
