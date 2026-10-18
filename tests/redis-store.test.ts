import { describe, expect, it } from "vitest";
import { RedisStore } from "@/lib/projects/redis-store";
import type { Project } from "@/lib/types";

/** Minimal in-memory stand-in for the Upstash REST API (GET/SET/DEL/MGET/SADD/SREM/SMEMBERS). */
function fakeUpstash() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const [cmd, ...a] = JSON.parse(String(init.body)) as string[];
    const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
    const handlers: Record<string, () => unknown> = {
      GET: () => kv.get(a[0]) ?? null,
      SET: () => (kv.set(a[0], a[1]), "OK"),
      DEL: () => Number(kv.delete(a[0])),
      MGET: () => a.map((k) => kv.get(k) ?? null),
      SADD: () => (set(a[0]).add(a[1]), 1),
      SREM: () => Number(set(a[0]).delete(a[1])),
      SMEMBERS: () => [...set(a[0])],
    };
    const result = handlers[cmd]?.();
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, kv };
}

const project = (id: string): Project => ({
  id, name: id, spec: "s", origin: "generated", createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "draft", stage: null,
  busy: false, files: { "public/index.html": "<h1>x</h1>" }, events: [], runs: [], repairs: [],
  verification: { codeGenerated: true, compiles: null, appStarts: null, unitTestsPass: null, behaviourVerified: null, previewAvailable: false },
});

describe("RedisStore (Upstash REST)", () => {
  it("saves, lists, reads and deletes projects shared across instances", async () => {
    const { fetchImpl } = fakeUpstash();
    const a = new RedisStore("https://redis.test", "tok", fetchImpl);
    const b = new RedisStore("https://redis.test", "tok", fetchImpl); // another server instance
    await a.save(project("p_aaaaaaaaaaaa"));
    await a.save(project("p_bbbbbbbbbbbb"));
    expect((await b.get("p_aaaaaaaaaaaa"))?.files["public/index.html"]).toBe("<h1>x</h1>");
    expect((await b.list()).map((p) => p.id).sort()).toEqual(["p_aaaaaaaaaaaa", "p_bbbbbbbbbbbb"]);
    await b.delete("p_aaaaaaaaaaaa");
    expect(await a.get("p_aaaaaaaaaaaa")).toBeNull();
    await a.saveMeta("sandbox", { id: "sb_1" });
    expect(await b.getMeta("sandbox")).toEqual({ id: "sb_1" });
  });
  it("rejects invalid ids", async () => {
    const { fetchImpl } = fakeUpstash();
    await expect(new RedisStore("https://redis.test", "tok", fetchImpl).get("../etc")).rejects.toThrow(/Invalid/);
  });
});
