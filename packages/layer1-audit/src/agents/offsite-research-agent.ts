import {
  runAgent,
  createLogger,
  envNumber,
  optionalEnv,
  extractJson,
  type ClientContext,
  type ServerTool,
} from "@rynk/core";
import {
  OFFSITE_RESEARCH_SYSTEM_PROMPT,
  buildOffsiteResearchUserMessage,
} from "../prompts/offsite-research-prompt.js";

const log = createLogger("layer1.offsiteResearch");

/**
 * Sub-agent 2 — Offsite Researcher.
 *
 * Uses only Anthropic server tools (web_search + web_fetch). No client-side
 * tools. The sub-agent picks its own queries based on the client context.
 */
export async function runOffsiteResearchAgent(client: ClientContext): Promise<string> {
  log.info("starting offsite research", { domain: client.domain });

  const serverTools: ServerTool[] = [
    { type: "web_search_20250305", name: "web_search", max_uses: 40 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 40 },
  ];

  // Same model split as data-collection: haiku by default to keep its
  // rate-limit bucket independent from the synthesiser's Sonnet calls.
  const model = optionalEnv("LAYER1_MODEL", "claude-haiku-4-5");
  log.info("model selected", { model });

  const result = await runAgent({
    system: OFFSITE_RESEARCH_SYSTEM_PROMPT,
    userMessage: buildOffsiteResearchUserMessage(client),
    serverTools,
    model,
    maxOutputTokens: envNumber("MAX_OUTPUT_TOKENS", 16_000),
    maxIterations: 50,
    logger: log,
  });

  const cleaned = extractJson(result.finalText);
  try {
    JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Offsite Research sub-agent output was not parseable JSON: ${(err as Error).message}\n\nFirst 500 chars:\n${cleaned.slice(0, 500)}`,
    );
  }
  return cleaned;
}
