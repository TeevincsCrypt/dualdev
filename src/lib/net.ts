import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

let proxied: typeof fetch | undefined;

/**
 * Node's global fetch (and the CreateOS SDK's own pool) ignore HTTPS_PROXY.
 * Behind an egress proxy (e.g. a cloud dev container) return a proxy-aware
 * fetch; otherwise undefined so callers use their default.
 */
export function proxyFetch(): typeof fetch | undefined {
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy) return undefined;
  if (!proxied) {
    const dispatcher = new EnvHttpProxyAgent();
    proxied = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      undiciFetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch;
  }
  return proxied;
}
