import { z } from "zod";
import { requireEnv, withRetry, createLogger, type AgentTool } from "@rynk/core";

const log = createLogger("layer1.tools.pagespeed");

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface PageSpeedMetrics {
  url: string;
  strategy: "mobile" | "desktop";
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
  performanceScore: number | null;
  topBlockingResources: { url: string; transferSizeKb: number }[];
}

interface PsiAuditRef {
  id: string;
  numericValue?: number;
  details?: {
    items?: Array<{ url?: string; transferSize?: number; total?: number; scripting?: number }>;
  };
}

interface PsiResponse {
  lighthouseResult?: {
    audits: Record<string, PsiAuditRef>;
    categories: {
      performance?: { score?: number };
    };
  };
}

export interface PageSpeedClient {
  measure: (url: string, strategy?: "mobile" | "desktop") => Promise<PageSpeedMetrics>;
}

export function makePageSpeedClient(
  apiKey: string = requireEnv("PAGESPEED_API_KEY"),
): PageSpeedClient {
  return {
    async measure(url, strategy = "mobile") {
      const params = new URLSearchParams({
        url,
        strategy,
        key: apiKey,
        category: "performance",
      });
      const endpoint = `${PSI_BASE}?${params.toString()}`;

      const body = await withRetry(async () => {
        const res = await fetch(endpoint);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`PageSpeed ${res.status}: ${text.slice(0, 200)}`);
          (err as unknown as { status: number }).status = res.status;
          throw err;
        }
        return (await res.json()) as PsiResponse;
      });

      const audits = body.lighthouseResult?.audits ?? {};
      const lcpMs = audits["largest-contentful-paint"]?.numericValue;
      const cls = audits["cumulative-layout-shift"]?.numericValue;
      const tbtMs = audits["total-blocking-time"]?.numericValue;
      const score = body.lighthouseResult?.categories.performance?.score;

      // Prefer render-blocking-resources (CSS/JS blocking initial paint).
      // If empty — high TBT is caused by JS execution, not render-blocking;
      // fall back to bootup-time which shows the heaviest JS files by CPU time.
      const renderBlockingItems = audits["render-blocking-resources"]?.details?.items ?? [];
      const bootupItems = audits["bootup-time"]?.details?.items ?? [];

      const topBlocking =
        renderBlockingItems.length > 0
          ? renderBlockingItems
              .filter((i) => i.url && typeof i.transferSize === "number")
              .slice(0, 5)
              .map((i) => ({ url: i.url!, transferSizeKb: Math.round((i.transferSize ?? 0) / 1024) }))
          : bootupItems
              .filter((i) => i.url && typeof i.total === "number")
              .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
              .slice(0, 5)
              .map((i) => ({ url: i.url!, transferSizeKb: Math.round((i.total ?? 0)) }));

      log.info("pagespeed measured", { url, strategy, score });

      return {
        url,
        strategy,
        lcp: typeof lcpMs === "number" ? lcpMs / 1000 : null,
        cls: typeof cls === "number" ? cls : null,
        tbt: typeof tbtMs === "number" ? tbtMs : null,
        performanceScore: typeof score === "number" ? score * 100 : null,
        topBlockingResources: topBlocking,
      };
    },
  };
}

// ─── Agent tool wrapper ──────────────────────────────────────────────────────

const psInput = z.object({
  url: z.string().url(),
  strategy: z.enum(["mobile", "desktop"]).optional(),
});

export function pageSpeedTool(client: PageSpeedClient): AgentTool<z.infer<typeof psInput>> {
  return {
    name: "check_pagespeed",
    description:
      "Measure Core Web Vitals (LCP, CLS, TBT) for a single URL using Google PageSpeed Insights. " +
      "Call this on 4-5 representative page templates: homepage, service page, blog post, industry page, contact page.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        strategy: { type: "string", enum: ["mobile", "desktop"] },
      },
      required: ["url"],
      additionalProperties: false,
    },
    inputZod: psInput,
    async execute({ url, strategy }) {
      const metrics = await client.measure(url, strategy);
      return JSON.stringify(metrics);
    },
  };
}
