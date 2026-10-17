// Plain-text file-block protocol. Models write code verbatim between markers
// instead of escaping whole files inside a JSON string, which is where
// smaller models most often produce invalid output.

export const BUILD_FORMAT = `OUTPUT FORMAT (mandatory). Do not use JSON or markdown fences. Write exactly these sections, in this order:
<<<NAME>>>
short-kebab-case-project-name
<<<PLAN>>>
a few bullet points describing what you built
<<<LIMITATIONS>>>
honest limitations
<<<FILE path/relative/to/project>>>
the complete, verbatim file content
<<<END>>>
(repeat the FILE ... END block for every file)`;

export const REPAIR_FORMAT = `OUTPUT FORMAT (mandatory). Do not use JSON or markdown fences. Write exactly these sections, in this order:
<<<SUMMARY>>>
one or two sentences describing the patch
<<<ROOT_CAUSE>>>
the most likely root cause, citing the error output
<<<FILE path/relative/to/project>>>
the complete, verbatim new content of the file
<<<END>>>
(one FILE ... END block per changed file; only files you change)`;

export interface ParsedBlocks {
  sections: Record<string, string>;
  files: { path: string; content: string }[];
}

// Tolerates common deviations: "<<<FILE: path>>>", "<<< file path >>>", bold/backtick wrapping.
const MARKER = /^[*`_\s]*<<<\s*([A-Za-z_]+)\s*:?\s*([^>\n]*?)\s*>>>[*`_\s]*$/;

export function parseBlocks(text: string): ParsedBlocks {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Record<string, string> = {};
  const files: { path: string; content: string }[] = [];
  let current: { kind: "section"; name: string; buf: string[] } | { kind: "file"; path: string; buf: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    if (current.kind === "file") files.push({ path: current.path.trim(), content: stripFence(current.buf.join("\n")) });
    else sections[current.name] = current.buf.join("\n").trim();
    current = null;
  };

  for (const line of lines) {
    const m = MARKER.exec(line.trim());
    if (m) {
      const tag = m[1].toUpperCase();
      const arg = m[2].replace(/^[`"']|[`"']$/g, "").trim();
      if (tag === "END") {
        flush();
        continue;
      }
      flush();
      current = tag === "FILE" && arg ? { kind: "file", path: arg, buf: [] } : { kind: "section", name: tag, buf: [] };
      continue;
    }
    current?.buf.push(line);
  }
  flush(); // tolerate a missing final <<<END>>>
  if (files.length === 0) files.push(...parseMarkdownFiles(text));
  return { sections, files };
}

/**
 * Fallback for models that ignore the markers and answer in markdown: a file
 * path (heading, bold, "File:" line, or fence info string) followed by a
 * fenced code block.
 */
export function parseMarkdownFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const PATH = /([A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.(?:html|css|js|mjs|json|md|svg|txt))/;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let pending: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```([^\n`]*)$/.exec(line);
    if (fence) {
      const info = fence[1];
      const path = PATH.exec(info)?.[1] ?? pending;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      i = j;
      if (path) out.push({ path, content: body.join("\n").replace(/\s+$/, "") + "\n" });
      pending = null;
      continue;
    }
    if (line.trim()) {
      const m = PATH.exec(line);
      pending = m && /^\s*(#{1,6}\s|\*\*|`|file\s*:|path\s*:|[-*]\s)/i.test(line) ? m[1] : null;
    }
  }
  return out;
}

function stripFence(s: string): string {
  const m = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(s);
  return (m ? m[1] : s).replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}

/** Last-resort extraction when the model ignored the format entirely. */
function salvageFiles(text: string): { path: string; content: string }[] {
  // 1. A JSON object with a files array.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { files?: { path?: unknown; content?: unknown }[] };
      const files = (obj.files ?? []).filter((f) => typeof f.path === "string" && typeof f.content === "string") as { path: string; content: string }[];
      if (files.length) return files;
    } catch {
      /* not JSON */
    }
  }
  // 2. Fenced blocks identified only by language.
  const byLang: Record<string, string> = { html: "public/index.html", css: "public/styles.css", js: "src/app.js", javascript: "src/app.js" };
  const out: { path: string; content: string }[] = [];
  for (const m of text.matchAll(/```(html|css|js|javascript)[^\n]*\n([\s\S]*?)\n```/gi)) {
    const path = byLang[m[1].toLowerCase()];
    if (!out.some((f) => f.path === path)) out.push({ path, content: m[2] + "\n" });
  }
  if (out.length) return out;
  // 3. A bare HTML document.
  const doc = /<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>/i.exec(text);
  return doc ? [{ path: "public/index.html", content: doc[0] + "\n" }] : [];
}

/** Converts build blocks to the JSON shape BuildOutput validates. */
export function buildBlocksToJson(text: string): string {
  const parsed = parseBlocks(text);
  const sections = parsed.sections;
  const files = parsed.files.length ? parsed.files : salvageFiles(text);
  return JSON.stringify({ name: sections.NAME ?? "", plan: sections.PLAN ?? "", limitations: sections.LIMITATIONS ?? "", files });
}

/** Converts repair blocks to the JSON shape RepairOutput validates. */
export function repairBlocksToJson(text: string): string {
  const { sections, files } = parseBlocks(text);
  return JSON.stringify({ summary: sections.SUMMARY ?? "", rootCause: sections.ROOT_CAUSE ?? "", filesChanged: files, testsToRun: [] });
}
