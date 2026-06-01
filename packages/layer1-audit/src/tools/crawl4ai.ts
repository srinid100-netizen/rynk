import { z } from "zod";
import { optionalEnv, withRetry, createLogger, type AgentTool } from "@rynk/core";

const log = createLogger("layer1.tools.crawl4ai");

const DEFAULT_BASE_URL = "http://localhost:11235";

// ─── Crawl4AI raw response types (narrow — only fields we use) ───────────────

interface Crawl4AILink {
  href: string;
  text?: string;
}

interface Crawl4AILinks {
  internal?: Crawl4AILink[];
  external?: Crawl4AILink[];
}

interface Crawl4AIMetadata {
  title?: string;
  description?: string;
  keywords?: string;
}

interface Crawl4AIRawResult {
  url: string;
  success?: boolean;
  status_code?: number;
  /** May be a string or an object with raw_markdown / fit_markdown (varies by version). */
  markdown?: string | { raw_markdown?: string; fit_markdown?: string };
  html?: string;
  cleaned_html?: string;
  metadata?: Crawl4AIMetadata;
  links?: Crawl4AILinks;
  error_message?: string;
}

interface Crawl4AIResponse {
  success?: boolean;
  results?: Crawl4AIRawResult[];
}

// ─── Normalized page shape (compatible with the previous Firecrawl shape) ────

export interface Crawl4AIPage {
  markdown: string;
  html: string;
  metadata: {
    title?: string;
    description?: string;
    sourceURL?: string;
    url?: string;
    statusCode?: number;
  };
  links: string[];
}

function normalizeResult(result: Crawl4AIRawResult): Crawl4AIPage {
  // Crawl4AI's markdown field changed shape between versions — handle both.
  let markdown = "";
  if (typeof result.markdown === "string") {
    markdown = result.markdown;
  } else if (result.markdown && typeof result.markdown === "object") {
    // Use || not ?? — fit_markdown can be "" (empty string) which ?? treats as
    // truthy, so we must fall through to raw_markdown when fit is empty.
    markdown = result.markdown.fit_markdown || result.markdown.raw_markdown || "";
  }

  // Flatten internal + external link objects into a flat array of URLs.
  const internalLinks = (result.links?.internal ?? [])
    .map((l) => l.href)
    .filter((h): h is string => Boolean(h));
  const externalLinks = (result.links?.external ?? [])
    .map((l) => l.href)
    .filter((h): h is string => Boolean(h));

  return {
    markdown,
    html: result.html ?? result.cleaned_html ?? "",
    metadata: {
      title: result.metadata?.title,
      description: result.metadata?.description,
      sourceURL: result.url,
      url: result.url,
      statusCode: result.status_code,
    },
    links: [...internalLinks, ...externalLinks],
  };
}

// ─── Internal HTTP helper ────────────────────────────────────────────────────

async function crawl4aiFetch<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  return withRetry(async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      // Network-level failures (ECONNREFUSED, fetch failed) usually mean Docker
      // isn't running. Surface a clear, actionable message.
      const msg = (err as Error).message;
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed") ||
        msg.includes("connect")
      ) {
        const helpfulErr = new Error(
          `Crawl4AI server not reachable at ${baseUrl}.\n` +
            `Is the Docker container running?\n` +
            `Start it with:\n` +
            `  docker run -d -p 11235:11235 --name crawl4ai unclecode/crawl4ai:latest`,
        );
        (helpfulErr as unknown as { status: number }).status = 0;
        throw helpfulErr;
      }
      throw err;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(
        `Crawl4AI ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`,
      );
      (err as unknown as { status: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  });
}

// ─── Sitemap fetching ────────────────────────────────────────────────────────

/**
 * Fetch all page URLs from a domain's XML sitemap(s).
 * Handles both standard sitemaps and sitemap index files.
 * Returns an empty array on any failure so the caller can fall back to BFS.
 */
async function fetchSitemapUrls(domain: string, limit: number): Promise<string[]> {
  const origin = domain.startsWith("http") ? domain : `https://${domain}`;
  const hostname = new URL(origin).hostname;

  const tryFetch = async (url: string): Promise<string> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };

  const extractLocs = (xml: string): string[] => {
    const locs: string[] = [];
    const re = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) locs.push(m[1]!);
    return locs;
  };

  try {
    // Try /sitemap.xml first, then /sitemap_index.xml as fallback.
    let xml: string | null = null;
    for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
      try {
        xml = await tryFetch(`${origin}${path}`);
        break;
      } catch {
        // try next
      }
    }
    if (!xml) return [];

    const locs = extractLocs(xml);
    if (!locs.length) return [];

    // Sitemap index — each <loc> points to a child sitemap.
    // Process them in order (posts and pages appear first in most CMS sitemaps)
    // and let the page limit cap naturally cut off lower-priority archives.
    if (xml.includes("<sitemapindex")) {
      const childUrls: string[] = [];
      for (const childSitemapUrl of locs.slice(0, 20)) {
        try {
          const childXml = await tryFetch(childSitemapUrl);
          childUrls.push(...extractLocs(childXml));
        } catch {
          // skip broken child sitemaps
        }
      }
      return childUrls
        .filter((u) => new URL(u).hostname === hostname)
        .slice(0, limit);
    }

    // Regular sitemap — <loc> entries are page URLs.
    return locs
      .filter((u) => new URL(u).hostname === hostname)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ─── Public client API ───────────────────────────────────────────────────────

export interface CrawlOptions {
  /** Hard cap on pages crawled. No default — crawls everything in the sitemap. */
  limit?: number;
  /** Max wait time in seconds. Default 600 (10 min). */
  maxWaitSec?: number;
  /** Max depth for BFS deep crawl. Default 5. */
  maxDepth?: number;
}

export interface Crawl4AIClient {
  crawlSite: (domain: string, opts?: CrawlOptions) => Promise<Crawl4AIPage[]>;
  scrapeUrl: (url: string) => Promise<Crawl4AIPage>;
}

/** Scrape a batch of URLs via a single POST /crawl call. */
async function scrapeBatch(baseUrl: string, urls: string[]): Promise<Crawl4AIPage[]> {
  const response = await crawl4aiFetch<Crawl4AIResponse>(baseUrl, "/crawl", {
    method: "POST",
    body: JSON.stringify({
      urls,
      crawler_config: { type: "CrawlerRunConfig", params: { stream: false, verbose: false } },
    }),
  });
  return (response.results ?? [])
    .filter((r) => r.success !== false && r.status_code !== undefined && r.status_code < 400)
    .map(normalizeResult);
}

export function makeCrawl4AIClient(
  baseUrl: string = optionalEnv("CRAWL4AI_BASE_URL", DEFAULT_BASE_URL),
): Crawl4AIClient {
  return {
    async crawlSite(domain, opts = {}) {
      // No default cap — self-hosted Crawl4AI has no per-page cost.
      // Set CRAWL_PAGE_LIMIT env var to cap if needed (e.g. very large sites).
      const limit = opts.limit ?? Infinity;
      const fullUrl = domain.startsWith("http") ? domain : `https://${domain}`;

      // ── Strategy 1: sitemap-first ──────────────────────────────────────────
      // JS-heavy sites block BFS link discovery. Fetching the XML sitemap
      // directly gives us the full URL inventory regardless of JS nav.
      log.info("crawl: fetching sitemap", { domain });
      const sitemapUrls = await fetchSitemapUrls(fullUrl, limit);

      if (sitemapUrls.length > 0) {
        log.info("crawl: sitemap found — scraping all pages", {
          domain,
          sitemapUrlCount: sitemapUrls.length,
        });

        // Scrape in batches of 50 to avoid overwhelming the Crawl4AI container.
        const BATCH = 50;
        const pages: Crawl4AIPage[] = [];
        for (let i = 0; i < sitemapUrls.length; i += BATCH) {
          const batch = sitemapUrls.slice(i, i + BATCH);
          log.info("crawl: scraping batch", { from: i, to: i + batch.length });
          const batchPages = await scrapeBatch(baseUrl, batch);
          pages.push(...batchPages);
        }

        log.info("crawl: sitemap crawl completed", {
          sitemapUrls: sitemapUrls.length,
          validPages: pages.length,
        });
        return pages;
      }

      // ── Strategy 2: BFS fallback ───────────────────────────────────────────
      // No sitemap found — fall back to Crawl4AI's BFS deep crawler.
      const maxDepth = opts.maxDepth ?? 5;
      log.warn("crawl: no sitemap found — falling back to BFS", { domain, limit, maxDepth });

      const response = await crawl4aiFetch<Crawl4AIResponse>(baseUrl, "/crawl", {
        method: "POST",
        body: JSON.stringify({
          urls: [fullUrl],
          crawler_config: {
            type: "CrawlerRunConfig",
            params: {
              deep_crawl_strategy: {
                type: "BFSDeepCrawlStrategy",
                params: { max_depth: maxDepth, max_pages: limit, include_external: false },
              },
              stream: false,
              verbose: false,
            },
          },
        }),
      });

      const results = response.results ?? [];
      const pages = results
        .filter((r) => r.success !== false && r.status_code !== undefined && r.status_code < 400)
        .map(normalizeResult);

      log.info("crawl: BFS completed", { totalResults: results.length, validPages: pages.length });
      return pages;
    },

    async scrapeUrl(url) {
      const response = await crawl4aiFetch<Crawl4AIResponse>(baseUrl, "/crawl", {
        method: "POST",
        body: JSON.stringify({
          urls: [url],
          crawler_config: {
            type: "CrawlerRunConfig",
            params: {
              stream: false,
              verbose: false,
            },
          },
        }),
      });

      const result = response.results?.[0];
      if (!result) {
        throw new Error(`Crawl4AI returned no results for ${url}`);
      }
      return normalizeResult(result);
    },
  };
}

// ─── Agent tool wrappers (same names, schemas, and output shapes as before) ──

const crawlInput = z.object({
  domain: z.string(),
  limit: z.number().int().positive().max(1000).optional(),
});

export function crawlSiteTool(client: Crawl4AIClient): AgentTool<z.infer<typeof crawlInput>> {
  return {
    name: "crawl_site",
    description:
      "Crawl all discoverable URLs on a domain. Returns a compact JSON summary " +
      "with one entry per URL (status, title, meta description, H1 count, word count, " +
      "schema types). Use this once at the start of an audit.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Bare domain like 'itechdata.ai'" },
        limit: { type: "number", description: "Optional page cap. Omit to crawl the full site." },
      },
      required: ["domain"],
      additionalProperties: false,
    },
    inputZod: crawlInput,
    async execute({ domain, limit }) {
      const pages = await client.crawlSite(domain, { limit: limit ?? undefined });
      const summary = pages.map(summarizePage);
      return JSON.stringify({
        domain,
        pageCount: pages.length,
        note:
          limit !== undefined && pages.length >= limit
            ? `Capped at ${limit} pages. Full site may be larger.`
            : undefined,
        pages: summary,
      });
    },
  };
}

const scrapeInput = z.object({ url: z.string().url() });

export function scrapeUrlTool(client: Crawl4AIClient): AgentTool<z.infer<typeof scrapeInput>> {
  return {
    name: "scrape_url",
    description:
      "Fetch and render a single URL. Returns markdown, metadata, and links. Use this to " +
      "read specific pages (privacy policy, /about/, blog post samples) for E-E-A-T judgments.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    inputZod: scrapeInput,
    async execute({ url }) {
      const page = await client.scrapeUrl(url);
      return JSON.stringify({
        url,
        title: page.metadata.title ?? null,
        metaDescription: page.metadata.description ?? null,
        statusCode: page.metadata.statusCode ?? null,
        markdown: (page.markdown ?? "").slice(0, 8000),
        links: page.links.slice(0, 100),
      });
    },
  };
}

// ─── Page summarization (identical to the previous firecrawl summarizer) ─────

export interface PageSummary {
  url: string;
  statusCode: number | null;
  title: string | null;
  /** Truncated to 80 chars to keep crawl JSON within token budgets. */
  metaDescription: string | null;
  wordCount: number;
  h1Count: number;
  schemaTypes: string[];
}

export function summarizePage(page: Crawl4AIPage): PageSummary {
  const url = page.metadata.sourceURL ?? page.metadata.url ?? "";
  const markdown = page.markdown ?? "";
  const h1Matches = [...markdown.matchAll(/^#\s+(.+)$/gm)];

  // Extract JSON-LD types from raw HTML if present.
  const schemaTypes: string[] = [];
  const html = page.html ?? "";
  const jsonLdRegex = /"@type"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    if (!schemaTypes.includes(m[1]!)) schemaTypes.push(m[1]!);
  }

  const metaDescription = page.metadata.description ?? null;

  return {
    url,
    statusCode: page.metadata.statusCode ?? null,
    title: page.metadata.title ?? null,
    // Truncate to 80 chars — enough to detect missing/duplicate metas without
    // inflating the crawl JSON to tens of thousands of tokens.
    metaDescription: metaDescription ? metaDescription.slice(0, 80) : null,
    wordCount: markdown.split(/\s+/).filter(Boolean).length,
    h1Count: h1Matches.length,
    schemaTypes,
  };
}
