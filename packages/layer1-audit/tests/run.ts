/**
 * Layer 1 output validation.
 * Reads the most recent runs/<domain>/<date>/audit.json and asserts:
 *   - Schema validity (AuditFindingsSchema)
 *   - Plan success-criteria checks (entity contamination detected, NAP split,
 *     zero G2 reviews for client, etc. — these are domain-specific and only
 *     run for itechdata.ai)
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { readJson, AuditFindingsSchema, moduleDir } from "@rynk/core";

const RUNS_ROOT = resolve(moduleDir(import.meta.url), "../../../runs");

function findLatestAudit(): string {
  const candidates: { path: string; mtime: number }[] = [];
  try {
    for (const domain of readdirSync(RUNS_ROOT)) {
      const domainDir = join(RUNS_ROOT, domain);
      if (!statSync(domainDir).isDirectory()) continue;
      for (const date of readdirSync(domainDir)) {
        const file = join(domainDir, date, "audit.json");
        try {
          const stat = statSync(file);
          if (stat.isFile()) candidates.push({ path: file, mtime: stat.mtimeMs });
        } catch {
          // file missing — skip
        }
      }
    }
  } catch {
    throw new Error(`No runs/ directory at ${RUNS_ROOT}. Run Layer 1 first.`);
  }
  if (candidates.length === 0) throw new Error("No audit.json found in runs/");
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.path;
}

function header(title: string): void {
  process.stdout.write(`\n📋 ${title}\n\n`);
}

function check(condition: boolean, msg: string): boolean {
  process.stdout.write(condition ? `  ✓ ${msg}\n` : `  ✗ FAIL: ${msg}\n`);
  return condition;
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? findLatestAudit();
  process.stdout.write(`Testing: ${path}\n`);

  const raw = readJson<unknown>(path);
  const parsed = AuditFindingsSchema.safeParse(raw);

  header("Schema validation");
  if (!parsed.success) {
    process.stdout.write("  ✗ FAIL: Output did not match AuditFindingsSchema\n");
    for (const issue of parsed.error.issues.slice(0, 10)) {
      process.stdout.write(`    • ${issue.path.join(".")}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("  ✓ Output matches AuditFindingsSchema\n");

  const f = parsed.data;
  let failed = 0;
  const test = (cond: boolean, msg: string): void => {
    if (!check(cond, msg)) failed++;
  };

  header("Required structure");
  test(f.technicalCrawl.sitemapUrls.length > 0, "Sitemap was crawled (>= 1 URL)");
  test(Object.keys(f.technicalCrawl.performance).length > 0, "Performance data captured for >= 1 template");
  test(f.serpData.byKeyword.length > 0, "SERP data collected for >= 1 keyword");
  test(f.prioritizedIssues.p1.length + f.prioritizedIssues.p2.length + f.prioritizedIssues.p3.length > 0, "At least one prioritized issue found");
  test(f.entitySummary.legalEntityName.length > 0, "Legal entity name is set");

  // ── Domain-specific success criteria for the iTech Data baseline ──
  if (f.domain === "itechdata.ai") {
    header("iTech Data baseline (from the plan)");

    const allP1Titles = f.prioritizedIssues.p1.map((i) => i.title.toLowerCase()).join(" | ");
    test(
      f.technicalCrawl.entityContamination.length > 0 ||
        allP1Titles.includes("7t") ||
        allP1Titles.includes("entity contamination") ||
        allP1Titles.includes("contamination"),
      "7T entity contamination detected and flagged",
    );

    const privacy = f.onsiteEEAT.policyPages.privacyPolicy;
    test(
      privacy.exists === false || privacy.correctEntity === false,
      "Privacy Policy issue detected (missing OR wrong entity)",
    );

    const napInconsistencies = f.onsiteEEAT.napConsistency.inconsistenciesFound;
    test(napInconsistencies.length > 0, "NAP inconsistency detected across templates");

    const g2 = f.offsiteEEAT.reviewPlatforms.g2;
    test(
      g2.profileExists === false || (g2.reviewCount ?? 0) < 5,
      "G2 presence absent or near-zero for client",
    );

    const aiOverviewSeen = f.serpData.byKeyword.some((k) => k.aiOverviewPresent);
    test(aiOverviewSeen, "AI Overview presence confirmed for at least one target keyword");
  }

  process.stdout.write(`\n${"─".repeat(50)}\n`);
  if (failed === 0) {
    process.stdout.write("\n✅ All tests passed.\n\n");
  } else {
    process.stdout.write(`\n⚠ ${failed} test(s) failed.\n\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`\n❌ Test runner failed: ${(err as Error).message}\n`);
  process.exit(1);
});
