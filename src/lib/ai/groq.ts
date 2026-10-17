import { proxyFetch } from "../net";
import { ModelUnavailableError, type ModelProvider } from "./provider";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type ChatResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  error?: { message?: string };
};

/**
 * Groq via its OpenAI-compatible Chat Completions API. Uses strict
 * json_schema structured output; if the chosen model rejects that, retries
 * once in json_object mode with the schema in the prompt. DUALDEV validates
 * every response with zod either way.
 */
export class GroqProvider implements ModelProvider {
  readonly name: string;
  readonly model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  #fetch: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.name = `Groq ${this.model}`;
    this.#fetch = fetchImpl ?? proxyFetch() ?? fetch;
  }

  configured() {
    if (!process.env.GROQ_API_KEY) return { ok: false as const, reason: "GROQ_API_KEY is not set on the server." };
    return { ok: true as const };
  }

  async generateJson({ system, user, schema, maxTokens = 32000 }: Parameters<ModelProvider["generateJson"]>[0]) {
    const c = this.configured();
    if (!c.ok) throw new ModelUnavailableError(c.reason);
    const strict = { type: "json_schema", json_schema: { name: "dualdev_output", strict: true, schema } };
    try {
      return await this.call(system, user, strict, maxTokens);
    } catch (err) {
      if (!(err instanceof ResponseFormatError)) throw err;
      const loose = { type: "json_object" };
      const prompt = `${user}\n\nRespond with a single JSON object that conforms to this JSON Schema:\n${JSON.stringify(schema)}`;
      return this.call(system, prompt, loose, maxTokens);
    }
  }

  private async call(system: string, user: string, responseFormat: object, maxTokens: number): Promise<string> {
    const res = await this.#fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
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
      if (res.status === 400 && /response_format|json_schema|structured/i.test(msg)) throw new ResponseFormatError(msg);
      if (res.status === 401 || res.status === 403) throw new ModelUnavailableError(`Groq rejected the API key (${res.status}).`);
      throw new Error(`Groq API error ${res.status}: ${msg.slice(0, 300)}`);
    }
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error("Model output was truncated (max tokens reached).");
    const text = choice?.message?.content ?? "";
    if (!text.trim()) throw new Error("Model returned no output.");
    return text;
  }
}

class ResponseFormatError extends Error {}
