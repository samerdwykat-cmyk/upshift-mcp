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

Or run the same server locally, for clients that spawn a command rather than
call a URL. Nothing to clone or build — it is published on npm:

```json
{
  "mcpServers": {
    "upshift": { "command": "npx", "args": ["-y", "upshift-mcp"] }
  }
}
```

The same binary from a shell. stdio is the default; `--http` serves the full
Worker on localhost instead:

```bash
npx upshift-mcp
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
test/            32 tests: protocol conformance + the pure logic
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

**Live since 2026-08-16** at `https://mcp.upshiftsites.com/mcp`. KV namespace
and custom domain are provisioned; `npm run deploy` ships a new version.

## Listed

- Official MCP registry: `com.upshiftsites/mcp`, published `active` against
  the DNS-verified namespace.
- [Glama](https://glama.ai/mcp/servers/samerdwykat-cmyk/upshift-mcp) —
  approved 2026-08-16.
- npm: [`upshift-mcp`](https://www.npmjs.com/package/upshift-mcp) —
  `npx upshift-mcp` runs this same server locally.

<a href="https://glama.ai/mcp/servers/samerdwykat-cmyk/upshift-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/samerdwykat-cmyk/upshift-mcp/badge" alt="Upshift MCP server on Glama" />
</a>

## Honest gaps

In [docs/VALIDATION.md](docs/VALIDATION.md) — what is verified, what is not,
and the four real bugs the eval suite caught during the build (one of them a
security bypass). That document is the argument for shipping evals alongside a
server, which is the part of this we sell.

## Licence

MIT. Lift anything useful. If you would rather we built and ran it for you,
that is at <https://upshiftsites.com/store/mcp-server-service/>.
