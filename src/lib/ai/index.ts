import { GroqProvider, OpenAICompatibleProvider } from "./groq";
import { AnthropicProvider, type ModelProvider } from "./provider";

/**
 * DUALDEV_MODEL_PROVIDER = groq | anthropic | openai-compatible.
 * Without it: Groq if GROQ_API_KEY is set, else Anthropic if ANTHROPIC_API_KEY is set, else Groq.
 * openai-compatible uses LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (any Chat Completions endpoint).
 */
export function createModelProvider(): ModelProvider {
  const choice = (process.env.DUALDEV_MODEL_PROVIDER || "").toLowerCase();
  if (choice === "anthropic") return new AnthropicProvider();
  if (choice === "openai-compatible") {
    return new OpenAICompatibleProvider({
      label: process.env.LLM_LABEL || "LLM",
      baseUrl: process.env.LLM_BASE_URL || "",
      apiKeyEnv: "LLM_API_KEY",
      model: process.env.LLM_MODEL || "",
    });
  }
  if (choice === "groq" || process.env.GROQ_API_KEY || !process.env.ANTHROPIC_API_KEY) return new GroqProvider();
  return new AnthropicProvider();
}
