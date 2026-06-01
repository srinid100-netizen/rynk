import { z } from "zod";

// ─── LLM output coercion helpers ─────────────────────────────────────────────
// LLMs frequently emit strings where numbers/booleans are expected ("47 reviews",
// "multiple", "N/A"). These helpers parse what's parseable and fall back safely
// instead of crashing schema validation. Use these for any field the model
// produces — the only exception is when you genuinely want strict validation
// (e.g. pre-computed values from code we control).

// Extract a numeric value from any input. Returns null if unparseable.
function parseToNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || /^(n\/a|none|unknown|null|multiple|several|many|undefined)$/i.test(s)) return null;
    const match = s.match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]!) : null;
  }
  return null;
}

// Coerce to number (non-nullable). Unparseable values become 0 so the field
// never crashes. Use for required count/score fields.
export const coerceNumber = z.preprocess((v) => parseToNumber(v) ?? 0, z.number());

// Coerce to number-or-null. Use for fields that may genuinely be unknown.
export const coerceNumberOrNull = z.preprocess((v) => parseToNumber(v), z.number().nullable());

// Coerce to integer (non-nullable, defaults to 0).
export const coerceInt = z.preprocess(
  (v) => Math.trunc(parseToNumber(v) ?? 0),
  z.number().int(),
);

// Coerce to nonnegative integer (non-nullable, defaults to 0).
export const coerceNonnegInt = z.preprocess(
  (v) => Math.max(0, Math.trunc(parseToNumber(v) ?? 0)),
  z.number().int().nonnegative(),
);

// Coerce null/undefined → false. Keeps actual booleans untouched.
export const coerceBool = z.preprocess(
  (v) => (v === null || v === undefined ? false : v),
  z.boolean(),
);

// Coerce any value to a non-null string. null/undefined become "". Numbers
// and booleans are stringified. Use for required text fields the LLM might null.
export const coerceString = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  },
  z.string(),
);

// Coerce to string-or-null. Empty strings stay as empty strings (don't lose info).
export const coerceStringOrNull = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  },
  z.string().nullable(),
);

// Backwards-compatible alias for the previous reviewCount helper.
const coerceReviewCount = coerceNumberOrNull;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const CategorySchema = z.enum([
  "technical",
  "onsite-eeat",
  "offsite-eeat",
  "content",
  "schema",
  "legal",
]);
export const OwnerSchema = z.enum(["dev", "content", "marketing", "legal", "seo"]);
export const EffortSchema = z.enum(["S", "M", "L"]);
export const PrioritySchema = z.enum(["P1", "P2", "P3"]);

// ─── Technical crawl ─────────────────────────────────────────────────────────

export const SitemapUrlSchema = z.object({
  url: z.string().url(),
  statusCode: coerceInt,
  canonical: coerceStringOrNull,
  noindex: coerceBool,
  title: coerceStringOrNull,
  metaDescription: coerceStringOrNull,
  h1Count: coerceNonnegInt,
  h1Text: z.array(coerceString),
  wordCount: coerceNonnegInt,
  internalLinks: z.array(coerceString),
  schemaTypes: z.array(coerceString),
});

export const PerformanceMetricsSchema = z.object({
  lcp: coerceNumberOrNull.describe("Largest Contentful Paint in seconds"),
  cls: coerceNumberOrNull.describe("Cumulative Layout Shift, unitless"),
  tbt: coerceNumberOrNull.describe("Total Blocking Time in milliseconds"),
  topBlockingResources: z.array(
    z.object({ url: coerceString, transferSizeKb: coerceNumber }),
  ),
});

export const RobotsTxtSchema = z.object({
  // Nullable: robots.txt may be unreachable or agent may set null when missing.
  content: z.string().nullable(),
  sitemapsListed: z.array(z.string()),
  disallowRules: z.array(z.string()),
  issues: z.array(z.string()),
});

export const TechnicalCrawlSchema = z.object({
  sitemapUrls: z.array(SitemapUrlSchema),
  missingMetas: z.array(z.object({ url: coerceString, title: coerceStringOrNull })),
  duplicateMetas: z.array(z.object({ metaDescription: coerceStringOrNull, urls: z.array(coerceString) })),
  duplicateTitles: z.array(z.object({ title: coerceString, urls: z.array(coerceString) })),
  h1Issues: z.array(z.object({ url: coerceString, h1Count: coerceNumber, h1Text: z.array(coerceString) })),
  headingHierarchySkips: z.array(z.object({ url: coerceString, skip: coerceString })),
  missingImageAlts: z.array(
    z.object({ url: coerceString, missingCount: coerceNumber, examples: z.array(coerceString) }),
  ),
  internalRedirectedLinks: z.array(
    z.object({ sourceUrl: coerceString, href: coerceString, finalUrl: coerceString }),
  ),
  longUrls: z.array(z.object({ url: coerceString, length: coerceNumber })),
  schemaPresent: z.record(z.string(), z.array(z.string())),
  schemaMissing: z.array(z.string()),
  // Values can be string, string[], or objects — model varies its output shape.
  schemaTemplates: z.record(z.string(), z.unknown()).default({}),
  performance: z.record(z.string(), PerformanceMetricsSchema),
  robotsTxt: RobotsTxtSchema,
  llmsTxtStatus: coerceString,
  entityContamination: z.array(z.object({ url: coerceString, issue: coerceString, evidence: coerceString })),
  offTopicPages: z.array(z.object({ url: coerceString, title: coerceString, reason: coerceString })),
  urlArchitecture: z.object({
    patterns: z.array(coerceString),
    inconsistencies: z.array(coerceString),
    rootLevelServicePages: z.array(coerceString),
  }),
});

// ─── Onsite E-E-A-T ──────────────────────────────────────────────────────────

export const PolicyPageSchema = z.object({
  exists: coerceBool,
  url: z.string().nullable(),
  // Model frequently returns null when it cannot determine entity match.
  correctEntity: z.boolean().nullable().optional(),
  issues: z.array(z.string()).default([]),
});

export const NAPRecordSchema = z.object({
  // Use .default(null) so a missing key (not just null) is also accepted.
  address: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
});

export const OnsiteEEATSchema = z.object({
  policyPages: z.object({
    privacyPolicy: PolicyPageSchema,
    termsOfService: PolicyPageSchema,
    cookiePolicy: PolicyPageSchema,
    editorialPolicy: PolicyPageSchema,
  }),
  authorAudit: z.object({
    namedHumanAuthors: coerceBool,
    genericAuthorLabel: z.string().nullable(),
    authorLinkTarget: z.string().nullable(),
    publishYearVisible: coerceBool,
    samplePostsChecked: z.array(z.string()),
  }),
  napConsistency: z.object({
    mainFooter: NAPRecordSchema,
    blogFooter: NAPRecordSchema,
    contactPage: NAPRecordSchema,
    // Model sometimes outputs structured objects instead of strings — coerce.
    inconsistenciesFound: z.array(
      z.preprocess((v) => (typeof v === "string" ? v : JSON.stringify(v)), z.string()),
    ),
  }),
  complianceClaims: z.array(
    z.object({
      claim: coerceString,
      url: coerceString,
      substantiated: coerceBool,
      issues: z.array(z.string()),
    }),
  ),
  ymylPages: z.array(z.object({ url: z.string(), type: z.string(), missingSignals: z.array(z.string()) })),
  dateVisibility: z.object({
    publishYearOnPosts: coerceBool,
    lastUpdatedVisible: coerceBool,
  }),
});

// ─── Offsite E-E-A-T ─────────────────────────────────────────────────────────

export const ReviewPlatformProfileSchema = z.object({
  profileExists: coerceBool,
  url: z.string().nullable(),
  reviewCount: coerceReviewCount,
  // .default(null) so missing key is treated as null (model omits instead of nulling).
  rating: z.coerce.number().nullable().default(null),
  // .nullable() because model outputs null when category is unknown.
  category: z.string().nullable().optional(),
});

export const OffsiteEEATSchema = z.object({
  reviewPlatforms: z.object({
    g2: ReviewPlatformProfileSchema,
    clutch: ReviewPlatformProfileSchema,
    capterra: ReviewPlatformProfileSchema,
    goodFirms: ReviewPlatformProfileSchema,
    gartnerPeerInsights: ReviewPlatformProfileSchema,
  }),
  competitors: z.record(
    z.string(),
    z.object({
      g2: z.object({ reviewCount: coerceReviewCount, rating: z.coerce.number().nullable() }).optional(),
      clutch: z.object({ reviewCount: coerceReviewCount }).optional(),
      capterra: z.object({ reviewCount: coerceReviewCount }).optional(),
      trustSignals: z.array(z.string()).default([]),
    }),
  ),
  gbpStatus: z.object({
    // Coerce null → false: model outputs null when GBP listing can't be confirmed.
    verified: z.preprocess((v) => (v === null ? false : v), z.boolean()),
    address: z.string().nullable(),
    reviewCount: coerceReviewCount,
    categories: z.array(z.string()).default([]),
  }),
  crunchbaseStatus: z.object({
    profileExists: coerceBool,
    url: coerceStringOrNull,
    legalName: coerceStringOrNull,
    foundingYear: coerceNumberOrNull,
    address: coerceStringOrNull,
  }),
  wikidataStatus: z.object({
    entityExists: coerceBool,
    entityId: z.string().nullable(),
  }),
  pressCoverage: z.array(
    z.object({
      publication: coerceString,
      // Nullable: model sets null when URL could not be verified.
      url: z.string().nullable(),
      date: z.string().nullable(),
      summary: coerceString,
      isBrandFocused: coerceBool,
    }),
  ),
  brandCollisions: z.array(
    z.object({
      name: coerceString,
      domain: z.string().nullable(),
      relationship: coerceString,
      searchConfusionRisk: coerceString,
    }),
  ),
  executiveCredentials: z.object({
    name: coerceString,
    awards: z.array(z.string()).default([]),
    associations: z.array(z.string()).default([]),
    speakingCredits: z.array(z.string()).default([]),
    thirdPartyMentions: z.array(z.string()).default([]),
  }),
  napDirectories: z.object({
    linkedin: NAPRecordSchema.optional(),
    zoomInfo: NAPRecordSchema.optional(),
    rocketReach: NAPRecordSchema.optional(),
    yelp: NAPRecordSchema.extend({ entityName: z.string().nullable().default(null) }).optional(),
    inconsistenciesVsCanonical: z.array(z.string()),
  }),
});

// ─── Content inventory + cannibalization + SERP ──────────────────────────────

export const ContentInventoryItemSchema = z.object({
  url: coerceString,
  title: coerceString,
  wordCount: coerceNonnegInt,
  topicCategory: coerceString,
  isThin: coerceBool,
  isOffTopic: coerceBool,
  rankingPosition: coerceNumberOrNull,
});

export const CannibalizationClusterSchema = z.object({
  topic: coerceString,
  urls: z.array(z.string()),
  suggestedCanonical: coerceString,
});

export const SerpKeywordDataSchema = z.object({
  keyword: coerceString,
  aiOverviewPresent: coerceBool,
  aiOverviewCites: z.array(z.string()).default([]),
  peopleAlsoAsk: z.array(z.string()).default([]),
  featuredSnippet: z.object({
    present: coerceBool,
    sourceUrl: z.string().nullable(),
  }),
  topRankingUrls: z.array(z.string()).default([]),
  serpFeatures: z.array(z.string()).default([]),
});

export const CompetitorAnalysisSchema = z.object({
  topRankingPages: z.array(z.string()).default([]),
  contentDepth: z.record(z.string(), coerceString).default({}),
  // Model sometimes outputs a string instead of string[] — coerce to array.
  serpFeatures: z
    .record(
      z.string(),
      z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string())),
    )
    .default({}),
  reviewFootprint: z.record(z.string(), coerceReviewCount).default({}),
  trustSignals: z.array(z.string()).default([]),
});

// ─── Prioritized issues ──────────────────────────────────────────────────────

export const AuditIssueSchema = z.object({
  id: coerceString,
  title: coerceString,
  category: CategorySchema,
  description: coerceString,
  evidenceUrls: z.array(z.string()).default([]),
  fixInstruction: coerceString,
  owner: OwnerSchema,
  effort: EffortSchema,
});

export const PrioritizedIssuesSchema = z.object({
  p1: z.array(AuditIssueSchema),
  p2: z.array(AuditIssueSchema),
  p3: z.array(AuditIssueSchema),
});

// ─── Final Layer 1 output ────────────────────────────────────────────────────

export const EntitySummarySchema = z.object({
  legalEntityName: coerceString,
  relatedEntities: z.array(z.string()),
  canonicalNAP: NAPRecordSchema,
  inconsistenciesFound: z.array(z.string()),
});

export const AuditFindingsSchema = z.object({
  domain: coerceString,
  auditDate: z.string().describe("ISO 8601 timestamp"),
  auditVersion: z.literal("1.0"),

  technicalCrawl: TechnicalCrawlSchema,
  onsiteEEAT: OnsiteEEATSchema,
  offsiteEEAT: OffsiteEEATSchema,

  contentInventory: z.array(ContentInventoryItemSchema),
  cannibalizationClusters: z.array(CannibalizationClusterSchema),

  competitorAnalysis: z.record(z.string(), CompetitorAnalysisSchema),

  serpData: z.object({
    byKeyword: z.array(SerpKeywordDataSchema),
    competitorRankings: z.record(
      z.string(),
      z.object({
        topKeywords: z.array(z.string()).default([]),
        estimatedPositions: z.record(z.string(), coerceNumber).default({}),
      }),
    ),
  }),

  entitySummary: EntitySummarySchema,
  prioritizedIssues: PrioritizedIssuesSchema,
});

export type AuditFindings = z.infer<typeof AuditFindingsSchema>;
export type SitemapUrl = z.infer<typeof SitemapUrlSchema>;
export type TechnicalCrawl = z.infer<typeof TechnicalCrawlSchema>;
export type OnsiteEEAT = z.infer<typeof OnsiteEEATSchema>;
export type OffsiteEEAT = z.infer<typeof OffsiteEEATSchema>;
export type PrioritizedIssues = z.infer<typeof PrioritizedIssuesSchema>;
export type AuditIssue = z.infer<typeof AuditIssueSchema>;
export type ContentInventoryItem = z.infer<typeof ContentInventoryItemSchema>;
export type CannibalizationCluster = z.infer<typeof CannibalizationClusterSchema>;
export type SerpKeywordData = z.infer<typeof SerpKeywordDataSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Owner = z.infer<typeof OwnerSchema>;
export type Effort = z.infer<typeof EffortSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
