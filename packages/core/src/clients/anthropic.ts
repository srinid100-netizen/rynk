import Anthropic from "@anthropic-ai/sdk";
import { optionalEnv, requireEnv } from "../utils/env.js";

let cached: Anthropic | null = null;

/**
 * Get a memoized Anthropic SDK client. Validates the API key at first call.
 */
export function getAnthropicClient(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return cached;
}

/**
 * Default model for the pipeline. Override per-call or via MODEL env.
 * Rationale: Sonnet 4.6 is the current best balance of reasoning, cost, and
 * 200k context for our agents. Upgrade by changing this single constant.
 */
export function defaultModel(): string {
  return optionalEnv("MODEL", "claude-sonnet-4-6");
}
