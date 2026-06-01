/**
 * Terminal display + human confirmation for the onboarding review step.
 *
 * Displays a compact summary table of the extracted ClientContext, highlights
 * fields that used defaults (team, sprint, goals), then prompts the human to
 * accept (Y/Enter) or decline (N). On decline the pipeline exits cleanly so
 * the human can edit client.json and re-run.
 */

import { createInterface } from "node:readline";
import type { ClientContext } from "@rynk/core";

// ── Display ───────────────────────────────────────────────────────────────────

const WIDTH = 66;
const LABEL_W = 18;

function line(label: string, value: string, warn = false): void {
  const warnMark = warn ? " ⚠" : "";
  const labelPad = label.padEnd(LABEL_W);
  // Truncate long values to keep the table tidy in narrow terminals.
  const maxVal = WIDTH - LABEL_W - 6;
  const display = value.length > maxVal ? `${value.slice(0, maxVal - 1)}…` : value;
  process.stdout.write(`  ${labelPad}${display}${warnMark}\n`);
}

function section(title: string): void {
  const dashes = "─".repeat(WIDTH - title.length - 4);
  process.stdout.write(`\n  ── ${title} ${dashes}\n`);
}

function divider(): void {
  process.stdout.write(`  ${"─".repeat(WIDTH)}\n`);
}

/**
 * Print a formatted summary of the extracted ClientContext to stdout.
 * Fields that used defaults are flagged with ⚠.
 */
export function displayClientSummary(
  ctx: ClientContext,
  jsonPath: string,
  mdPath: string,
): void {
  const isDefault = (notes: string | undefined): boolean =>
    notes?.includes("[DEFAULT]") ?? false;

  const teamIsDefault = isDefault(ctx.team.notes);
  const sprintIsDefault = isDefault(ctx.sprint.notes);
  const goalsAreDefault = ctx.goals.includes("Increase organic search visibility");

  process.stdout.write("\n");
  process.stdout.write(`  ${"╔"}${"═".repeat(WIDTH)}${"╗"}\n`);
  process.stdout.write(`  ║  ${"rynk.ai — Client Onboarding Review".padEnd(WIDTH - 2)}║\n`);
  process.stdout.write(`  ${"╚"}${"═".repeat(WIDTH)}${"╝"}\n\n`);

  line("Domain", ctx.domain);
  line("Legal Entity", ctx.legalEntity);
  line("Industry", ctx.industry);
  if (ctx.cms) line("CMS", ctx.cms);
  if (ctx.hosting) line("Hosting", ctx.hosting);

  section("NAP");
  line("Address", ctx.canonicalNAP.address ?? "(unknown)");
  line("Phone", ctx.canonicalNAP.phone ?? "(unknown)");
  line("Email", ctx.canonicalNAP.email ?? "(unknown)");

  section("Business");
  line("Verticals", ctx.verticals.slice(0, 3).join(" / ") + (ctx.verticals.length > 3 ? ` (+${ctx.verticals.length - 3} more)` : ""));
  line("Competitors", ctx.competitors.slice(0, 3).join(", ") + (ctx.competitors.length > 3 ? ` (+${ctx.competitors.length - 3} more)` : ""));
  if (ctx.certificationsClaimed.length > 0) {
    line("Certifications", ctx.certificationsClaimed.join(", "));
  }
  if (ctx.founder) {
    line("Founder", ctx.founder.name);
  }
  line("Seed Keywords", `${ctx.seedKeywords.length} keywords`);
  line("Goals", goalsAreDefault ? "defaults — review required" : `${ctx.goals.length} goals`, goalsAreDefault);

  section("Team & Sprint" + (teamIsDefault || sprintIsDefault ? " [DEFAULTS — REVIEW REQUIRED]" : ""));
  line("Has Dev", ctx.team.hasDev ? "yes" : "false", teamIsDefault && !ctx.team.hasDev);
  line("Has Content", ctx.team.hasContent ? "yes" : "false", teamIsDefault && !ctx.team.hasContent);
  line("Has Marketing", ctx.team.hasMarketing ? "yes" : "false", teamIsDefault && !ctx.team.hasMarketing);
  line("Has Legal", ctx.team.hasLegal ? "yes" : "false", teamIsDefault && !ctx.team.hasLegal);
  line("Sprint Cadence", ctx.sprint.cadence, sprintIsDefault);
  line("Budget Tier", ctx.sprint.budget, sprintIsDefault);

  if (ctx.knownIssues.length > 0) {
    section("Known Issues");
    for (const issue of ctx.knownIssues.slice(0, 5)) {
      process.stdout.write(`  • ${issue.slice(0, WIDTH - 2)}\n`);
    }
    if (ctx.knownIssues.length > 5) {
      process.stdout.write(`  … and ${ctx.knownIssues.length - 5} more (see client.md)\n`);
    }
  }

  section("Files");
  line("JSON", jsonPath);
  line("Markdown", mdPath);

  divider();

  if (teamIsDefault || sprintIsDefault || goalsAreDefault) {
    process.stdout.write(
      `\n  ⚠  Fields marked ⚠ used defaults. Edit ${jsonPath}\n` +
        `     and re-run to apply your changes (pipeline will skip re-onboarding).\n`,
    );
  }

  process.stdout.write("\n");
}

// ── Confirmation prompt ───────────────────────────────────────────────────────

/**
 * Ask the human to accept or decline the extracted profile.
 *
 * Default is Y (press Enter to accept). Returns true if accepted, false if
 * declined (the caller should exit cleanly, not throw).
 */
export async function promptForConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("  Accept and run pipeline? [Y/n]: ", (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      // Empty string (just Enter) or explicit "y"/"yes" → accept.
      resolve(trimmed === "" || trimmed === "y" || trimmed === "yes");
    });
  });
}
