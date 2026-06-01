import "dotenv/config";

/**
 * Read a required env var. Throws at startup if missing — fail fast, don't
 * discover this 3 minutes into a crawl.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env (see .env.example).`,
    );
  }
  return value;
}

/**
 * Read an optional env var with a default.
 */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

/**
 * Read an optional env var, returning undefined if unset.
 */
export function maybeEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name]?.toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
