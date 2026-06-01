import Anthropic from "@anthropic-ai/sdk";
import {
  type ClientContext,
  type StrategyOutput,
  StrategyOutputSchema,
  getAnthropicClient,
  defaultModel,
  createLogger,
  envNumber,
  extractJson,
  truncateToTokenBudget,
  buildRunPath,
  writeText,
} from "@rynk/core";
import {
  STRATEGY_AGENT_SYSTEM_PROMPT,
  buildUserMessage,
  type AuditInputForPrompt,
} from "../prompts/strategy-prompt.js";

const log = createLogger("layer2.strategy");

export interface RunStrategyOptions {
  audit: AuditInputForPrompt;
  clientContext: ClientContext;
  model?: string;
  /** Hard cap on output tokens. Sonnet 4.6 supports extended output via beta. */
  maxOutputTokens?: number;
}

export async function runStrategyAgent(opts: RunStrategyOptions): Promise<StrategyOutput> {
  const client = getAnthropicClient();
  const model = opts.model ?? defaultModel();
  const maxOutputTokens = opts.maxOutputTokens ?? envNumber("MAX_OUTPUT_TOKENS", 64_000);

  // Safety valve: audit content is normally <50k tokens, but cap before sending.
  const safeContent = truncateToTokenBudget(opts.audit.content, 140_000);
  const safeAudit: AuditInputForPrompt = { ...opts.audit, content: safeContent };

  const userMessage = buildUserMessage(safeAudit, opts.clientContext);

  log.info("running strategy agent", {
    model,
    domain: opts.clientContext.domain,
    auditFormat: opts.audit.format,
    auditTokensEstimate: Math.round(safeContent.length / 4),
  });

  let rawOutput = "";
  let final: Anthropic.Message | null = null;

  try {
    const stream = await client.beta.messages.stream({
      model,
      max_tokens: maxOutputTokens,
      system: STRATEGY_AGENT_SYSTEM_PROMPT,
      betas: ["output-128k-2025-02-19"],
      messages: [{ role: "user", content: userMessage }],
    });

    const dotInterval = setInterval(() => process.stderr.write("."), 3000);
    try {
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          rawOutput += chunk.delta.text;
        }
      }
    } finally {
      clearInterval(dotInterval);
      process.stderr.write("\n");
    }

    final = await stream.finalMessage();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) throw new Error("Invalid ANTHROPIC_API_KEY. Check .env.");
    if (status === 429) throw new Error("Rate limited. Wait and retry.");
    throw err;
  }

  if (!rawOutput) throw new Error("Strategy agent returned empty response");

  log.info("agent completed", {
    inputTokens: final?.usage.input_tokens,
    outputTokens: final?.usage.output_tokens,
    stopReason: final?.stop_reason,
  });

  if (final?.stop_reason === "max_tokens") {
    log.warn("output truncated (hit max_tokens) — consider splitting the run");
  }

  const cleaned = extractJson(rawOutput);
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse strategy output as JSON: ${(err as Error).message}\n\nFirst 500 chars:\n${cleaned.slice(0, 500)}`,
    );
  }

  // Ensure required fields the model might omit
  const obj = parsedRaw as Record<string, unknown>;
  obj.domain ??= opts.clientContext.domain;
  // Always force-assign from code — ??= won't override a hallucinated date string.
  obj.generatedAt = new Date().toISOString();

  const result = StrategyOutputSchema.safeParse(obj);
  if (!result.success) {
    // Save raw output so we can inspect without re-running.
    const rawPath = buildRunPath(
      process.env["RUNS_DIR"] ?? "runs",
      (obj["domain"] as string) ?? "unknown",
      "strategy.raw.json",
    );
    try {
      writeText(rawPath, JSON.stringify(obj, null, 2));
      log.info("strategy raw output saved for inspection", { rawPath });
    } catch (_) { /* non-fatal */ }

    log.error("strategy output failed schema validation", {
      issues: result.error.issues.slice(0, 10),
    });
    throw new Error(
      `Strategy output failed schema validation:\n${result.error.issues
        .slice(0, 20)
        .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }

  log.info("strategy output summary", {
    clusters: result.data.topicClusterMap.length,
    briefs: result.data.contentBriefs.length,
    sprints: result.data.sprintPlan.sprints.length,
    cannibalFixes: result.data.cannibalizationFixes.length,
  });

  return result.data;
}
