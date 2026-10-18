import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidProjectId } from "../security/validation";
import type { Project } from "../types";

export type MetaName = "proof" | "sandbox";

/** Storage used by the agent. File-backed locally; Redis (Upstash REST) when configured. */
export interface Store {
  readonly durable: boolean;
  readonly kind: string;
  get(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  list(): Promise<Project[]>;
  delete(id: string): Promise<void>;
  getMeta<T>(name: MetaName): Promise<T | null>;
  saveMeta(name: MetaName, value: unknown): Promise<void>;
}

/**
 * File-backed project store: one JSON document per project under
 * `$DUALDEV_DATA_DIR/projects`. Survives server restarts; single-node only.
 */
export class ProjectStore implements Store {
  readonly kind = "files";
  constructor(private readonly root: string, readonly durable = true) {}

  private file(id: string) {
    if (!isValidProjectId(id)) throw new Error("Invalid project id");
    return path.join(this.root, "projects", `${id}.json`);
  }

  static newId(): string {
    return `p_${randomBytes(6).toString("hex")}`;
  }

  async get(id: string): Promise<Project | null> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as Project;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(project: Project): Promise<void> {
    const target = this.file(project.id);
    await mkdir(path.dirname(target), { recursive: true });
    project.updatedAt = new Date().toISOString();
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(project));
    await rename(tmp, target); // atomic replace
  }

  async list(): Promise<Project[]> {
    const dir = path.join(this.root, "projects");
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const projects = await Promise.all(
      names.filter((n) => n.endsWith(".json")).map((n) => this.get(n.slice(0, -5)).catch(() => null)),
    );
    return projects.filter((p): p is Project => p !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Small JSON documents outside the project namespace (e.g. the last sandbox proof). */
  async getMeta<T>(name: MetaName): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.root, `${name}.json`), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async saveMeta(name: MetaName, value: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, `${name}.json`);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, target);
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }
}
