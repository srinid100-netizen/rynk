import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Get the directory of a module given its `import.meta.url`. This is a
 * universal helper because `import.meta.dirname` is only supported on
 * Node >= 20.11.
 *
 * Usage:
 *   import { moduleDir } from "@rynk/core";
 *   const here = moduleDir(import.meta.url);
 */
export function moduleDir(metaUrl: string): string {
  return dirname(fileURLToPath(metaUrl));
}

export function ensureDir(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function readText(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return readFileSync(resolved, "utf-8");
}

export function readJson<T>(path: string): T {
  const raw = readText(path);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Failed to parse JSON at ${path}: ${(err as Error).message}`);
  }
}

export function writeText(path: string, content: string): string {
  const resolved = resolve(path);
  ensureDir(dirname(resolved));
  writeFileSync(resolved, content, "utf-8");
  return resolved;
}

export function writeJson(path: string, data: unknown): string {
  return writeText(path, JSON.stringify(data, null, 2));
}

export function fileExists(path: string): boolean {
  return existsSync(resolve(path));
}

/**
 * Build a date-prefixed output filename like
 *   runs/itechdata-ai/2026-05-13/audit.json
 */
export function buildRunPath(rootDir: string, domain: string, filename: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, "_");
  return resolve(rootDir, safeDomain, date, filename);
}
