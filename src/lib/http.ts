import "server-only";
import { NextResponse } from "next/server";
import { ConflictError, NotFoundError } from "./agent/orchestrator";
import { isValidProjectId } from "./security/validation";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) return fail(404, err.message);
    if (err instanceof ConflictError) return fail(409, err.message);
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[dualdev] request failed:", err);
    return fail(400, message.slice(0, 400));
  }
}

export function projectId(raw: string): string {
  if (!isValidProjectId(raw)) throw new NotFoundError("Project not found");
  return raw;
}
