/**
 * Lightweight HTTP-header + URL-pattern based tech stack detector.
 *
 * Runs without any AI tokens — pure HTTP HEAD request + regex matching.
 * Used during onboarding to auto-populate the `cms` and `hosting` fields
 * that Firecrawl cannot detect (Firecrawl returns markdown, not raw headers).
 */

export interface TechDetectionResult {
  cms: string | null;
  host: string | null;
  cdn: string | null;
  signals: string[];
}

// ── Header-based fingerprints ─────────────────────────────────────────────────

const CMS_HEADER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /x-drupal-cache/i, name: "Drupal" },
  { pattern: /x-generator.*wordpress/i, name: "WordPress" },
  { pattern: /x-shopify-stage/i, name: "Shopify" },
];

const HOST_HEADER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /x-wpe-pn/i, name: "WP Engine" },
  { pattern: /x-wpengine/i, name: "WP Engine" },
  { pattern: /x-wp-cf-super-cache/i, name: "WP Engine" },
  { pattern: /x-pantheon-stx/i, name: "Pantheon" },
  { pattern: /x-kinsta-cache/i, name: "Kinsta" },
  { pattern: /x-flywheel/i, name: "Flywheel" },
  { pattern: /x-wix-request-id/i, name: "Wix" },
  { pattern: /x-squarespace-id/i, name: "Squarespace" },
  { pattern: /x-vercel-id/i, name: "Vercel" },
  { pattern: /x-amz-cf-id/i, name: "AWS CloudFront" },
  { pattern: /x-amzn-requestid/i, name: "AWS" },
  { pattern: /server.*netlify/i, name: "Netlify" },
  { pattern: /x-github-request-id/i, name: "GitHub Pages" },
];

const CDN_HEADER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /cf-ray/i, name: "Cloudflare" },
  { pattern: /x-fastly-request-id/i, name: "Fastly" },
  { pattern: /x-akamai-request-id/i, name: "Akamai" },
  { pattern: /x-cache.*cloudfront/i, name: "AWS CloudFront" },
];

// ── URL / content pattern fingerprints ───────────────────────────────────────

const URL_CMS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\/wp-content\//i, name: "WordPress" },
  { pattern: /\/wp-includes\//i, name: "WordPress" },
  { pattern: /\.myshopify\.com/i, name: "Shopify" },
  { pattern: /cdn\.shopify\.com/i, name: "Shopify" },
  { pattern: /\/sites\/default\/files\//i, name: "Drupal" },
  { pattern: /js\.webflow\.com/i, name: "Webflow" },
  { pattern: /assets\.squarespace\.com/i, name: "Squarespace" },
  { pattern: /static\.parastorage\.com/i, name: "Wix" },
  { pattern: /_next\/static\//i, name: "Next.js" },
  { pattern: /gatsby-/i, name: "Gatsby" },
  { pattern: /hubspot\.com\/hs\//i, name: "HubSpot CMS" },
];

// ── Main detector ─────────────────────────────────────────────────────────────

/**
 * Detect CMS, hosting platform, and CDN for a domain.
 *
 * @param domain  Bare domain like "itechdata.ai"
 * @param pageLinks  Optional: list of links already discovered by Firecrawl
 *                   (used for URL-pattern CMS detection without extra fetches)
 */
export async function detectSiteTech(
  domain: string,
  pageLinks: string[] = [],
): Promise<TechDetectionResult> {
  const signals: string[] = [];
  let cms: string | null = null;
  let host: string | null = null;
  let cdn: string | null = null;

  // ── Step 1: URL-pattern detection from existing page links (zero cost) ──────
  const allUrls = pageLinks.join("\n");
  for (const { pattern, name } of URL_CMS_PATTERNS) {
    if (pattern.test(allUrls)) {
      if (!cms) cms = name;
      signals.push(`URL pattern → ${name}`);
      break; // first match wins
    }
  }

  // ── Step 2: HTTP HEAD request to read response headers ─────────────────────
  const url = `https://${domain}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    const headerText = [...res.headers.entries()]
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    // Detect CMS from headers (only if not already found via URL patterns)
    if (!cms) {
      for (const { pattern, name } of CMS_HEADER_PATTERNS) {
        if (pattern.test(headerText)) {
          cms = name;
          signals.push(`HTTP header → ${name} (CMS)`);
          break;
        }
      }
    }

    // Detect hosting
    for (const { pattern, name } of HOST_HEADER_PATTERNS) {
      if (pattern.test(headerText)) {
        host = name;
        signals.push(`HTTP header → ${name} (host)`);
        break;
      }
    }

    // Detect CDN
    for (const { pattern, name } of CDN_HEADER_PATTERNS) {
      if (pattern.test(headerText)) {
        cdn = name;
        signals.push(`HTTP header → ${name} (CDN)`);
        break;
      }
    }

    // Extra: Server header for hosting clues
    const serverHeader = res.headers.get("server") ?? "";
    if (!host && serverHeader) {
      if (/nginx/i.test(serverHeader)) signals.push("Server: nginx");
      if (/apache/i.test(serverHeader)) signals.push("Server: apache");
      if (/cloudflare/i.test(serverHeader)) {
        if (!cdn) cdn = "Cloudflare";
        signals.push("Server: cloudflare");
      }
    }

    // Extra: X-Powered-By for CMS clues
    const poweredBy = res.headers.get("x-powered-by") ?? "";
    if (!cms && /php/i.test(poweredBy)) signals.push("X-Powered-By: PHP (likely WordPress/Drupal)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    signals.push(`HTTP fetch failed: ${msg.slice(0, 80)}`);
  }

  return { cms, host, cdn, signals };
}

/**
 * Format the tech detection result as a compact markdown section
 * for embedding in the onboarding extraction user message.
 */
export function formatTechDetection(result: TechDetectionResult): string {
  const lines: string[] = ["## TECH DETECTION (pre-computed, do not re-detect)"];
  lines.push(`CMS:     ${result.cms ?? "unknown"}`);
  lines.push(`Host:    ${result.host ?? "unknown"}`);
  lines.push(`CDN:     ${result.cdn ?? "unknown"}`);
  if (result.signals.length > 0) {
    lines.push(`Signals: ${result.signals.join(" | ")}`);
  }
  lines.push("");
  lines.push(
    "Copy these values directly into the output JSON: cms → `cms`, Host → `hosting`, CDN → `cdn`.",
  );
  lines.push("If a value shows 'unknown', omit that field (or try web_search for hosting).");
  return lines.join("\n");
}
