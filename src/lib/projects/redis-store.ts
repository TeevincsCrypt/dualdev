import { isValidProjectId } from "../security/validation";
import type { Project } from "../types";
import type { MetaName, Store } from "./store";

const PREFIX = "dualdev:";
const INDEX = `${PREFIX}projects`;

/**
 * Project store on Upstash Redis via its REST API (no SDK). Shared by every
 * server instance, which serverless hosts like Vercel need.
 */
export class RedisStore implements Store {
  readonly durable = true;
  readonly kind = "redis";

  constructor(private readonly url: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  static fromEnv(): RedisStore | null {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? new RedisStore(url.replace(/\/+$/, ""), token) : null;
  }

  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Redis ${args[0]} failed: ${body.error ?? `HTTP ${res.status}`}`);
    return body.result as T;
  }

  private key(id: string) {
    if (!isValidProjectId(id)) throw new Error("Invalid project id");
    return `${PREFIX}project:${id}`;
  }

  async get(id: string): Promise<Project | null> {
    const raw = await this.cmd<string | null>("GET", this.key(id));
    return raw ? (JSON.parse(raw) as Project) : null;
  }

  async save(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();
    // Keep documents well under Upstash's request size limit.
    if (project.runs.length > 8) project.runs = project.runs.slice(-8);
    await this.cmd("SET", this.key(project.id), JSON.stringify(project));
    await this.cmd("SADD", INDEX, project.id);
  }

  async list(): Promise<Project[]> {
    const ids = await this.cmd<string[]>("SMEMBERS", INDEX);
    if (!ids.length) return [];
    const raws = await this.cmd<(string | null)[]>("MGET", ...ids.filter(isValidProjectId).map((id) => this.key(id)));
    return raws
      .filter((r): r is string => Boolean(r))
      .map((r) => JSON.parse(r) as Project)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    await this.cmd("DEL", this.key(id));
    await this.cmd("SREM", INDEX, id);
  }

  async getMeta<T>(name: MetaName): Promise<T | null> {
    const raw = await this.cmd<string | null>("GET", `${PREFIX}meta:${name}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async saveMeta(name: MetaName, value: unknown): Promise<void> {
    await this.cmd("SET", `${PREFIX}meta:${name}`, JSON.stringify(value));
  }
}
