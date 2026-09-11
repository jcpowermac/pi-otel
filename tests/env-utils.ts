import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_FILE_NAME } from "../src/config.js";

const ENV_KEYS = ["PI_CODING_AGENT_DIR"];

// Run fn with the config-dir env var scrubbed (saved and restored around it),
// so tests are hermetic regardless of the surrounding shell.
export async function withCleanEnv<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Run fn inside a temp PI_CODING_AGENT_DIR with a pi-learner.json config file.
// Pass cfg as null to test the missing-file path.
export async function withConfigFile<T>(
  cfg: Record<string, unknown> | null,
  fn: (dir: string) => T | Promise<T>
): Promise<T> {
  return withCleanEnv(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-"));
    if (cfg !== null) {
      fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify(cfg), "utf8");
    }
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      return await fn(dir);
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
