import type { NextConfig } from "next";
import { execSync } from "node:child_process";

let build = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
if (build === "dev") try {
  build = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}

const nextConfig: NextConfig = {
  // Keep server-only SDKs out of the client bundle and un-bundled on the server.
  serverExternalPackages: ["@nodeops-createos/sandbox", "@anthropic-ai/sdk"],
  env: { NEXT_PUBLIC_DUALDEV_BUILD: build },
  // The demo fixture is read from disk at runtime; ship it with the server functions.
  outputFileTracingIncludes: { "/api/**": ["./fixtures/**"] },
};

export default nextConfig;
