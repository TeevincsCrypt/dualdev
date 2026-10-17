import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only SDKs out of the client bundle and un-bundled on the server.
  serverExternalPackages: ["@nodeops-createos/sandbox", "@anthropic-ai/sdk"],
};

export default nextConfig;
