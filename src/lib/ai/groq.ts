import { proxyFetch } from "../net";
import { ModelUnavailableError, type ModelProvider } from "./provider";

type ChatResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string; code?: string; failed_generation?: string };
};

export interface OpenAICompatibleConfig {
  label: string; // e.g. "Groq"
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  apiKeyEnv: string; // name of the env var holding the key
  model: string;
}

/**
 * Any OpenAI-compatible Chat Completions endpoint (Groq by default). Tries
 * strict json_schema output first; if the provider rejects that mode or its
 * own JSON validation fails, salvages the failed generation when it is valid
 * JSON, else retries once in json_object mode. DUALDEV still validates every
 * response with zod, so a salvaged or loose answer can never skip checks.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  readonly model: string;
  #fetch: typeof fetch;

  constructor(private readonly cfg: OpenAICompatibleConfig, fetchImpl?: typeof fetch) {
    this.model = cfg.model;
    this.name = `${cfg.label} ${cfg.model}`;
    this.#fetch = fetchImpl ?? proxyFetch() ?? fetch;
  }

  configured() {
    if (!process.env[this.cfg.apiKeyEnv]) return { ok: false as const, reason: `${this.cfg.apiKeyEnv} is not set on the server.` };
    return { ok: true as const };
  }

  async generateJson({ system, user, schema, maxTokens = 32000 }: Parameters<ModelProvider["generateJson"]>[0]) {
    const c = this.configured();
    if (!c.ok) throw new ModelUnavailableError(c.reason);
    const strict = { type: "json_schema", json_schema: { name: "dualdev_output", strict: true, schema } };
    try {
      return await this.call(system, user, strict, maxTokens);
    } catch (err) {
      if (!(err instanceof StructuredOutputError)) throw err;
      if (err.failedGeneration && isJson(err.failedGeneration)) return err.failedGeneration;
      const prompt = `${user}\n\nRespond with a single JSON object (no markdown fences) that conforms to this JSON Schema:\n${JSON.stringify(schema)}`;
      return this.call(system, prompt, { type: "json_object" }, maxTokens);
    }
  }

  private async call(system: string, user: string, responseFormat: object, maxTokens: number): Promise<string> {
    const res = await this.#fetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env[this.cfg.apiKeyEnv]}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: responseFormat,
        max_completion_tokens: maxTokens,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    const body = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && (body.error?.code === "json_validate_failed" || /response_format|json_schema|structured|generate JSON/i.test(msg))) {
        throw new StructuredOutputError(msg, body.error?.failed_generation);
      }
      if (res.status === 401 || res.status === 403) throw new ModelUnavailableError(`${this.cfg.label} rejected the API key (${res.status}).`);
      throw new Error(`${this.cfg.label} API error ${res.status}: ${msg.slice(0, 300)}`);
    }
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("Model output was truncated (max tokens reached).");
    const text = stripFences(choice?.message?.content ?? "");
    if (!text.trim()) throw new Error("Model returned no output.");
    return text;
  }
}

class StructuredOutputError extends Error {
  constructor(message: string, readonly failedGeneration?: string) {
    super(message);
  }
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

function stripFences(s: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(s);
  return m ? m[1] : s;
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(fetchImpl?: typeof fetch) {
    super({ label: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" }, fetchImpl);
  }
}
