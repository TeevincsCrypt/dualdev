import { z } from "zod";

const file = z.object({ path: z.string(), content: z.string() });

export const BuildOutput = z.object({
  name: z.string().max(200),
  plan: z.string().max(8000),
  files: z.array(file).max(60),
  limitations: z.string().max(4000),
});
export type BuildOutput = z.infer<typeof BuildOutput>;

export const RepairOutput = z.object({
  summary: z.string().min(1).max(2000),
  rootCause: z.string().min(1).max(4000),
  filesChanged: z.array(file).min(1).max(10),
  testsToRun: z.array(z.string()).max(10),
});
export type RepairOutput = z.infer<typeof RepairOutput>;

// JSON Schemas for the API's structured-output mode (mirrors the zod schemas,
// which remain the source of truth for validation).
const fileJson = {
  type: "object",
  properties: { path: { type: "string" }, content: { type: "string" } },
  required: ["path", "content"],
  additionalProperties: false,
};

export const BuildJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    plan: { type: "string" },
    files: { type: "array", items: fileJson },
    limitations: { type: "string" },
  },
  required: ["name", "plan", "files", "limitations"],
  additionalProperties: false,
};

export const RepairJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    rootCause: { type: "string" },
    filesChanged: { type: "array", items: fileJson },
    testsToRun: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "rootCause", "filesChanged", "testsToRun"],
  additionalProperties: false,
};
