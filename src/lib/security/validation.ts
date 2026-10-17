import path from "node:path";

export const LIMITS = {
  maxFiles: 40,
  maxFileBytes: 200_000,
  maxTotalBytes: 800_000,
  maxPathLength: 160,
  maxSpecLength: 4_000,
  maxRepairAttempts: 3,
  logBytes: 20_000,
} as const;

const PROJECT_ID = /^p_[a-f0-9]{12}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const ALLOWED_EXT = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".txt", ".svg"]);

export function isValidProjectId(id: unknown): id is string {
  return typeof id === "string" && PROJECT_ID.test(id);
}

/**
 * Validates a project-relative path coming from a model or the browser and
 * returns its normalised form. Rejects anything that could escape the project
 * root: absolute paths, `..`, backslashes, dotfiles (e.g. `.env`), odd chars.
 */
export function validateRelativePath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) throw new Error("Path must be a non-empty string");
  if (input.length > LIMITS.maxPathLength) throw new Error("Path too long");
  if (input.includes("\\") || input.includes("\0")) throw new Error(`Illegal character in path: ${input}`);
  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) throw new Error(`Absolute paths are not allowed: ${input}`);
  const normalised = path.posix.normalize(input);
  if (normalised !== input.replace(/^\.\//, "")) throw new Error(`Path must be normalised: ${input}`);
  const segments = normalised.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === ".") throw new Error(`Path traversal is not allowed: ${input}`);
    if (!SAFE_SEGMENT.test(seg)) throw new Error(`Illegal path segment "${seg}" in ${input}`);
  }
  if (segments[0] === "node_modules") throw new Error("node_modules is not writable");
  const ext = path.posix.extname(normalised);
  if (!ALLOWED_EXT.has(ext)) throw new Error(`File type not allowed: ${input}`);
  return normalised;
}

export function validateFileSet(files: Record<string, string>): void {
  const entries = Object.entries(files);
  if (entries.length === 0) throw new Error("No files");
  if (entries.length > LIMITS.maxFiles) throw new Error(`Too many files (${entries.length} > ${LIMITS.maxFiles})`);
  let total = 0;
  for (const [p, content] of entries) {
    validateRelativePath(p);
    if (typeof content !== "string") throw new Error(`File content must be a string: ${p}`);
    const bytes = Buffer.byteLength(content);
    if (bytes > LIMITS.maxFileBytes) throw new Error(`File too large: ${p}`);
    total += bytes;
  }
  if (total > LIMITS.maxTotalBytes) throw new Error("Project too large");
}

export function truncate(text: string, max: number = LIMITS.logBytes): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n… [${text.length - max} characters truncated] …\n${text.slice(-tail)}`;
}

const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/g, /sk_(live|test)_[A-Za-z0-9]{10,}/g, /Bearer\s+[A-Za-z0-9._-]{16,}/g];

/** Defence in depth: scrub anything shaped like a credential from logs. */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  for (const key of ["CREATEOS_SANDBOX_API_KEY", "ANTHROPIC_API_KEY"]) {
    const v = process.env[key];
    if (v && v.length >= 8) out = out.split(v).join("[redacted]");
  }
  return out;
}
