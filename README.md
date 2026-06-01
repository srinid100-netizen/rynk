# rynk.ai

AI-powered SEO pipeline: **Audit → Strategy → Generate → Publish → Monitor**

---

## Setup

```bash
npm install                  # install dependencies
cp .env.example .env         # copy env template, then fill in your API keys
```

**Required keys in `.env`:**
- `ANTHROPIC_API_KEY` — Claude (all layers)
- `PAGESPEED_API_KEY` — Google PageSpeed Insights (Layer 1)
- `SERPAPI_API_KEY` — SERP + AI Overview data (Layer 1)
- `CRAWL4AI_BASE_URL` — defaults to `http://localhost:11235` (start Docker first)

**Start the crawler:**
```bash
docker run -d -p 11235:11235 --name crawl4ai unclecode/crawl4ai:latest
```

---

## Commands

```bash
# Run the full pipeline for a domain (onboards if new, then Layer 1 → Layer 2)
npm run pipeline -- example.com

# Force re-run onboarding even if the client profile already exists
npm run pipeline -- example.com --force-onboard

# Skip Layer 1 entirely and re-run Layer 2 from the last saved audit
REUSE_AUDIT=true npm run pipeline -- example.com

# Re-run just the synthesiser using already-saved raw crawl data (skips crawling)
REUSE_RAW=true npm run pipeline -- example.com

# Run Layer 1 (audit) only
npm run layer1 -- example.com

# Run Layer 2 (strategy) only, from a saved audit.json
npm run layer2 -- runs/example.com/2026-05-18/audit.json

# Type-check all packages
npm run typecheck

# Run tests
npm test --workspace=@rynk/layer1-audit
npm test --workspace=@rynk/layer2-strategy
```

---

## Output

Each run writes files to `runs/<domain>/<date>/`:

| File | What it is |
|---|---|
| `audit.json` | Structured audit findings (technical, EEAT, SERP, content) |
| `audit.md` | Human-readable version of the audit |
| `strategy.json` | Full strategy output (briefs, sprint plan, cluster map) |
| `strategy.md` | Human-readable version of the strategy |

---

## Project layout

```
packages/
  core/             shared types, Anthropic client, agent runner, logger
  layer1-audit/     crawl + SERP + PageSpeed + synthesis → audit.json
  layer2-strategy/  content strategy + briefs + sprint plan → strategy.json
  layer3-generate/  (coming) content generation
  layer4-publish/   (coming) CMS publishing
  layer5-monitor/   (coming) rank tracking
  orchestrator/     runs the full pipeline end-to-end
```
