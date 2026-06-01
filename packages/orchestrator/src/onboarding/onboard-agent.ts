/**
 * Onboarding agent — pre-scrapes a domain's key pages directly via Firecrawl,
 * then makes a SINGLE AI extraction call to produce a validated ClientContext.
 *
 * Why single-call instead of a multi-turn tool-use agent?
 * The multi-turn approach accumulates scraped page content into the
 * conversation history across many iterations, rapidly burning through
 * per-minute input-token rate limits even at modest page counts.
 * Pre-scraping separates the Firecrawl calls (no AI tokens) from the AI
 * extraction call (one shot, predictable token count).
 */

import {
  runAgent,
  createLogger,
  extractJson,
  ClientContextSchema,
  type ClientContext,
  type ServerTool,
} from "@rynk/core";
import { makeFirecrawlClient } from "@rynk/layer1-audit";
import { ONBOARDING_EXTRACTION_PROMPT, buildExtractionUserMessage } from "./prompts.js";
import { detectSiteTech, formatTechDetection } from "./site-tech-detector.js";

const log = createLogger("onboarding.agent");

export interface OnboardAgentOptions {
  domain: string;
}

// ── Pre-scrape ─────────────────────────────────────────────────────────────────

const KEY_PAGES = [
  "/",
  "/about/",
  "/about-us/",
  "/contact/",
  "/contact-us/",
  "/services/",
  "/solutions/",
  "/team/",
  "/leadership/",
  "/privacy-policy/",
];

/** Maximum markdown chars kept per page. Keeps total bundle under ~15k tokens. */
const MAX_CHARS_PER_PAGE = 1200;

/**
 * Scrape all key pages in parallel via Firecrawl. Returns a combined text
 * block ready to embed in the AI user message. Pages that 404, error, or
 * return non-HTML content are silently skipped.
 */
async function preScrapePages(domain: string): Promise<{ content: string; allLinks: string[] }> {
  const firecrawl = makeFirecrawlClient();
  const urls = KEY_PAGES.map((p) => `https://${domain}${p}`);

  log.info("pre-scraping key pages", { domain, count: urls.length });

  const results = await Promise.allSettled(urls.map((url) => firecrawl.scrapeUrl(url)));

  const sections: string[] = [];
  const allLinks: string[] = [];
  let successCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const r = results[i]!;
    const url = urls[i]!;

    if (r.status === "rejected") {
      log.debug("scrape failed — skipping", { url, reason: (r.reason as Error).message?.slice(0, 80) });
      continue;
    }

    const page = r.value;
    const statusCode = page.metadata?.statusCode ?? 200;
    if (statusCode >= 400) continue;

    // Collect all links for tech detection (URL-pattern CMS fingerprinting).
    if (page.links) allLinks.push(...page.links);

    const md = (page.markdown ?? "").trim().slice(0, MAX_CHARS_PER_PAGE);
    if (!md) continue;

    const title = page.metadata?.title ? `Title: ${page.metadata.title}` : "";
    const meta = page.metadata?.description ? `Meta: ${page.metadata.description}` : "";
    const header = [title, meta].filter(Boolean).join("\n");

    sections.push(`=== ${url} ===\n${header ? header + "\n" : ""}${md}`);
    successCount++;
  }

  log.info("pre-scrape complete", { successCount, totalChars: sections.join("").length });
  return { content: sections.join("\n\n"), allLinks };
}

// ── Null stripper ─────────────────────────────────────────────────────────────

/**
 * Recursively replaces null values with undefined (omits the key). AI models
 * commonly output null for optional fields they can't determine, but Zod's
 * .optional() accepts undefined not null.
 */
function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripNulls(v);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

// ── Main agent ─────────────────────────────────────────────────────────────────

/**
 * Run the onboarding extraction for a given domain.
 *
 * Flow:
 *   1. Pre-scrape key pages + HTTP tech detection (parallel, no AI tokens)
 *   2. Bundle content + tech signals into one user message
 *   3. Single AI extraction call (web_search allowed only for competitors)
 *   4. Zod-validate output → ClientContext
 */
export async function runOnboardingAgent(opts: OnboardAgentOptions): Promise<ClientContext> {
  const { domain } = opts;
  log.info("onboarding agent starting", { domain });

  // Phase 1 — pre-scrape + tech detection (no AI, no token cost).
  // Run both in parallel: tech detection does an HTTP HEAD, scrape does Firecrawl calls.
  const [{ content: scrapedContent, allLinks }, techResult] = await Promise.all([
    preScrapePages(domain),
    detectSiteTech(domain, []).catch(() => ({ cms: null, host: null, cdn: null, signals: [] })),
  ]);

  // Re-run tech detection with the collected links for URL-pattern CMS fingerprinting.
  const techResultWithLinks = allLinks.length > 0
    ? await detectSiteTech(domain, allLinks).catch(() => techResult)
    : techResult;

  log.info("tech detection complete", {
    cms: techResultWithLinks.cms,
    host: techResultWithLinks.host,
    cdn: techResultWithLinks.cdn,
    signals: techResultWithLinks.signals.length,
  });

  if (!scrapedContent.trim()) {
    throw new Error(
      `Could not scrape any content from ${domain}. ` +
        `Check that the domain is reachable and FIRECRAWL_API_KEY is set.`,
    );
  }

  const techSection = formatTechDetection(techResultWithLinks);

  // Phase 2 — single AI extraction call
  // web_search is available but only used for competitor discovery when needed.
  const serverTools: ServerTool[] = [
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  ];

  log.info("running extraction agent", { contentChars: scrapedContent.length });

  const result = await runAgent({
    system: ONBOARDING_EXTRACTION_PROMPT,
    userMessage: buildExtractionUserMessage(domain, scrapedContent, techSection),
    tools: [],        // no client-side tools — all scraping already done
    serverTools,
    maxOutputTokens: 8_000,
    maxIterations: 8, // enough for up to 5 web searches + final JSON output
    logger: log,
  });

  log.info("extraction agent finished", {
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
    iterations: result.usage.iterations,
  });

  // ── Parse + validate ────────────────────────────────────────────────────────

  const rawJson = extractJson(result.finalText);

  // Models frequently output null for optional fields they can't determine.
  // Zod's .optional() accepts undefined but not null — strip all nulls first.

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `Extraction agent did not output valid JSON: ${(err as Error).message}\n\n` +
        `First 500 chars of output:\n${rawJson.slice(0, 500)}\n\n` +
        `Re-run to try again, or create the file manually:\n` +
        `  runs/${domain.replace(/[^a-z0-9.-]/gi, "_")}/client.json`,
    );
  }

  // Strip nulls, inject domain if missing, then validate.
  parsed = stripNulls(parsed);

  if (typeof parsed === "object" && parsed !== null && !("domain" in parsed)) {
    (parsed as Record<string, unknown>)["domain"] = domain;
  }

  const validation = ClientContextSchema.safeParse(parsed);
  if (!validation.success) {
    const issues = validation.error.issues
      .slice(0, 20)
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `ClientContext validation failed:\n${issues}\n\n` +
        `Edit runs/${domain.replace(/[^a-z0-9.-]/gi, "_")}/client.json manually and re-run.`,
    );
  }

  log.info("ClientContext validated", { domain: validation.data.domain });
  return validation.data;
}
