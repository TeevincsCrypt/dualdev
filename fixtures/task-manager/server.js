// Zero-dependency static server for the preview. Binds 0.0.0.0 so sandbox
// ingress can reach it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 3000);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rel = url.pathname === "/" ? "public/index.html" : url.pathname.replace(/^\/+/, "");
  const path = normalize(join(root, rel));
  if (!path.startsWith(root) || !(rel.startsWith("public/") || rel.startsWith("src/"))) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "0.0.0.0", () => console.log(`listening on ${port}`));
