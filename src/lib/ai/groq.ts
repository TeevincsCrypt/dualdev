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
  fallbackModels?: string[]; // tried in order when the model is rate-limited
  tpmLimit?: number; // tokens-per-minute cap per request (input + reserved output)
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

  async generateText({ system, user, maxTokens = 32000 }: { system: string; user: string; maxTokens?: number }) {
    const c = this.configured();
    if (!c.ok) throw new ModelUnavailableError(c.reason);
    return this.call(system, user, null, maxTokens);
  }

  #available: Promise<string[] | null> | null = null;

  /** Model ids this API key can use (GET /models), or null if the list is unavailable. Cached. */
  private availableModels(): Promise<string[] | null> {
    this.#available ??= this.#fetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { authorization: `Bearer ${process.env[this.cfg.apiKeyEnv]}` },
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (r) => (r.ok ? ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? null : null))
      .catch(() => null);
    return this.#available;
  }

  /** Fallback order: configured fallbacks this key can use, then other chat models it can use. */
  private async fallbacks(): Promise<string[]> {
    const configured = (this.cfg.fallbackModels ?? []).filter((m) => m && m !== this.model);
    const available = await this.availableModels();
    if (!available) return configured;
    const chat = available.filter((id) => /gpt-oss|llama|qwen|kimi|gemma|mistral|deepseek/i.test(id) && !/whisper|guard|tts|playai|distil|compound|vision/i.test(id));
    const ordered = [...configured.filter((m) => available.includes(m)), ...chat];
    return [...new Set(ordered)].filter((m) => m !== this.model).slice(0, 4);
  }

  private async call(system: string, user: string, responseFormat: object | null, maxTokens: number): Promise<string> {
    let lastErr: unknown;
    const tried: string[] = [];
    let queue: string[] = [this.model];
    let expanded = false;
    while (queue.length) {
      const model = queue.shift()!;
      tried.push(model);
      try {
        return await this.callModel(model, system, user, responseFormat, maxTokens);
      } catch (err) {
        if (!(err instanceof RateLimitError)) throw err;
        lastErr = err;
        if (!expanded) {
          expanded = true;
          queue = (await this.fallbacks()).filter((m) => !tried.includes(m));
        }
      }
    }
    throw new Error(`${(lastErr as Error).message} (tried: ${tried.join(", ")})`);
  }

  /**
   * Groq counts input + reserved output against the per-minute token limit, so
   * reserve only what fits under `tpmLimit` (if configured).
   */
  private outputBudget(system: string, user: string, requested: number): number {
    if (!this.cfg.tpmLimit) return requested;
    const inputEstimate = Math.ceil((system.length + user.length) / 3.2) + 200;
    return Math.max(1024, Math.min(requested, this.cfg.tpmLimit - inputEstimate));
  }

  private async callModel(model: string, system: string, user: string, responseFormat: object | null, requestedTokens: number): Promise<string> {
    const maxTokens = this.outputBudget(system, user, requestedTokens);
    const res = await this.#fetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env[this.cfg.apiKeyEnv]}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(responseFormat ? { response_format: responseFormat } : {}),
        max_completion_tokens: maxTokens,
        // gpt-oss reasons before answering and that counts against the output
        // budget; keep it short so the budget goes to the actual files.
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
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
      if (res.status === 404 && /model/i.test(msg)) throw new RateLimitError(`${this.cfg.label} model ${model} is not available to this key.`);
      if (res.status === 429 || res.status === 413) throw new RateLimitError(`${this.cfg.label} rate limit for ${model}: ${msg.slice(0, 300)}`);
      throw new Error(`${this.cfg.label} API error ${res.status}: ${msg.slice(0, 300)}`);
    }
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new RateLimitError(`Output from ${model} was truncated at ${maxTokens} tokens.`);
    const text = stripFences(choice?.message?.content ?? "");
    if (!text.trim()) throw new Error("Model returned no output.");
    return text;
  }
}

/** Limits on one model (rate, request size, output length): worth retrying on the next model. */
class RateLimitError extends Error {}

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
    super(
      {
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnv: "GROQ_API_KEY",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        tpmLimit: Number(process.env.GROQ_TPM_LIMIT || 8000),
        fallbackModels: (process.env.GROQ_FALLBACK_MODELS ?? "openai/gpt-oss-20b").split(",").map((m) => m.trim()),
      },
      fetchImpl,
    );
  }
}
