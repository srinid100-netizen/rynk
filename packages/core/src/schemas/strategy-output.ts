import { z } from "zod";
import {
  CategorySchema,
  EffortSchema,
  OwnerSchema,
  SeveritySchema,
  coerceBool,
  coerceNonnegInt,
  coerceNumber,
  coerceString,
  coerceStringOrNull,
} from "./audit-findings.js";

export const SearchIntentSchema = z.enum([
  "informational",
  "commercial",
  "transactional",
  "navigational",
]);

export const WhenSchema = z.enum(["now", "30d", "60d", "90d+"]);

export const TopicClusterSchema = z.object({
  name: coerceString,
  pillarKeyword: coerceString,
  spokeKeywords: z.array(coerceString),
  // Drop min/max — model occasionally outputs 0 or 11. Clamp downstream if needed.
  businessValueScore: coerceNumber,
  difficultyScore: coerceNumber,
  priorityScore: coerceNumber,
  clientStatus: z.enum(["owned", "gap", "partial"]),
  competitorUrls: z.array(coerceString),
});

export const InternalLinkSchema = z.object({
  direction: z.enum(["inbound", "outbound"]),
  targetUrl: coerceString,
  anchorText: coerceString,
});

export const EEATRequirementsSchema = z.object({
  signalsNeeded: z.array(coerceString),
  needsReviewer: coerceBool,
  isYMYL: coerceBool,
  primarySourcesToCite: z.array(coerceString),
});

export const GEORequirementsSchema = z.object({
  needsFAQBlock: coerceBool,
  needsDirectAnswer: coerceBool,
  schemaType: coerceString,
  needsQuotableSentences: coerceBool,
});

export const CompetitorTargetSchema = z.object({
  url: coerceString,
  estimatedDepth: z.enum(["brief", "medium", "comprehensive"]),
  contentElementsTheyHave: z.array(coerceString),
  serpFeaturesCaptured: z.array(coerceString),
});

export const ContentBriefSchema = z.object({
  id: coerceString,
  targetKeyword: coerceString,
  // Drop .min(8) — model doesn't always hit exactly 8 secondary keywords.
  secondaryKeywords: z.array(coerceString),
  intent: SearchIntentSchema,
  recommendedFormat: coerceString,
  h1Suggestion: coerceString,
  h2Suggestions: z.array(coerceString),
  // Default 1000 if missing/unparseable so a numeric output is always produced.
  wordCountTarget: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return 1000;
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const m = v.match(/\d+/);
        return m ? parseInt(m[0]!, 10) : 1000;
      }
      return 1000;
    },
    z.number().int().positive(),
  ),
  competitorUrlsToOutperform: z.array(CompetitorTargetSchema),
  internalLinks: z.array(InternalLinkSchema),
  eeatRequirements: EEATRequirementsSchema,
  geoRequirements: GEORequirementsSchema,
  ctaInstruction: coerceString,
  publishPriority: WhenSchema,
});

export const CannibalFixPlanSchema = z.object({
  cluster: coerceString,
  canonicalUrl: coerceString,
  // "update" added — model uses it synonymously with "expand".
  urlActions: z.record(
    z.string(),
    z.enum(["301", "noindex", "expand", "consolidate", "keep", "update"]),
  ),
});

export const RoadmapItemSchema = z.object({
  title: coerceString,
  priority: SeveritySchema,
  category: CategorySchema,
  owner: OwnerSchema,
  effort: EffortSchema,
  when: WhenSchema,
  successSignal: coerceString,
});

export const GapMissingPageSchema = z.object({
  missingTopic: coerceString,
  competitorUrl: coerceString,
  competitorEstimatedDepth: z.enum(["brief", "medium", "comprehensive"]),
  competitorContentElements: z.array(coerceString),
  serpFeaturesCaptured: z.array(coerceString),
  recommendedAction: coerceString,
});

export const GapReportSchema = z.object({
  missingPagesVsCompetitors: z.array(GapMissingPageSchema),
  quickWins: z.array(coerceString),
  serpFeaturesAbsentFrom: z.array(coerceString),
  aiOverviewOpportunities: z.array(coerceString),
});

export const AuthorityRoadmapSchema = z.object({
  reviewPlatformSequence: z.array(coerceString),
  prPitchTargets: z.array(coerceString),
  trustCenterSpec: coerceString,
  schemaDeployOrder: z.array(coerceString),
  linkOpportunities: z.array(coerceString),
});

export const SprintSchema = z.object({
  label: coerceString,
  goal: coerceString,
  tasks: z.array(coerceString),
  successSignal: coerceString,
});

export const ContentInventoryActionSchema = z.object({
  url: coerceString,
  title: coerceString,
  wordCount: coerceNonnegInt,
  recommendedAction: z.enum(["keep", "update", "consolidate", "301", "noindex", "expand"]),
  // Allow object-shaped values from the model — stringify them.
  consolidationTarget: z.preprocess(
    (v) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v)),
    coerceStringOrNull,
  ),
  reason: coerceString,
});

export const DoNotModifyItemSchema = z.object({
  url: coerceString,
  reason: coerceString,
});

export const StrategyOutputSchema = z.object({
  domain: coerceString,
  generatedAt: coerceString,
  topicClusterMap: z.array(TopicClusterSchema),
  contentBriefs: z.array(ContentBriefSchema),
  cannibalizationFixes: z.array(CannibalFixPlanSchema),
  publishingRoadmap: z.object({ items: z.array(RoadmapItemSchema) }),
  gapReport: GapReportSchema,
  authorityRoadmap: AuthorityRoadmapSchema,
  sprintPlan: z.object({ sprints: z.array(SprintSchema) }),
  contentInventory: z.array(ContentInventoryActionSchema),
  doNotModify: z.array(DoNotModifyItemSchema),
});

export type SearchIntent = z.infer<typeof SearchIntentSchema>;
export type When = z.infer<typeof WhenSchema>;
export type TopicCluster = z.infer<typeof TopicClusterSchema>;
export type InternalLink = z.infer<typeof InternalLinkSchema>;
export type EEATRequirements = z.infer<typeof EEATRequirementsSchema>;
export type GEORequirements = z.infer<typeof GEORequirementsSchema>;
export type CompetitorTarget = z.infer<typeof CompetitorTargetSchema>;
export type ContentBrief = z.infer<typeof ContentBriefSchema>;
export type CannibalFixPlan = z.infer<typeof CannibalFixPlanSchema>;
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;
export type GapMissingPage = z.infer<typeof GapMissingPageSchema>;
export type GapReport = z.infer<typeof GapReportSchema>;
export type AuthorityRoadmap = z.infer<typeof AuthorityRoadmapSchema>;
export type Sprint = z.infer<typeof SprintSchema>;
export type ContentInventoryAction = z.infer<typeof ContentInventoryActionSchema>;
export type DoNotModifyItem = z.infer<typeof DoNotModifyItemSchema>;
export type StrategyOutput = z.infer<typeof StrategyOutputSchema>;
