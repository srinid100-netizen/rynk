/** Rough char→token approximation. Anthropic models are roughly 1 token per 4 chars of English. */
export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

export function truncateToTokenBudget(content: string, maxTokens = 150_000): string {
  const estimated = estimateTokens(content);
  if (estimated <= maxTokens) return content;
  const charLimit = maxTokens * 4;
  return content.slice(0, charLimit) + "\n\n[...truncated for context window]";
}

/**
 * Robust JSON extractor for model output. Handles all common patterns:
 *   - Pure JSON                        { ... }
 *   - Fenced at the start              ```json\n{ ... }\n```
 *   - Prose then fenced JSON           some text\n```json\n{ ... }\n```
 *   - Prose then bare JSON             some text\n{ ... }
 */
export function extractJson(raw: string): string {
  const cleaned = raw.trim();

  // 1. Find a ```json ... ``` fence anywhere in the output (most common pattern
  //    when the model adds a prose preamble before the code block).
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // 2. Output is already JSON-shaped — return as-is.
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  // 3. Prose before bare JSON — find the outermost { ... } or [ ... ] block.
  const start = cleaned.search(/[{[]/);
  const lastCurly = cleaned.lastIndexOf("}");
  const lastSquare = cleaned.lastIndexOf("]");
  const end = Math.max(lastCurly, lastSquare);
  if (start !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  return cleaned;
}
