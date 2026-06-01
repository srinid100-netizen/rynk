/**
 * Pre-compute sitemapUrls and contentInventory from the data collection
 * agent's raw JSON output.
 *
 * Why: The synthesiser has a ~20k output token budget. Asking it to emit
 * all 100+ crawled pages verbatim causes truncation of the analytical sections
 * (issues, EEAT, entity summary). Instead, we extract the inventory directly
 * from the data-collection raw output in TypeScript code — zero tokens, 100%
 * coverage — and inject it into the audit object after the synthesiser runs.
 */

import type { SitemapUrl, ContentInventoryItem } from "@rynk/core";

// ── Raw data collection output shape (what the agent produces) ─────────────

interface RawSitemapEntry {
  url: string;
  statusCode?: number | null;
  title?: string | null;
  metaDescription?: string | null;
  h1Count?: number | null;
  h1Text?: string[];
  wordCount?: number | null;
  schemaTypes?: string[];
  internalLinkCount?: number | null;
}

interface RawDataCollection {
  domain?: string;
  sitemapSummary?: RawSitemapEntry[];
  pageCount?: number;
}

// ── Mapping functions ─────────────────────────────────────────────────────────

function toSitemapUrl(entry: RawSitemapEntry): SitemapUrl {
  const wordCount = entry.wordCount ?? 0;
  return {
    url: entry.url,
    statusCode: entry.statusCode ?? 200,
    canonical: null,        // data collection doesn't extract canonical tags
    noindex: false,         // data collection doesn't extract noindex; synthesiser flags if found
    title: entry.title ?? null,
    metaDescription: entry.metaDescription ?? null,
    h1Count: entry.h1Count ?? 0,
    h1Text: entry.h1Text ?? [],
    wordCount,
    internalLinks: [],      // internalLinkCount kept but individual URLs not available in summary
    schemaTypes: entry.schemaTypes ?? [],
  };
}

function toContentInventoryItem(entry: RawSitemapEntry): ContentInventoryItem {
  const wordCount = entry.wordCount ?? 0;
  return {
    url: entry.url,
    title: entry.title ?? entry.url,
    wordCount,
    topicCategory: inferTopicCategory(entry.url),
    isThin: wordCount > 0 && wordCount < 300,
    isOffTopic: false,    // synthesiser flags specific off-topic pages in offTopicPages
    rankingPosition: null,
  };
}

/**
 * Infer a rough topic category from the URL path.
 * The synthesiser can refine this via its offTopicPages analysis.
 */
function inferTopicCategory(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === "/" || path === "") return "homepage";
    if (/\/(blog|insights|resources|articles|posts?)/.test(path)) return "blog";
    if (/\/(solutions?|services?|products?|offerings?)/.test(path)) return "service";
    if (/\/(industries?|sectors?|verticals?)/.test(path)) return "industry";
    if (/\/(about|team|leadership|company|story)/.test(path)) return "about";
    if (/\/(contact|get-in-touch|reach-us)/.test(path)) return "contact";
    if (/\/(privacy|terms|legal|cookie|compliance)/.test(path)) return "legal";
    if (/\/(case-stud|success-stor|client|portfolio)/.test(path)) return "case-study";
    return "other";
  } catch {
    return "other";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PreComputedInventory {
  sitemapUrls: SitemapUrl[];
  contentInventory: ContentInventoryItem[];
}

/**
 * Parse the data collection agent's raw JSON string and extract the full
 * URL inventory. Returns empty arrays if the JSON is unparseable or missing
 * the sitemapSummary field (graceful degradation — synthesiser output is used
 * as-is in that case).
 */
export function preComputeInventory(dataCollectionRaw: string): PreComputedInventory {
  let parsed: RawDataCollection;
  try {
    parsed = JSON.parse(dataCollectionRaw) as RawDataCollection;
  } catch {
    return { sitemapUrls: [], contentInventory: [] };
  }

  const entries = parsed.sitemapSummary ?? [];
  if (entries.length === 0) {
    return { sitemapUrls: [], contentInventory: [] };
  }

  const sitemapUrls = entries.map(toSitemapUrl);
  // Content inventory: only include pages that were successfully fetched (status < 400).
  const contentInventory = entries
    .filter((e) => (e.statusCode ?? 200) < 400)
    .map(toContentInventoryItem);

  return { sitemapUrls, contentInventory };
}
