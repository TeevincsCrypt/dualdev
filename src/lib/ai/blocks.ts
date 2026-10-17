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

const MARKER = /^<<<([A-Z_]+)(?:[ \t]+([^>\n]+?))?>>>[ \t]*$/;

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
      const [, tag, arg] = m;
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
  return { sections, files };
}

function stripFence(s: string): string {
  const m = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(s);
  return (m ? m[1] : s).replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
}

/** Converts build blocks to the JSON shape BuildOutput validates. */
export function buildBlocksToJson(text: string): string {
  const { sections, files } = parseBlocks(text);
  return JSON.stringify({ name: sections.NAME ?? "", plan: sections.PLAN ?? "", limitations: sections.LIMITATIONS ?? "", files });
}

/** Converts repair blocks to the JSON shape RepairOutput validates. */
export function repairBlocksToJson(text: string): string {
  const { sections, files } = parseBlocks(text);
  return JSON.stringify({ summary: sections.SUMMARY ?? "", rootCause: sections.ROOT_CAUSE ?? "", filesChanged: files, testsToRun: [] });
}
