// Reproduces what Tailwind's v3 Play CDN (cdn.tailwindcss.com) would render for a
// generated project, for recording environments where the CDN is unreachable:
// compiles the CSS with real Tailwind v3 using the page's own inline config.
import postcss from "postcss";
import tailwindcss from "tailwindcss3";
import vm from "node:vm";

export async function compilePlayCss(files) {
  const html = files["public/index.html"] ?? "";
  // Evaluate only the inline `tailwind.config = {...}` assignment, in an empty sandbox.
  let config = {};
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/gi)) {
    if (!/tailwind\.config\s*=/.test(m[1])) continue;
    const sandbox = { tailwind: {} };
    try {
      vm.runInNewContext(m[1], sandbox, { timeout: 200 });
      config = sandbox.tailwind.config ?? {};
    } catch {}
  }
  const raw = Object.entries(files).filter(([p]) => /\.(html|js)$/.test(p)).map(([, c]) => c).join("\n");
  const result = await postcss([tailwindcss({ ...config, content: [{ raw, extension: "html" }] })]).process(
    "@tailwind base;@tailwind components;@tailwind utilities;",
    { from: undefined },
  );
  return result.css;
}

/** JS served in place of cdn.tailwindcss.com: injects the CSS and accepts `tailwind.config = …`. */
export function playScript(css) {
  return `window.tailwind=window.tailwind||{};(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);})();`;
}
