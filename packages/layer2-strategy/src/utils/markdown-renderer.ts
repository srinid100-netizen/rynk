import type {
  ContentBrief,
  CompetitorTarget,
  GapMissingPage,
  StrategyOutput,
} from "@rynk/core";

function renderCompetitor(c: CompetitorTarget): string {
  const elements = c.contentElementsTheyHave.join(", ") || "not specified";
  const serp = c.serpFeaturesCaptured.join(", ") || "none";
  return `  - **${c.url}**\n    - Depth: ${c.estimatedDepth}\n    - They have: ${elements}\n    - SERP features: ${serp}`;
}

function renderGapEntry(gap: GapMissingPage): string {
  const elements = gap.competitorContentElements.join(", ") || "not specified";
  const serp = gap.serpFeaturesCaptured.join(", ") || "none";
  return `- **${gap.missingTopic}**\n  - Competitor: ${gap.competitorUrl} (${gap.competitorEstimatedDepth})\n  - They have: ${elements}\n  - SERP features: ${serp}\n  - Action: ${gap.recommendedAction}`;
}

function renderBrief(brief: ContentBrief): string[] {
  const lines: string[] = [];
  const inbound = brief.internalLinks.filter((l) => l.direction === "inbound");
  const outbound = brief.internalLinks.filter((l) => l.direction === "outbound");
  const eeat = brief.eeatRequirements;
  const geo = brief.geoRequirements;

  lines.push(`### [${brief.publishPriority.toUpperCase()}] ${brief.targetKeyword}`);
  lines.push(`- **Intent:** ${brief.intent}`);
  lines.push(`- **Format:** ${brief.recommendedFormat}`);
  lines.push(`- **H1:** ${brief.h1Suggestion}`);
  lines.push(`- **Word count:** ~${brief.wordCountTarget}`);
  lines.push(`- **H2 suggestions:** ${brief.h2Suggestions.join(" / ")}`);
  lines.push(`- **Secondary keywords:** ${brief.secondaryKeywords.join(", ")}`);

  if (brief.competitorUrlsToOutperform.length > 0) {
    lines.push("- **Competitors to beat:**");
    for (const c of brief.competitorUrlsToOutperform) lines.push(renderCompetitor(c));
  }

  lines.push(`- **Internal links:** ${brief.internalLinks.length} defined`);
  if (outbound.length > 0) {
    lines.push("  - Outbound:");
    for (const l of outbound) lines.push(`    - [${l.anchorText}](${l.targetUrl})`);
  }
  if (inbound.length > 0) {
    lines.push("  - Inbound (pages that should link here):");
    for (const l of inbound) lines.push(`    - [${l.anchorText}](${l.targetUrl})`);
  }

  lines.push(`- **E-E-A-T:**`);
  lines.push(`  - YMYL: ${eeat.isYMYL}`);
  lines.push(`  - Reviewer required: ${eeat.needsReviewer}`);
  lines.push(`  - Signals needed: ${eeat.signalsNeeded.join(", ") || "none specified"}`);
  lines.push(`  - Primary sources: ${eeat.primarySourcesToCite.join(", ") || "none"}`);

  lines.push(`- **GEO/AEO:**`);
  lines.push(`  - FAQ block: ${geo.needsFAQBlock}`);
  lines.push(`  - Direct answer: ${geo.needsDirectAnswer}`);
  lines.push(`  - Schema type: ${geo.schemaType}`);
  lines.push(`  - Quotable sentences: ${geo.needsQuotableSentences}`);

  lines.push(`- **CTA:** ${brief.ctaInstruction}`);
  lines.push("");
  return lines;
}

export function strategyOutputToMarkdown(output: StrategyOutput): string {
  const lines: string[] = [];

  lines.push(`# rynk.ai Strategy Report — ${output.domain}`);
  lines.push(`\nGenerated: ${output.generatedAt}\n`);
  lines.push("---\n");

  lines.push("## 30/60/90-Day Sprint Plan\n");
  for (const sprint of output.sprintPlan.sprints) {
    lines.push(`### ${sprint.label}`);
    lines.push(`**Goal:** ${sprint.goal}`);
    lines.push(`**Success signal:** ${sprint.successSignal}\n`);
    for (const task of sprint.tasks) lines.push(`- ${task}`);
    lines.push("");
  }

  lines.push("---\n## Topic Cluster Map\n");
  for (const c of output.topicClusterMap) {
    lines.push(`### ${c.name}`);
    lines.push(`- **Pillar keyword:** ${c.pillarKeyword}`);
    lines.push(
      `- **Business value:** ${c.businessValueScore}/10 | **Difficulty:** ${c.difficultyScore}/10 | **Priority:** ${c.priorityScore}/10`,
    );
    lines.push(`- **Client status:** ${c.clientStatus}`);
    lines.push(`- **Spoke keywords:** ${c.spokeKeywords.join(", ")}`);
    lines.push("");
  }

  lines.push("---\n## Gap Report\n");
  lines.push("### Missing pages vs competitors\n");
  for (const g of output.gapReport.missingPagesVsCompetitors) lines.push(renderGapEntry(g));
  lines.push("\n### Quick wins");
  for (const w of output.gapReport.quickWins) lines.push(`- ${w}`);
  lines.push("\n### SERP features absent from");
  for (const f of output.gapReport.serpFeaturesAbsentFrom) lines.push(`- ${f}`);
  lines.push("\n### AI Overview / GEO opportunities");
  for (const o of output.gapReport.aiOverviewOpportunities) lines.push(`- ${o}`);

  lines.push("\n---\n## Publishing Roadmap\n");
  lines.push("| # | Task | Priority | Category | Owner | Effort | When | Success Signal |");
  lines.push("|---|------|----------|----------|-------|--------|------|----------------|");
  output.publishingRoadmap.items.forEach((item, i) => {
    lines.push(
      `| ${i + 1} | ${item.title} | ${item.priority} | ${item.category} | ${item.owner} | ${item.effort} | ${item.when} | ${item.successSignal} |`,
    );
  });

  lines.push("\n---\n## Cannibalization Fix Plan\n");
  for (const fix of output.cannibalizationFixes) {
    lines.push(`### ${fix.cluster}`);
    lines.push(`**Keep (canonical):** ${fix.canonicalUrl}`);
    lines.push("**Actions per URL:**");
    for (const [url, action] of Object.entries(fix.urlActions)) {
      lines.push(`- \`${url}\` → **${action}**`);
    }
    lines.push("");
  }

  lines.push("---\n## Authority & E-E-A-T Roadmap\n");
  lines.push("### Review platform sequence");
  for (const p of output.authorityRoadmap.reviewPlatformSequence) lines.push(`- ${p}`);
  lines.push("\n### PR pitch targets");
  for (const p of output.authorityRoadmap.prPitchTargets) lines.push(`- ${p}`);
  if (output.authorityRoadmap.trustCenterSpec) {
    lines.push(`\n### Trust center spec\n${output.authorityRoadmap.trustCenterSpec}`);
  }
  lines.push("\n### Schema deploy order");
  for (const s of output.authorityRoadmap.schemaDeployOrder) lines.push(`- ${s}`);
  if (output.authorityRoadmap.linkOpportunities.length > 0) {
    lines.push("\n### Link opportunities");
    for (const l of output.authorityRoadmap.linkOpportunities) lines.push(`- ${l}`);
  }

  lines.push("\n---\n## Content Briefs\n");
  lines.push(
    `_${output.contentBriefs.length} briefs generated. Each brief is consumed by the Generation Agent (Layer 3)._\n`,
  );
  for (const brief of output.contentBriefs) {
    lines.push(...renderBrief(brief));
  }

  if (output.contentInventory.length > 0) {
    lines.push("---\n## Content Inventory\n");
    lines.push("| URL | Title | Words | Action | Target | Reason |");
    lines.push("|-----|-------|-------|--------|--------|--------|");
    for (const item of output.contentInventory) {
      const target = item.consolidationTarget ?? "—";
      const title = item.title.slice(0, 50);
      lines.push(
        `| ${item.url} | ${title} | ${item.wordCount} | **${item.recommendedAction}** | ${target} | ${item.reason} |`,
      );
    }
  }

  if (output.doNotModify.length > 0) {
    lines.push("\n---\n## Do Not Modify\n");
    for (const item of output.doNotModify) {
      lines.push(`- **${item.url}** — ${item.reason}`);
    }
  }

  return lines.join("\n");
}
