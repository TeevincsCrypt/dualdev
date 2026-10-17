import { GroqProvider } from "./groq";
import { AnthropicProvider, type ModelProvider } from "./provider";

/** DUALDEV_MODEL_PROVIDER=groq|anthropic; otherwise Groq if GROQ_API_KEY is set, else Anthropic. */
export function createModelProvider(): ModelProvider {
  const choice = (process.env.DUALDEV_MODEL_PROVIDER || "").toLowerCase();
  if (choice === "anthropic") return new AnthropicProvider();
  if (choice === "groq" || process.env.GROQ_API_KEY || !process.env.ANTHROPIC_API_KEY) return new GroqProvider();
  return new AnthropicProvider();
}
