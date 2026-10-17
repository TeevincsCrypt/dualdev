import "server-only";
import path from "node:path";
import { Agent } from "./agent/orchestrator";
import { createModelProvider } from "./ai";
import { ProjectStore } from "./projects/store";
import { CreateOSProvider } from "./sandbox/createos";

// One Agent per server process (survives Next dev hot reloads).
const g = globalThis as unknown as { __dualdevAgent?: Agent };

export function agent(): Agent {
  g.__dualdevAgent ??= new Agent({
    store: new ProjectStore(process.env.DUALDEV_DATA_DIR || path.join(process.cwd(), ".data")),
    sandbox: new CreateOSProvider(),
    model: createModelProvider(),
    fixtureDir: path.join(process.cwd(), "fixtures", "task-manager"),
  });
  return g.__dualdevAgent;
}
