/**
 * File-system helpers for onboarding client profiles.
 *
 * Path convention:
 *   runs/{safeDomain}/client.json   — stable identity file (no date prefix)
 *   runs/{safeDomain}/client.md     — human-readable review copy
 *
 * Note: audit/strategy artifacts use a date-prefixed path
 * (runs/{domain}/{date}/audit.json). The client profile is intentionally
 * stable — it persists across pipeline re-runs and is the file the human
 * edits after onboarding.
 */

import { resolve } from "node:path";
import {
  ensureDir,
  writeJson,
  writeText,
  readJson,
  fileExists,
  ClientContextSchema,
  type ClientContext,
} from "@rynk/core";

// ── Path helpers ──────────────────────────────────────────────────────────────

function safeDomainSlug(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/gi, "_");
}

export function clientJsonPath(runsDir: string, domain: string): string {
  return resolve(runsDir, safeDomainSlug(domain), "client.json");
}

export function clientMdPath(runsDir: string, domain: string): string {
  return resolve(runsDir, safeDomainSlug(domain), "client.md");
}

// ── Existence + load ──────────────────────────────────────────────────────────

export function clientJsonExists(runsDir: string, domain: string): boolean {
  return fileExists(clientJsonPath(runsDir, domain));
}

/**
 * Load and Zod-validate an existing client.json.
 * Throws if the file is missing, malformed JSON, or fails schema validation —
 * all are actionable errors the human can fix by editing the file.
 */
export function loadClientJson(runsDir: string, domain: string): ClientContext {
  const path = clientJsonPath(runsDir, domain);
  const raw = readJson<unknown>(path);
  const result = ClientContextSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `client.json at ${path} failed schema validation. Fix the file and re-run:\n${issues}`,
    );
  }
  return result.data;
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Write the ClientContext as JSON. Creates the parent directory if needed.
 * Returns the absolute path written.
 */
export function saveClientJson(runsDir: string, domain: string, ctx: ClientContext): string {
  const path = clientJsonPath(runsDir, domain);
  ensureDir(resolve(runsDir, safeDomainSlug(domain)));
  return writeJson(path, ctx);
}

/**
 * Write a human-readable Markdown review file.
 * Returns the absolute path written.
 */
export function saveClientMd(runsDir: string, domain: string, ctx: ClientContext): string {
  const path = clientMdPath(runsDir, domain);
  ensureDir(resolve(runsDir, safeDomainSlug(domain)));
  return writeText(path, renderClientMd(ctx));
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderClientMd(ctx: ClientContext): string {
  const now = new Date().toISOString();
  const defaultFields = [
    ...(ctx.team.notes?.includes("[DEFAULT]") ? ["team (hasDev/hasContent/hasMarketing/hasLegal)"] : []),
    ...(ctx.sprint.notes?.includes("[DEFAULT]") ? ["sprint (cadence/budget)"] : []),
    ...(ctx.goals.includes("Increase organic search visibility") ? ["goals"] : []),
  ];

  const defaultWarning =
    defaultFields.length > 0
      ? `\n> ⚠️ **Fields marked [DEFAULT] were not extractable from the public site — please correct them before running the pipeline.**\n> Fields to review: ${defaultFields.join(", ")}\n`
      : "";

  const row = (label: string, value: string): string =>
    `| ${label.padEnd(20)} | ${value} |`;

  const boolIcon = (v: boolean): string => (v ? "✅ yes" : "❌ no (DEFAULT)");

  return `# Client Profile: ${ctx.domain}

Generated: ${now}
${defaultWarning}
---

## Identity

| Field                | Value |
|----------------------|-------|
${row("Domain", ctx.domain)}
${row("Legal Entity", ctx.legalEntity)}
${row("Industry", ctx.industry)}
${ctx.cms ? row("CMS", ctx.cms) : ""}
${ctx.hosting ? row("Hosting", ctx.hosting) : ""}

## Canonical NAP

| Field   | Value |
|---------|-------|
${row("Address", ctx.canonicalNAP.address ?? "")}
${row("Phone", ctx.canonicalNAP.phone ?? "")}
${row("Email", ctx.canonicalNAP.email ?? "")}

${
  ctx.relatedEntities.length > 0
    ? `## Related Entities\n\n${ctx.relatedEntities.map((e) => `- ${e}`).join("\n")}\n`
    : ""
}
## ICP (Ideal Customer Profile)

${ctx.icp}

## Verticals

${ctx.verticals.map((v) => `- ${v}`).join("\n")}

${
  ctx.founder
    ? `## Founder\n\n**${ctx.founder.name}**\n\n${ctx.founder.credentials.map((c) => `- ${c}`).join("\n")}\n`
    : ""
}
## Competitors

${ctx.competitors.map((c) => `- ${c}`).join("\n")}

${
  ctx.certificationsClaimed.length > 0
    ? `## Certifications Claimed\n\n${ctx.certificationsClaimed.map((c) => `- ${c}`).join("\n")}\n`
    : ""
}
## Seed Keywords

${ctx.seedKeywords.length > 0 ? ctx.seedKeywords.map((k) => `- ${k}`).join("\n") : "_None extracted — add manually._"}

## Goals

${ctx.goals.map((g) => `- ${g}`).join("\n")}

## Team & Sprint ⚠️ [REVIEW REQUIRED — DEFAULTS USED]

| Field          | Value |
|----------------|-------|
${row("Has Dev", boolIcon(ctx.team.hasDev))}
${row("Has Content", boolIcon(ctx.team.hasContent))}
${row("Has Marketing", boolIcon(ctx.team.hasMarketing))}
${row("Has Legal", boolIcon(ctx.team.hasLegal))}
${ctx.team.notes ? row("Notes", ctx.team.notes) : ""}
${row("Sprint Cadence", ctx.sprint.cadence)}
${row("Budget Tier", ctx.sprint.budget)}
${ctx.sprint.notes ? row("Sprint Notes", ctx.sprint.notes) : ""}

## Known Issues

${
  ctx.knownIssues.length > 0
    ? ctx.knownIssues.map((i) => `- ${i}`).join("\n")
    : "_None observed during onboarding. Layer 1 audit will surface issues._"
}

---

_Edit this file or \`client.json\` in the same directory, then re-run the pipeline._
`.replace(/^\n{2,}/gm, "\n");
}
