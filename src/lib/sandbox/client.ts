import { CreateosSandboxClient } from "@nodeops-createos/sandbox";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

let proxied: typeof fetch | undefined;

/**
 * The SDK uses its own connection pool, which ignores HTTPS_PROXY. When the
 * server runs behind an egress proxy (e.g. a cloud dev container), route SDK
 * traffic through it with a proxy-aware fetch; otherwise use the SDK default.
 */
function proxyFetch(): typeof fetch | undefined {
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy) return undefined;
  if (!proxied) {
    const dispatcher = new EnvHttpProxyAgent();
    proxied = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
  }
  return proxied;
}

export function createosClientOptions() {
  return { apiKey: process.env.CREATEOS_SANDBOX_API_KEY, baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || undefined, fetch: proxyFetch() };
}

export function createosClient(timeoutMs = 60_000) {
  return new CreateosSandboxClient({ ...createosClientOptions(), timeoutMs });
}
