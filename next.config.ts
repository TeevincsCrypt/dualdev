import type { NextConfig } from "next";
import { execSync } from "node:child_process";

let build = "dev";
try {
  build = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}

const nextConfig: NextConfig = {
  // Keep server-only SDKs out of the client bundle and un-bundled on the server.
  serverExternalPackages: ["@nodeops-createos/sandbox", "@anthropic-ai/sdk"],
  env: { NEXT_PUBLIC_DUALDEV_BUILD: build },
};

export default nextConfig;
