/**
 * Layer 2 output validation test.
 * Reads the latest strategy.json under ../../../runs and validates structure
 * + business rules. Run: npm test (from packages/layer2-strategy)
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { readJson, StrategyOutputSchema, moduleDir } from "@rynk/core";

const RUNS_ROOT = resolve(moduleDir(import.meta.url), "../../../runs");

function findLatestStrategy(): string {
  // Walk runs/{domain}/{date}/strategy.json — pick the most recently modified.
  const candidates: { path: string; mtime: number }[] = [];
  try {
    for (const domain of readdirSync(RUNS_ROOT)) {
      const domainDir = join(RUNS_ROOT, domain);
      if (!statSync(domainDir).isDirectory()) continue;
      for (const date of readdirSync(domainDir)) {
        const file = join(domainDir, date, "strategy.json");
        try {
          const stat = statSync(file);
          if (stat.isFile()) candidates.push({ path: file, mtime: stat.mtimeMs });
        } catch {
          // Skip if file doesn't exist
        }
      }
    }
  } catch {
    throw new Error(`No runs directory at ${RUNS_ROOT}. Run the agent first.`);
  }
  if (candidates.length === 0) throw new Error("No strategy.json found in runs/");
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.path;
}

function header(title: string): void {
  process.stdout.write(`\n📋 ${title}\n\n`);
}

function check(condition: boolean, msg: string): { ok: boolean } {
  process.stdout.write(condition ? `  ✓ ${msg}\n` : `  ✗ FAIL: ${msg}\n`);
  return { ok: condition };
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? findLatestStrategy();
  process.stdout.write(`Testing: ${path}\n`);

  const raw = readJson<unknown>(path);
  const parsed = StrategyOutputSchema.safeParse(raw);

  header("Schema validation");
  const schemaOk = check(parsed.success, "Output matches StrategyOutputSchema").ok;
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) {
      process.stdout.write(`    • ${issue.path.join(".")}: ${issue.message}\n`);
    }
    process.exit(1);
  }

  const out = parsed.data;
  let failed = 0;
  const test = (cond: boolean, msg: string): void => {
    if (!check(cond, msg).ok) failed++;
  };

  header("Content quality");
  test(out.topicClusterMap.length >= 3, `>= 3 topic clusters (got ${out.topicClusterMap.length})`);
  test(out.contentBriefs.length >= 5, `>= 5 content briefs (got ${out.contentBriefs.length})`);
  test(out.sprintPlan.sprints.length >= 3, `>= 3 sprints (got ${out.sprintPlan.sprints.length})`);
  test(
    out.contentBriefs.every((b) => b.secondaryKeywords.length >= 8),
    "All briefs have >= 8 secondary keywords",
  );
  test(
    out.contentBriefs.every((b) => {
      const inb = b.internalLinks.filter((l) => l.direction === "inbound").length;
      const outb = b.internalLinks.filter((l) => l.direction === "outbound").length;
      return inb >= 3 && outb >= 3;
    }),
    "All briefs have >= 3 inbound and >= 3 outbound internal links",
  );

  header("Intent classification");
  const commercial = out.contentBriefs.filter(
    (b) => b.intent === "commercial" || b.intent === "transactional",
  );
  test(commercial.length > 0, `>= 1 commercial/transactional brief (got ${commercial.length})`);

  header("E-E-A-T enforcement");
  const ymyl = out.contentBriefs.filter((b) => b.eeatRequirements.isYMYL);
  if (ymyl.length > 0) {
    test(
      ymyl.every((b) => b.eeatRequirements.needsReviewer),
      `All YMYL briefs require reviewer (${ymyl.length} YMYL briefs)`,
    );
    test(
      ymyl.every((b) => b.eeatRequirements.primarySourcesToCite.length > 0),
      "All YMYL briefs cite primary sources",
    );
  } else {
    process.stdout.write(`  ℹ No YMYL briefs flagged\n`);
  }

  header("GEO/AEO targeting");
  test(
    out.contentBriefs.some((b) => b.geoRequirements.needsFAQBlock),
    ">= 1 brief targets FAQ/AEO",
  );
  test(
    out.contentBriefs.some((b) => b.geoRequirements.needsDirectAnswer),
    ">= 1 brief targets AI Overview extraction",
  );

  header("Sprint sequencing");
  const firstSprintTasksLower = out.sprintPlan.sprints[0]?.tasks.join(" ").toLowerCase() ?? "";
  const techKeywords = ["7t", "privacy", "entity", "about", "technical", "p1", "fix"];
  test(
    techKeywords.some((k) => firstSprintTasksLower.includes(k)),
    "First sprint addresses technical/P1 issues before content",
  );

  process.stdout.write(`\n${"─".repeat(50)}\n`);
  if (failed === 0 && schemaOk) {
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
