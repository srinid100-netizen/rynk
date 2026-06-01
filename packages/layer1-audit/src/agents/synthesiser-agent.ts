import Anthropic from "@anthropic-ai/sdk";
import {
  getAnthropicClient,
  defaultModel,
  createLogger,
  envNumber,
  extractJson,
  buildRunPath,
  writeText,
  AuditFindingsSchema,
  type AuditFindings,
  type ClientContext,
  type SitemapUrl,
  type ContentInventoryItem,
} from "@rynk/core";
import {
  SYNTHESISER_SYSTEM_PROMPT,
  buildSynthesiserUserMessage,
} from "../prompts/synthesiser-prompt.js";

const log = createLogger("layer1.synthesiser");

export interface SynthesiseOptions {
  client: ClientContext;
  dataCollectionRaw: string;
  offsiteResearchRaw: string;
  /** Pre-computed from crawl data — injected AFTER synthesiser runs to replace empty arrays. */
  preComputed?: {
    sitemapUrls: SitemapUrl[];
    contentInventory: ContentInventoryItem[];
  };
}

/**
 * Sub-agent 3 — Synthesiser.
 *
 * Pure reasoning. Single large API call. Merges sub-agent 1 + 2 + client
 * context into the final AuditFindings JSON, validated against the schema.
 */
export async function runSynthesiserAgent(opts: SynthesiseOptions): Promise<AuditFindings> {
  const client = getAnthropicClient();
  const model = process.env.SYNTHESISER_MODEL ?? defaultModel();
  const maxOutputTokens = envNumber("MAX_OUTPUT_TOKENS", 64_000);

  const userMessage = buildSynthesiserUserMessage(opts);

  log.info("running synthesiser", {
    model,
    domain: opts.client.domain,
    dataCollectionChars: opts.dataCollectionRaw.length,
    offsiteChars: opts.offsiteResearchRaw.length,
  });

  let raw = "";
  let final: Anthropic.Message | null = null;

  try {
    const stream = await client.beta.messages.stream({
      model,
      max_tokens: maxOutputTokens,
      system: SYNTHESISER_SYSTEM_PROMPT,
      betas: ["output-128k-2025-02-19"],
      messages: [{ role: "user", content: userMessage }],
    });

    const dotInterval = setInterval(() => process.stderr.write("."), 3000);
    try {
      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          raw += chunk.delta.text;
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

  if (!raw) throw new Error("Synthesiser returned empty response");

  log.info("synthesiser completed", {
    inputTokens: final?.usage.input_tokens,
    outputTokens: final?.usage.output_tokens,
    stopReason: final?.stop_reason,
  });

  if (final?.stop_reason === "max_tokens") {
    log.warn("synthesiser output truncated (hit max_tokens)");
  }

  const cleaned = extractJson(raw);
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Synthesiser output was not parseable JSON: ${(err as Error).message}\n\nFirst 500 chars:\n${cleaned.slice(0, 500)}`,
    );
  }

  // Default the bookkeeping fields the model might omit
  const obj = parsedRaw as Record<string, unknown>;
  obj.domain ??= opts.client.domain;
  // Always force-assign from code — ??= won't override a hallucinated date string.
  obj.auditDate = new Date().toISOString();
  obj.auditVersion ??= "1.0";

  // Inject pre-computed inventory BEFORE validation.
  // The synthesiser is told to output empty arrays for these two fields;
  // we replace them here with the full crawl-derived data (100% coverage).
  if (opts.preComputed) {
    const tc = (obj["technicalCrawl"] ?? {}) as Record<string, unknown>;
    tc["sitemapUrls"] = opts.preComputed.sitemapUrls;
    obj["technicalCrawl"] = tc;
    obj["contentInventory"] = opts.preComputed.contentInventory;
  }

  const result = AuditFindingsSchema.safeParse(obj);
  if (!result.success) {
    // Save the raw synthesiser output so we can inspect it without re-running.
    const rawSynthPath = buildRunPath(
      process.env["RUNS_DIR"] ?? "runs",
      (obj["domain"] as string) ?? "unknown",
      "synthesiser.raw.json",
    );
    try {
      writeText(rawSynthPath, JSON.stringify(obj, null, 2));
      log.info("synthesiser raw output saved for inspection", { rawSynthPath });
    } catch (_) { /* non-fatal */ }

    log.error("synthesiser output failed schema validation", {
      issues: result.error.issues.slice(0, 10),
    });
    throw new Error(
      `Synthesiser output failed schema validation:\n${result.error.issues
        .slice(0, 20)
        .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }

  log.info("audit findings summary", {
    urls: result.data.technicalCrawl.sitemapUrls.length,
    contentItems: result.data.contentInventory.length,
    p1Count: result.data.prioritizedIssues.p1.length,
    p2Count: result.data.prioritizedIssues.p2.length,
    p3Count: result.data.prioritizedIssues.p3.length,
    serpKeywords: result.data.serpData.byKeyword.length,
  });

  return result.data;
}
