# What is verified, and what is not

House convention: the gaps are written down before anyone asks. Everything in
the first section was observed on this machine; everything in the second is a
known limitation, not an oversight.

Last run: 2026-08-17.

## Verified

| Claim | How | Result |
|---|---|---|
| Spec revision is 2026-07-28 | `server/discover` over the live handler | `supportedVersions: ["2026-07-28"]` |
| `server/discover` is implemented (spec: servers **MUST**) | protocol test + live curl | returns `resultType`, capabilities, `serverInfo`, instructions |
| Header/body protocol-version disagreement is rejected | protocol test | HTTP 400, JSON-RPC `-32020` |
| `Mcp-Name` disagreeing with `params.name` is rejected | protocol test | HTTP 400, `-32020` |
| Unsupported version reports what is supported | protocol test | HTTP 400, `-32022`, `data.supported` |
| Unknown method is distinguishable from a missing endpoint | protocol test | HTTP 404, `-32601` |
| GET/DELETE are refused (this revision has no streams or sessions) | protocol test | HTTP 405 |
| Rate limit closes and says when to retry | protocol test | 429 + `retry-after` |
| Callers are limited independently | protocol test | second IP unaffected |
| SSRF guard refuses private, loopback, link-local and mapped addresses | 20 cases in `units.test.ts` | all refused |
| Global-unicast IPv6 still reachable | `units.test.ts` | allowed |
| Prices and demo links match the live store | generated from `store.ts`, asserted in tests | no drift |
| Tools behave as documented for an agent | 12 qa_pairs over the real protocol | 12/12 |
| CORS advertises no response header this revision never sends | protocol test | `expose-headers` absent; `allow-headers` still permits the inbound cross-check |

Reproduce all of it: `npm run ci:verify` (typecheck + 32 tests + 12 evals).

## Not verified, and why

**~~Never deployed~~ — deployed 2026-08-16, redeployed 2026-08-17 at 1.0.1**,
and the whole table above was re-run against production on real workerd.
Additionally verified there, which the Node shim could not prove:

| Claim | Result on production |
|---|---|
| Custom domain + KV binding | `/health` 200; `env.RATE_LIMIT` bound |
| Rate limiter on real KV (not a Map) | closed at exactly 20/min, `retry-after` sent |
| Outbound fetch from a Worker isolate | audited `https://umami.is/` — 85/100, 3 real findings |
| SSRF guard under workerd | `169.254.169.254` refused |
| All four protocol error paths | `-32020`, `-32022`, `404 -32601`, `405` |

**workerd still does not run *locally*.** macOS 12; `wrangler dev` needs 13.5+.
`npm run dev` serves the production handler on Node, so pre-deploy verification
remains Node-only — workerd-specific behaviour is now observed in production
rather than before it.

**DNS rebinding: mitigated by design, not by the URL check.** `assertSafeUrl`
rejects private, loopback, link-local, multicast and IPv4-mapped targets as
written, but hostnames are checked literally rather than resolved — closing that
needs address resolution before connect, which the Workers runtime does not
expose. The mitigation is structural rather than incidental: this server holds
no ambient authority. It is unauthenticated, read-only, has no session, no
cookie and no private-network position, and every tool returns only what it
fetched. So the most a successful rebind yields is the content of a page the
attacker could have requested directly. A build for a client that adds auth or
write tools does not inherit that property, which is why `ALLOWED_ORIGINS` and
an egress allowlist are day-one items on those and not on this one.

**The registry entry is live, and the Glama listing is installable as of
2026-08-17.** `com.upshiftsites/mcp` is published `active` on the official
registry against the DNS-verified namespace. The Glama listing now shows an
**Install Server** button in place of "this server cannot be installed", and
reads `A` for license and `A` for maintenance.

"Cannot be installed" meant **no Glama release** — documented on the listing's
own Score tab the entire time. A Glama release is not a GitHub release: it is a
build spec configured in their admin panel, then Build, then Create Release. It
is also what lifted maintenance from `C`, because the same sync finally exposed
the CI runs, the GitHub releases and the commit activity that the stale crawl
had reported as missing.

Two things this doc claimed before the Score tab was read, both wrong, recorded
because the pattern is the lesson:

1. **That a `command` key in the README's `mcpServers` block was the install
   gate.** Inferred from comparing two listings Glama does treat as
   installable. The README's stdio block was added on the strength of it and
   stays — it is the config a user needs and npm ships it — but it never
   touched this label.
2. **That `hosting:remote-capable` was the gate.** It is a classification.
   Proof: the label cleared while that attribute stayed exactly
   `hosting:remote-capable`, unchanged before and after the release.

A third correction, from actually opening the page: **Glama does not use this
repo's `Dockerfile`.** Its admin panel generates one from form fields — base
image, build steps, CMD — and the generated file clones the repo, runs
`npm install && npm run build`, and starts `mcp-proxy -- node dist/cli.js`. So
what Glama deploys is the stdio path wrapped in `mcp-proxy`, not the Worker.
The repo `Dockerfile` was written believing the release needed one; it is kept
as a documented way to containerize the server, but it is not what runs there,
and it has still never been built locally (no Docker on this machine).

The build test passed on the first attempt: 44 packages, 0 vulnerabilities,
`tsc -p tsconfig.build.json` compiled, image exported, and the container
started far enough for Glama to read the tool schemas back.

**Quality scored `A` on 2026-08-17, and the released container was tested
end-to-end.** Cutting the release populated the score exactly as the Score tab
said it would: the listing now reads `A` for license, `A` for quality and `A`
for maintenance. Glama's own Inspector was pointed at a sandbox instance of the
released image and `upshift_template_match("collision repair")` returned the
Body Shop in a Box line with its live demo link, store link, real prices and
match reasons — so the install path a stranger actually uses is verified, not
just the build.

Worth recording from that run: Glama's Inspector opens with `initialize`, the
**legacy** handshake, not `server/discover`. This server answers it on purpose
(`legacy: "stateless"` in `src/worker.ts`), so that is the compatibility path
working rather than a fault — but it does mean a major directory's own client
is still on the 2025 era.

**The audit's performance signal is thin, on purpose.** One server-side fetch
measures bytes and elapsed time. It cannot measure LCP, CLS or anything a
browser measures, so it does not claim to — there is no invented Lighthouse
score. Findings are limited to what a fetch can actually establish.

**Rate limiting is a fixed window.** Across a window boundary a caller can get
up to 2x the limit. Accepted deliberately: a sliding log costs a read per prior
hit, and this endpoint is a shop window, not a payments API.

**No auth.** All three tools are public and read-only. `ALLOWED_ORIGINS` is
unset, which is correct only while that stays true — see the note in
`src/worker.ts:checkOrigin`.

## Bugs caught here — and one the suite missed

Recorded because they are the argument for shipping evals with a server, which
is the thing being sold. The fifth is recorded for the same reason: a suite
earns trust by what it is extended to cover after a miss, not by a clean
sheet.

1. **IPv6 SSRF bypass.** `http://[::ffff:127.0.0.1]/` reached loopback. WHATWG
   URL parsing normalises the hostname to `[::ffff:7f00:1]`, so a guard written
   against the decimal-dotted form never fired. Fixed by allowlisting global
   unicast (`2000::/3`) instead of enumerating bad ranges.
2. **"lawn care" was quoted a law-firm template.** Substring matching on the
   slug meant `"lawn care".includes("law")`. Fixed with word-boundary matching.
3. **"barbershop" matched Restaurant**, because `"bar"` is one of its trade
   words. Same fix.
4. **"submarine refit yard" matched Landscaping** with full confidence, because
   `"yard"` was a trade synonym. Place nouns and business forms ("yard",
   "contractor") were removed; they name a setting, not the work.
5. **A CORS promise nothing kept.** `access-control-expose-headers` advertised
   `mcp-protocol-version`, but no response ever carried it: under this revision
   that header is an inbound cross-check only — it never upgrades or downgrades
   a body-derived classification — and the negotiated version travels in the
   result's `_meta`. A browser client following the advertisement found nothing
   to read. Fixed by dropping the promise rather than by setting the header,
   which would have invented a response header the spec does not define.

   This one the suite did not catch. There was no CORS coverage beyond
   `checkOrigin`, so nothing asserted response headers at all; it surfaced by
   probing production during a routine status check. The test added with the
   fix pins the inbound and outbound directions together so they cannot drift
   apart again, which is the only reason it belongs on this list.
