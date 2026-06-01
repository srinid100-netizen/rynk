import type { AuditFindings, AuditIssue } from "@rynk/core";

function renderIssue(prefix: string, issue: AuditIssue): string[] {
  const lines: string[] = [];
  lines.push(`### ${prefix} ${issue.id} — ${issue.title}`);
  lines.push(`- **Category:** ${issue.category}`);
  lines.push(`- **Owner:** ${issue.owner} | **Effort:** ${issue.effort}`);
  lines.push(`- ${issue.description}`);
  if (issue.evidenceUrls.length > 0) {
    lines.push(`- Evidence: ${issue.evidenceUrls.map((u) => `\`${u}\``).join(", ")}`);
  }
  lines.push(`- **Fix:** ${issue.fixInstruction}`);
  lines.push("");
  return lines;
}

export function auditFindingsToMarkdown(findings: AuditFindings): string {
  const lines: string[] = [];

  lines.push(`# rynk.ai Audit Findings — ${findings.domain}`);
  lines.push(`Generated: ${findings.auditDate}`);
  lines.push(`Schema version: ${findings.auditVersion}\n`);
  lines.push("---\n");

  // ── Prioritized issues ──
  const { p1, p2, p3 } = findings.prioritizedIssues;
  lines.push(`## Prioritized issues (${p1.length} P1 / ${p2.length} P2 / ${p3.length} P3)\n`);

  if (p1.length > 0) {
    lines.push("### P1 — fix before publishing anything\n");
    for (const i of p1) lines.push(...renderIssue("P1 ·", i));
  }
  if (p2.length > 0) {
    lines.push("### P2 — fix within 30 days\n");
    for (const i of p2) lines.push(...renderIssue("P2 ·", i));
  }
  if (p3.length > 0) {
    lines.push("### P3 — fix within 60–90 days\n");
    for (const i of p3) lines.push(...renderIssue("P3 ·", i));
  }

  // ── Entity summary ──
  lines.push("\n---\n## Entity summary\n");
  lines.push(`- **Legal entity:** ${findings.entitySummary.legalEntityName}`);
  lines.push(`- **Related entities:** ${findings.entitySummary.relatedEntities.join(", ") || "none"}`);
  lines.push(
    `- **Canonical NAP:** ${findings.entitySummary.canonicalNAP.address} | ${findings.entitySummary.canonicalNAP.phone} | ${findings.entitySummary.canonicalNAP.email}`,
  );
  if (findings.entitySummary.inconsistenciesFound.length > 0) {
    lines.push("- **Inconsistencies found:**");
    for (const i of findings.entitySummary.inconsistenciesFound) lines.push(`  - ${i}`);
  }

  // ── Technical crawl summary ──
  const tc = findings.technicalCrawl;
  lines.push("\n---\n## Technical crawl summary\n");
  lines.push(`- URLs crawled: **${tc.sitemapUrls.length}**`);
  lines.push(`- Missing meta descriptions: ${tc.missingMetas.length}`);
  lines.push(`- Duplicate metas: ${tc.duplicateMetas.length} groups`);
  lines.push(`- H1 issues: ${tc.h1Issues.length}`);
  lines.push(`- Missing image alts: ${tc.missingImageAlts.length} pages`);
  lines.push(`- Entity contamination: ${tc.entityContamination.length} pages`);
  lines.push(`- robots.txt issues: ${tc.robotsTxt.issues.length}`);
  lines.push(`- llms.txt: ${tc.llmsTxtStatus}`);

  if (Object.keys(tc.performance).length > 0) {
    lines.push("\n### Performance (per template)\n");
    lines.push("| Template | LCP (s) | CLS | TBT (ms) |");
    lines.push("|---|---|---|---|");
    for (const [label, m] of Object.entries(tc.performance)) {
      lines.push(`| ${label} | ${m.lcp ?? "—"} | ${m.cls ?? "—"} | ${m.tbt ?? "—"} |`);
    }
  }

  // ── Onsite E-E-A-T ──
  const onsite = findings.onsiteEEAT;
  lines.push("\n---\n## Onsite E-E-A-T\n");
  lines.push("### Policy pages");
  for (const [name, p] of Object.entries(onsite.policyPages)) {
    const entity =
      "correctEntity" in p && p.correctEntity !== undefined
        ? p.correctEntity
          ? " (correct entity)"
          : " (WRONG ENTITY)"
        : "";
    lines.push(`- **${name}:** ${p.exists ? `exists @ ${p.url ?? "?"}` : "MISSING"}${entity}`);
  }
  lines.push("\n### Author audit");
  lines.push(`- Named human authors: ${onsite.authorAudit.namedHumanAuthors}`);
  if (onsite.authorAudit.genericAuthorLabel) {
    lines.push(`- Generic author label in use: \`${onsite.authorAudit.genericAuthorLabel}\``);
  }
  lines.push(`- Publish year visible: ${onsite.authorAudit.publishYearVisible}`);

  if (onsite.napConsistency.inconsistenciesFound.length > 0) {
    lines.push("\n### NAP inconsistencies");
    for (const i of onsite.napConsistency.inconsistenciesFound) lines.push(`- ${i}`);
  }

  // ── Offsite E-E-A-T ──
  const offsite = findings.offsiteEEAT;
  lines.push("\n---\n## Offsite E-E-A-T\n");
  lines.push("### Review platforms");
  for (const [platform, p] of Object.entries(offsite.reviewPlatforms)) {
    lines.push(
      `- **${platform}:** ${p.profileExists ? `${p.reviewCount ?? "?"} reviews @ ${p.url ?? "?"}` : "no profile"}`,
    );
  }
  if (Object.keys(offsite.competitors).length > 0) {
    lines.push("\n### Competitor review footprint");
    for (const [comp, data] of Object.entries(offsite.competitors)) {
      const g2 = data.g2?.reviewCount ?? "?";
      const cl = data.clutch?.reviewCount ?? "?";
      const cap = data.capterra?.reviewCount ?? "?";
      lines.push(`- **${comp}:** G2 ${g2} · Clutch ${cl} · Capterra ${cap}`);
    }
  }

  // ── SERP data ──
  if (findings.serpData.byKeyword.length > 0) {
    lines.push("\n---\n## SERP visibility\n");
    lines.push("| Keyword | AI Overview | Featured Snippet | Client appears? |");
    lines.push("|---|---|---|---|");
    for (const kw of findings.serpData.byKeyword) {
      const clientHit = kw.topRankingUrls.some((u) => u.includes(findings.domain));
      lines.push(
        `| ${kw.keyword} | ${kw.aiOverviewPresent ? "yes" : "—"} | ${kw.featuredSnippet.present ? "yes" : "—"} | ${clientHit ? "yes" : "—"} |`,
      );
    }
  }

  // ── Content inventory ──
  if (findings.contentInventory.length > 0) {
    lines.push("\n---\n## Content inventory\n");
    lines.push(`Total URLs catalogued: ${findings.contentInventory.length}`);
    lines.push(`Thin pages: ${findings.contentInventory.filter((c) => c.isThin).length}`);
    lines.push(`Off-topic pages: ${findings.contentInventory.filter((c) => c.isOffTopic).length}`);
  }

  // ── Cannibalization ──
  if (findings.cannibalizationClusters.length > 0) {
    lines.push("\n---\n## Cannibalization clusters\n");
    for (const c of findings.cannibalizationClusters) {
      lines.push(`### ${c.topic}`);
      lines.push(`Canonical: \`${c.suggestedCanonical}\``);
      for (const u of c.urls) lines.push(`- ${u}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
