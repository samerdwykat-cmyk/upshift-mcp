# upshift-mcp

Upshift's reference MCP server. Three tools, deployed remote, on MCP spec
revision **2026-07-28**.

It exists to do two jobs at once: be genuinely useful to an agent, and be the
worked example a buyer looks at before paying us to build theirs. Every price
it quotes is generated from the live store, so it cannot invent one.

```
https://mcp.upshiftsites.com/mcp
```

```json
{
  "mcpServers": {
    "upshift": { "type": "http", "url": "https://mcp.upshiftsites.com/mcp" }
  }
}
```

## Tools

| Tool | Does |
|---|---|
| `upshift_site_audit(url)` | Fetches a live page and reports structured data, llms.txt, robots.txt, title and meta budgets, headings, alt-text coverage, HTTPS and document weight, with a 0-100 score and a fix for each finding. |
| `upshift_template_match(industry, needs?)` | Ranks the 14 website template lines against a trade, with live demo links, store links and real prices, and explains why each matched. |
| `upshift_quote(job_type, scope?)` | The real price table for MCP server work and for websites. |

Free and rate limited to 20 calls/minute per IP.

## Layout

```
src/
  worker.ts      Cloudflare entrypoint: routing, origin policy, rate limit
  server.ts      The three tools; the one place production layers are applied
  audit.ts       Audit rules — pure, so every rule is testable without a network
  safe-fetch.ts  The SSRF guard for the one tool that takes a caller's URL
  match.ts       Template matching
  services.ts    What we charge for MCP work
  catalog.generated.ts   Template lines + prices, generated from the store
  landing.ts     The page a human gets at /
evals/           12 qa_pairs, run over the real protocol
test/            30 tests: protocol conformance + the pure logic
```

## Working on it

```bash
npm install
npm run dev          # http://127.0.0.1:8788/mcp
npm run ci:verify    # typecheck + tests + evals
```

`wrangler dev` needs macOS 13.5+ and will not boot on the build machine, so
`npm run dev` serves the *production* `src/worker.ts` on Node against an
in-memory KV. Same handler, same routes, same tools — not a second
implementation. Deployment is still `wrangler deploy`.

Prices come from `../upshift-agency-site/src/data/store.ts`. After changing
them there:

```bash
npm run gen:catalog
```

## Deploying

Never been deployed. Before the first `wrangler deploy`:

1. `npx wrangler kv namespace create RATE_LIMIT`, paste the id into
   `wrangler.jsonc`.
2. Point `mcp.upshiftsites.com` at the Worker (the route is declared, the DNS
   record is not).
3. `npm run ci:verify`, then `npm run deploy`.
4. Publish `server.json` to the registry — which needs DNS verification of
   `upshiftsites.com` for the `com.upshiftsites` namespace first.

## Honest gaps

In [docs/VALIDATION.md](docs/VALIDATION.md), including the four real bugs the
eval suite caught during the build — which is the argument for shipping evals
with a server, and the thing we sell.
