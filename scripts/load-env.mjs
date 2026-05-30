import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const exportPrefix = trimmed.startsWith("export ") ? 7 : 0;
  const body = trimmed.slice(exportPrefix);
  const eq = body.indexOf("=");
  if (eq === -1) return null;

  const key = body.slice(0, eq).trim();
  let value = body.slice(eq + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\n/g, "\n");
  return { key, value };
}

/** Load `.env.local` then `.env` from the project root (same order as Next.js). */
export function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

export const projectRoot = root;
