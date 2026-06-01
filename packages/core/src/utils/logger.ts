/**
 * Structured leveled logger with secret redaction.
 *
 * Use `createLogger(name)` per module — the name is prefixed on every line so
 * pipeline runs are traceable. Output goes to stderr so structured stdout
 * (JSON pipes) stays clean.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Patterns that look like API keys / tokens — redacted from any logged value.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g, // Anthropic-style
  /sk_live_[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API
  /Bearer\s+[A-Za-z0-9._-]{20,}/gi,
  /[A-Fa-f0-9]{64}/g, // long hex tokens (e.g. SerpAPI)
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
    return out;
  }
  if (value && typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      let out = json;
      for (const p of SECRET_PATTERNS) out = out.replace(p, "[REDACTED]");
      return JSON.parse(out);
    } catch {
      return value;
    }
  }
  return value;
}

export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child: (subname: string) => Logger;
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (raw in LEVEL_ORDER ? raw : "info") as LogLevel;
}

export function createLogger(name: string): Logger {
  const emit = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
    const ts = new Date().toISOString();
    const prefix = `${ts} [${level.toUpperCase()}] ${name}`;
    if (meta && Object.keys(meta).length > 0) {
      const safeMeta = redact(meta);
      process.stderr.write(`${prefix}: ${msg} ${JSON.stringify(safeMeta)}\n`);
    } else {
      process.stderr.write(`${prefix}: ${msg}\n`);
    }
  };

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
    child: (sub) => createLogger(`${name}:${sub}`),
  };
}
