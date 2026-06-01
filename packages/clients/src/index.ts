import type { ClientContext } from "@rynk/core";

/**
 * Registry of statically-configured client contexts, keyed by domain.
 *
 * This is intentionally empty — all clients are onboarded automatically via
 * the onboarding agent (packages/orchestrator/src/onboarding/) which writes
 * runs/{domain}/client.json on first run.
 *
 * To add a client here manually (e.g. for a locked-down production config),
 * create a sibling .ts file and register it:
 *
 *   import { myClientContext } from "./myclient.js";
 *   export const clientRegistry: Record<string, ClientContext> = {
 *     "myclient.com": myClientContext,
 *   };
 */
export const clientRegistry: Record<string, ClientContext> = {};

export function getClientByDomain(domain: string): ClientContext {
  const c = clientRegistry[domain];
  if (!c) {
    throw new Error(
      `Unknown client domain: "${domain}". ` +
        `Run the pipeline once to onboard: tsx packages/orchestrator/src/index.ts ${domain}`,
    );
  }
  return c;
}
