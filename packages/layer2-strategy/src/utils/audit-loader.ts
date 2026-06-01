import { readText, readJson, fileExists } from "@rynk/core";
import { AuditFindingsSchema, type AuditFindings } from "@rynk/core";
import type { AuditInputForPrompt } from "../prompts/strategy-prompt.js";

/**
 * Load an audit input. Supports both Layer 1 JSON (preferred) and legacy
 * Perplexity .md (fallback). Returns shape Layer 2 can consume.
 */
export function loadAuditInput(path: string): AuditInputForPrompt {
  if (!fileExists(path)) throw new Error(`Audit file not found: ${path}`);

  if (path.endsWith(".json")) {
    const raw = readJson<unknown>(path);
    // Validate the shape so a malformed Layer 1 file is caught here, not by
    // the model. If validation fails we still pass the content through (the
    // model is robust), but we surface the issues as a warning.
    const result = AuditFindingsSchema.safeParse(raw);
    if (!result.success) {
      const preview = result.error.issues
        .slice(0, 5)
        .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      process.stderr.write(
        `⚠ Audit JSON did not match Layer 1 schema (continuing anyway):\n${preview}\n`,
      );
    }
    return {
      content: JSON.stringify(raw, null, 2),
      format: "json",
    };
  }

  if (path.endsWith(".md")) {
    const content = readText(path);
    if (content.length < 500) {
      throw new Error(`Audit file too short (${content.length} chars): ${path}`);
    }
    return { content, format: "markdown" };
  }

  throw new Error(`Unsupported audit file extension: ${path} (use .json or .md)`);
}

export type { AuditFindings };
