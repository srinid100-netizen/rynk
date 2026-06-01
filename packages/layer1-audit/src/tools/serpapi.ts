import { z } from "zod";
import { requireEnv, withRetry, createLogger, type AgentTool } from "@rynk/core";

const log = createLogger("layer1.tools.serpapi");

const SERPAPI_BASE = "https://serpapi.com/search.json";

export interface SerpKeywordResult {
  keyword: string;
  topResults: { url: string; title: string; position: number }[];
  peopleAlsoAsk: string[];
  featuredSnippet: { present: boolean; sourceUrl: string | null };
  aiOverview: { present: boolean; cites: string[]; text: string | null };
  serpFeatures: string[];
}

interface SerpApiResponse {
  organic_results?: Array<{ position: number; link: string; title: string }>;
  related_questions?: Array<{ question: string }>;
  answer_box?: { link?: string; title?: string };
  ai_overview?: {
    text_blocks?: Array<{ snippet?: string }>;
    references?: Array<{ link: string; title?: string }>;
  };
  knowledge_graph?: unknown;
  inline_images?: unknown;
  inline_videos?: unknown;
}

export interface SerpApiClient {
  search: (keyword: string, opts?: { gl?: string; hl?: string }) => Promise<SerpKeywordResult>;
}

export function makeSerpApiClient(
  apiKey: string = requireEnv("SERPAPI_API_KEY"),
): SerpApiClient {
  return {
    async search(keyword, opts = {}) {
      const params = new URLSearchParams({
        engine: "google",
        q: keyword,
        api_key: apiKey,
        gl: opts.gl ?? "us",
        hl: opts.hl ?? "en",
        google_domain: "google.com",
        include_ai_overview: "true",
      });

      const body = await withRetry(async () => {
        const res = await fetch(`${SERPAPI_BASE}?${params.toString()}`);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`SerpAPI ${res.status}: ${text.slice(0, 200)}`);
          (err as unknown as { status: number }).status = res.status;
          throw err;
        }
        return (await res.json()) as SerpApiResponse;
      });

      const features: string[] = [];
      if (body.answer_box) features.push("featured_snippet");
      if (body.knowledge_graph) features.push("knowledge_panel");
      if (body.inline_images) features.push("image_pack");
      if (body.inline_videos) features.push("video_carousel");
      if (body.related_questions?.length) features.push("people_also_ask");
      if (body.ai_overview) features.push("ai_overview");

      const aiCites = body.ai_overview?.references?.map((r) => r.link) ?? [];
      const aiText = body.ai_overview?.text_blocks?.map((b) => b.snippet ?? "").join(" ") ?? null;

      log.info("serp searched", {
        keyword,
        aiOverview: !!body.ai_overview,
        organicResults: body.organic_results?.length ?? 0,
      });

      return {
        keyword,
        topResults: (body.organic_results ?? []).slice(0, 10).map((r) => ({
          url: r.link,
          title: r.title,
          position: r.position,
        })),
        peopleAlsoAsk: (body.related_questions ?? []).map((q) => q.question),
        featuredSnippet: {
          present: !!body.answer_box,
          sourceUrl: body.answer_box?.link ?? null,
        },
        aiOverview: {
          present: !!body.ai_overview,
          cites: aiCites,
          text: aiText && aiText.length > 0 ? aiText.slice(0, 500) : null,
        },
        serpFeatures: features,
      };
    },
  };
}

// ─── Agent tool wrapper ──────────────────────────────────────────────────────

const serpInput = z.object({
  keyword: z.string().min(1),
  gl: z.string().length(2).optional(),
  hl: z.string().length(2).optional(),
});

export function serpSearchTool(client: SerpApiClient): AgentTool<z.infer<typeof serpInput>> {
  return {
    name: "check_serp",
    description:
      "Run a Google SERP query for a target keyword. Returns top 10 organic results, " +
      "People Also Ask questions, featured snippet info, AI Overview presence + citations, " +
      "and other SERP features. Use this for every seed keyword to map the competitive landscape.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string" },
        gl: { type: "string", description: "Country code, default 'us'" },
        hl: { type: "string", description: "Language code, default 'en'" },
      },
      required: ["keyword"],
      additionalProperties: false,
    },
    inputZod: serpInput,
    async execute(input) {
      const result = await client.search(input.keyword, { gl: input.gl, hl: input.hl });
      return JSON.stringify(result);
    },
  };
}
