import { CreateosSandboxClient } from "@nodeops-createos/sandbox";
import { proxyFetch } from "../net";

export function createosClientOptions() {
  return { apiKey: process.env.CREATEOS_SANDBOX_API_KEY, baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL || undefined, fetch: proxyFetch() };
}

export function createosClient(timeoutMs = 60_000) {
  return new CreateosSandboxClient({ ...createosClientOptions(), timeoutMs });
}
