import Anthropic from "@anthropic-ai/sdk";

export interface ModelProvider {
  readonly name: string;
  configured(): { ok: true } | { ok: false; reason: string };
  /** Returns the raw JSON text produced under the given schema. */
  generateJson(args: { system: string; user: string; schema: Record<string, unknown>; maxTokens?: number }): Promise<string>;
}

export class ModelUnavailableError extends Error {}

export class AnthropicProvider implements ModelProvider {
  readonly name: string;
  #client: Anthropic | null = null;
  readonly model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

  constructor() {
    this.name = `Anthropic ${this.model}`;
  }

  configured() {
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false as const, reason: "ANTHROPIC_API_KEY is not set on the server." };
    return { ok: true as const };
  }

  private client(): Anthropic {
    const c = this.configured();
    if (!c.ok) throw new ModelUnavailableError(c.reason);
    // Pin the base URL so an unrelated ANTHROPIC_BASE_URL in the host env
    // (e.g. a dev-tool proxy) never receives this key.
    this.#client ??= new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.DUALDEV_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
      timeout: 10 * 60 * 1000,
    });
    return this.#client;
  }

  async generateJson({ system, user, schema, maxTokens = 32000 }: Parameters<ModelProvider["generateJson"]>[0]) {
    const client = this.client();
    const effort = (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high" | undefined) || "medium";
    const useFallbacks = process.env.DUALDEV_DISABLE_FALLBACKS !== "1";
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user" as const, content: user }],
      output_config: { effort, format: { type: "json_schema", schema } },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    };
    // Streaming keeps long generations clear of HTTP timeouts.
    const stream = client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0]);
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (message.stop_reason === "max_tokens") throw new Error("Model output was truncated (max_tokens reached).");
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) throw new Error("Model returned no text output.");
    return text;
  }
}
