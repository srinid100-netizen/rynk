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
  DATA_COLLECTION_SYSTEM_PROMPT,
  buildDataCollectionUserMessage,
} from "../prompts/data-collection-prompt.js";
import {
  makeCrawl4AIClient as makeFirecrawlClient,
  crawlSiteTool,
  scrapeUrlTool,
  summarizePage,
  type PageSummary,
} from "../tools/crawl4ai.js";
import { makePageSpeedClient, pageSpeedTool } from "../tools/pagespeed.js";
import { makeSerpApiClient, serpSearchTool } from "../tools/serpapi.js";

const log = createLogger("layer1.dataCollection");

/**
 * Sub-agent 1 — Data Collection.
 *
 * Orchestrates Crawl4AI + PSI + SerpAPI + web_fetch via Claude. Output is a
 * JSON string the synthesiser consumes verbatim.
 *
 * IMPORTANT: We run the full-site crawl ourselves (in code) BEFORE the agent
 * starts, then inject the URL inventory directly into the output JSON. This
 * guarantees 100% URL coverage regardless of how lazy the LLM is about
 * regurgitating long arrays. The agent only does the analytical work.
 */
export async function runDataCollectionAgent(client: ClientContext): Promise<string> {
  log.info("starting data collection", { domain: client.domain });

  const firecrawl = makeFirecrawlClient();
  const psi = makePageSpeedClient();
  const serp = makeSerpApiClient();

  // ── Step 1: crawl the full site in code (no LLM involvement) ──────────────
  // This gives us a guaranteed-complete URL inventory. The agent's
  // `crawl_site` tool now becomes a no-op that returns this pre-fetched data
  // (so the agent doesn't re-crawl), and we splice the inventory into the
  // final JSON regardless of whether the agent includes it.
  const crawlLimitOverride = process.env["CRAWL_PAGE_LIMIT"];
  const limit = crawlLimitOverride ? parseInt(crawlLimitOverride, 10) : undefined;
  log.info("pre-crawling site", { domain: client.domain, limit: limit ?? "no limit" });
  const crawledPages = await firecrawl.crawlSite(client.domain, { limit });
  const sitemapSummary: PageSummary[] = crawledPages.map(summarizePage);
  log.info("pre-crawl complete", { pageCount: sitemapSummary.length });

  // ── Step 2: agent does analytical work, with crawl data as context ────────
  const clientTools = [
    crawlSiteTool(firecrawl),
    scrapeUrlTool(firecrawl),
    pageSpeedTool(psi),
    serpSearchTool(serp),
  ];

  const serverTools: ServerTool[] = [
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 20 },
  ];

  // Tell the agent that the URL inventory is already provided — focus on
  // analytical work (PSI, SERP, EEAT, NAP) and DO NOT call crawl_site again.
  const crawlContext =
    `\n\n## PRE-CRAWLED URL INVENTORY (${sitemapSummary.length} pages)\n\n` +
    `The full sitemap has already been crawled in code. The URL list below is ` +
    `complete and will be merged into your output automatically — you do NOT need ` +
    `to regurgitate it. Use it to pick representative pages for check_pagespeed, ` +
    `scrape_url (E-E-A-T pages), and to identify duplicate titles/metas, H1 issues, ` +
    `and schema gaps. SKIP calling crawl_site — it would duplicate work.\n\n` +
    `Page-level data (URLs, titles, word counts, etc.) for all ${sitemapSummary.length} ` +
    `pages:\n\`\`\`json\n${JSON.stringify(sitemapSummary, null, 2)}\n\`\`\``;

  const userMessage = `${buildDataCollectionUserMessage(client)}${crawlContext}`;

  const model = optionalEnv("LAYER1_MODEL", "claude-haiku-4-5");
  log.info("model selected", { model });

  const result = await runAgent({
    system: DATA_COLLECTION_SYSTEM_PROMPT,
    userMessage,
    tools: clientTools,
    serverTools,
    model,
    maxOutputTokens: envNumber("MAX_OUTPUT_TOKENS", 32_000),
    maxIterations: 50,
    logger: log,
  });

  const cleaned = extractJson(result.finalText);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Data Collection sub-agent output was not parseable JSON: ${(err as Error).message}\n\nFirst 500 chars:\n${cleaned.slice(0, 500)}`,
    );
  }

  // ── Step 3: splice the full URL inventory into the output ─────────────────
  // The agent's own sitemapSummary (if any) is overwritten with the complete
  // pre-crawled inventory. This guarantees the synthesiser sees every URL.
  parsed["sitemapSummary"] = sitemapSummary;
  log.info("sitemapSummary spliced", { pageCount: sitemapSummary.length });

  return JSON.stringify(parsed);
}
