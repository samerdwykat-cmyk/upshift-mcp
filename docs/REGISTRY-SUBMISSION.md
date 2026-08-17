# Listing the server — and the Registry Launch runbook

Two documents in one. The checklist below is what we do for *this* server, and
it is also the delivery procedure for the $149 **Registry Launch** product.
Time each step the first time through: that timing is the margin math, and
right now the $149 price is a guess.

`server.json` is written and validates against the live schema
(`2025-12-11`). Everything else is blocked on the first deploy.

## Blocked until deployed

Every listing below wants a URL that answers. `mcp.upshiftsites.com` does not
resolve yet, so submitting now would list a dead endpoint — worse than not
listing. Deploy first (see README), then work down this list.

## 1 · Official MCP registry

The one that matters; the others largely mirror it.

```bash
# The publisher CLI reads server.json from the repo root.
npx @modelcontextprotocol/publisher login dns --domain upshiftsites.com
npx @modelcontextprotocol/publisher publish
```

**The gate is namespace ownership.** `com.upshiftsites/mcp` requires proving
control of `upshiftsites.com` via a DNS TXT record. That is an owner action —
same shape as the GSC verification already done for the agency site, so the
record lives alongside it.

Verify after publishing:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=upshift" | python3 -m json.tool
```

**For a client:** if they own the domain, DNS verification is cleanest. If they
would rather not touch DNS, the GitHub-namespace route
(`io.github.<org>/<repo>`) verifies through repo ownership instead and needs
nothing from their infrastructure team. Ask which they prefer *before* writing
`server.json` — the namespace is baked into the `name` field and changing it
later means republishing under a new identity.

## 2 · Glama

<https://glama.ai/mcp/servers> — indexes public repos automatically but ranks
far better with a submitted entry. Needs: repo URL, a one-line description, and
the remote URL. Glama scores servers on documentation and licence presence, so
the README and a LICENSE file are the levers.

## 3 · PulseMCP

<https://www.pulsemcp.com/submit> — a form: name, description, URL, category,
and whether it is remote or local. Fast; done in a few minutes.

## 4 · awesome-mcp-servers

A PR against the list. One line, alphabetised within its section, matching the
surrounding format exactly. Read the contributing rules first — the common
rejection is a description that sells rather than describes.

## 5 · Stripe Directory

Listed as a business rather than a server. Separate from the above and only
worth the time if the MCP line proves out.

## Checklist

- [ ] Deployed and answering at `https://mcp.upshiftsites.com/mcp`
- [ ] DNS TXT record for `upshiftsites.com` (owner action)
- [ ] `server.json` validates — `curl` the schema and check it locally
- [ ] Published to the official registry; confirmed by search
- [ ] Glama
- [ ] PulseMCP
- [ ] awesome-mcp-servers PR opened
- [ ] Stripe Directory
- [ ] **Each step timed, and the total written into the Registry Launch margin
      note** — $149 is unpriced guesswork until this number exists

## What to reuse for a client

1. Ask which namespace they want (DNS vs GitHub) before writing anything.
2. Write `server.json` against the current schema — check
   `https://static.modelcontextprotocol.io/schemas/` for the newest, do not
   copy the version out of an old example.
3. Read the version from their `package.json` at release rather than
   hand-copying it. A `server.json` whose version has drifted is how a registry
   entry quietly starts describing a build nobody runs. This is the detail
   worth charging for; everything else is form-filling.
4. Smoke-test from a clean client against the *published* entry, not localhost.
5. Send them the registry URL plus the catalog links as the deliverable.
