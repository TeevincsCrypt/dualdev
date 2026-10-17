import { afterEach, describe, expect, it } from "vitest";
import { GroqProvider } from "@/lib/ai/groq";

type Call = { url: string; body: Record<string, unknown>; auth: string };

function fakeFetch(responses: { status: number; body: unknown }[], calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") ?? "" });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } });
const args = { system: "sys", user: "usr", schema: { type: "object" } };

describe("GroqProvider (HTTP client, mocked transport)", () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  it("reports missing key", async () => {
    const p = new GroqProvider(fakeFetch([], []));
    expect(p.configured().ok).toBe(false);
    await expect(p.generateJson(args)).rejects.toThrow(/GROQ_API_KEY/);
  });

  it("sends a strict json_schema request and returns content", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const calls: Call[] = [];
    const out = await new GroqProvider(fakeFetch([ok('{"a":1}')], calls)).generateJson(args);
    expect(out).toBe('{"a":1}');
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer gsk_test");
    expect(calls[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("falls back to json_object when the model rejects json_schema", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const calls: Call[] = [];
    const bad = { status: 400, body: { error: { message: "response_format json_schema is not supported by this model" } } };
    const out = await new GroqProvider(fakeFetch([bad, ok("{}")], calls)).generateJson(args);
    expect(out).toBe("{}");
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
  });

  it("surfaces truncation and auth errors", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const trunc = { status: 200, body: { choices: [{ message: { content: "{" }, finish_reason: "length" }] } };
    await expect(new GroqProvider(fakeFetch([trunc], [])).generateJson(args)).rejects.toThrow(/truncated/);
    await expect(new GroqProvider(fakeFetch([{ status: 401, body: {} }], [])).generateJson(args)).rejects.toThrow(/rejected the API key/);
  });
});
