// Builds a self-contained HTML document from a project's files so a static
// front end can be previewed instantly in a sandboxed iframe (srcdoc), with
// no server. Stylesheets are inlined; scripts become data: URLs with their
// relative imports rewritten to data: URLs too.

const ENTRY_CANDIDATES = ["public/index.html", "index.html"];

export function findEntry(files: Record<string, string>): string | null {
  return ENTRY_CANDIDATES.find((p) => p in files) ?? Object.keys(files).find((p) => p.endsWith(".html")) ?? null;
}

function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Resolves a URL used in `fromFile` to a project path, or null for external URLs. */
export function resolveRef(ref: string, fromFile: string, files: Record<string, string>): string | null {
  if (/^([a-z]+:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) return null;
  const clean = ref.split(/[?#]/)[0];
  const candidates = clean.startsWith("/")
    ? [normalize(clean), normalize(`public/${clean}`)]
    : [normalize(`${dirname(fromFile)}/${clean}`), normalize(clean), normalize(`public/${clean}`)];
  return candidates.find((c) => c in files) ?? null;
}

function toDataUrl(mime: string, text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

function jsModuleUrl(path: string, files: Record<string, string>, seen: Set<string>): string {
  if (seen.has(path)) return toDataUrl("text/javascript", "");
  seen.add(path);
  const src = files[path].replace(
    /(\bimport\s*(?:[^"'()]*?\sfrom\s*)?|\bexport\s+[^"'()]*?\sfrom\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g,
    (m, head: string, q: string, spec: string) => {
      const target = resolveRef(spec, path, files);
      return target && target.endsWith("js") ? `${head}${q}${jsModuleUrl(target, files, new Set(seen))}${q}` : m;
    },
  );
  return toDataUrl("text/javascript", src);
}

export function buildPreviewDocument(files: Record<string, string>): string | null {
  const entry = findEntry(files);
  if (!entry) return null;
  let html = files[entry];

  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const target = href ? resolveRef(href, entry, files) : null;
    return target ? `<style data-from="${target}">\n${files[target]}\n</style>` : tag;
  });

  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, pre: string, src: string, post: string) => {
    const target = resolveRef(src, entry, files);
    if (!target) return tag;
    const isModule = /type=["']?module/i.test(pre + post);
    const url = isModule ? jsModuleUrl(target, files, new Set()) : toDataUrl("text/javascript", files[target]);
    return `<script${pre}src="${url}"${post}></script>`;
  });

  return html;
}
