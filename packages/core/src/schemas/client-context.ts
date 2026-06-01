import { z } from "zod";

export const TeamContextSchema = z.object({
  hasDev: z.boolean(),
  hasContent: z.boolean(),
  hasMarketing: z.boolean(),
  hasLegal: z.boolean(),
  notes: z.string().optional(),
});

export const SprintContextSchema = z.object({
  cadence: z.enum(["weekly", "biweekly", "monthly"]),
  budget: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
});

export const CanonicalNAPSchema = z.object({
  // All NAP fields are nullable — address/phone are commonly unknown for new clients,
  // and a missing field must never block a pipeline run.
  address: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
});

export const FounderSchema = z.object({
  name: z.string(),
  credentials: z.array(z.string()),
});

export const ClientContextSchema = z.object({
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "domain must be bare host like 'example.com'"),
  legalEntity: z.string().default(""),
  relatedEntities: z.array(z.string()).default([]),
  canonicalNAP: CanonicalNAPSchema,
  industry: z.string(),
  verticals: z.array(z.string()),
  icp: z.string(),
  founder: FounderSchema.optional(),
  certificationsClaimed: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  goals: z.array(z.string()),
  team: TeamContextSchema,
  sprint: SprintContextSchema,
  seedKeywords: z.array(z.string()).default([]),
  knownIssues: z.array(z.string()).default([]),
  cms: z.string().nullable().default(null),
  hosting: z.string().nullable().default(null),
  cdn: z.string().nullable().default(null),
});

export type TeamContext = z.infer<typeof TeamContextSchema>;
export type SprintContext = z.infer<typeof SprintContextSchema>;
export type CanonicalNAP = z.infer<typeof CanonicalNAPSchema>;
export type Founder = z.infer<typeof FounderSchema>;
export type ClientContext = z.infer<typeof ClientContextSchema>;
