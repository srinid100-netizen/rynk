export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /**
   * Optional override for the delay between retries. Receives the error, the
   * attempt number (1-based), and the default computed delay. Return a custom
   * millisecond value to override (e.g. 65 000 ms for 429 rate-limit errors).
   */
  getDelayMs?: (err: unknown, attempt: number, defaultDelayMs: number) => number;
}

export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; name?: string };
  if (e.status && [408, 429, 500, 502, 503, 504].includes(e.status)) return true;
  if (e.code && ["ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN"].includes(e.code)) return true;
  if (e.name === "AbortError") return false;
  return false;
}

/**
 * Generic exponential-backoff retry with jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const shouldRetry = opts.shouldRetry ?? isTransientError;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err, attempt)) throw err;
      const defaultDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) + Math.random() * 250;
      const delay = opts.getDelayMs ? opts.getDelayMs(err, attempt + 1, defaultDelay) : defaultDelay;
      opts.onRetry?.(err, attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
