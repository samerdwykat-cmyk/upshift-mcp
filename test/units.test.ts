/**
 * The pure halves: URL guard, audit rules, template matching, rate limiter.
 * No network, no Worker — these are the rules, checked one at a time.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertSafeUrl, UnsafeUrlError } from "../src/safe-fetch.ts";
import { analyze, parseJsonLd, type AuditInput } from "../src/audit.ts";
import { matchTemplates } from "../src/match.ts";
import { checkRateLimit, MemoryCounterStore } from "../src/ratelimit.ts";
import { SERVICES, priceLabel } from "../src/services.ts";
import { SERVER_INFO } from "../src/server.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* ------------------------------- version ------------------------------- */

/**
 * The version lives in four places and nothing at runtime notices when they
 * disagree — which is exactly how the deployed Worker once served 1.0.0 while
 * npm and the registry both said 1.0.1. `SERVER_INFO` is a hardcoded constant,
 * so `npm version` moves package.json and the lockfile and silently leaves the
 * other two behind. This is the check that fails instead.
 */
test("every version source agrees with package.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (f: string) => JSON.parse(readFileSync(join(here, f), "utf8"));
  const pkg = read("../package.json");
  const lock = read("../package-lock.json");
  const server = read("../server.json");

  assert.equal(SERVER_INFO.version, pkg.version, "src/server.ts SERVER_INFO is hardcoded — bump it too");
  assert.equal(lock.version, pkg.version, "package-lock.json");
  assert.equal(lock.packages?.[""]?.version, pkg.version, 'package-lock.json packages[""]');
  assert.equal(server.version, pkg.version, "server.json");
  assert.equal(
    server.packages?.[0]?.version,
    pkg.version,
    "server.json packages[].version — the registry reads this one",
  );
});

/* ------------------------------ URL guard ------------------------------ */

test("assertSafeUrl refuses everything that is not a public http(s) site", () => {
  const refused = [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://127.0.0.1/",
    "http://127.9.9.9/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://0.0.0.0/",
    "http://localhost:8080/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/",
    "https://user:secret@example.com/",
    "not-a-url",
  ];
  for (const url of refused) {
    assert.throws(() => assertSafeUrl(url), UnsafeUrlError, `should refuse ${url}`);
  }
});

test("assertSafeUrl allows ordinary public sites, including 172.x outside the private block", () => {
  for (const url of [
    "https://example.com/",
    "http://example.com/path?q=1",
    "https://sub.domain.example.co.uk/a/b",
    "http://172.15.0.1/", // just below the private range
    "http://172.32.0.1/", // just above it
    "http://8.8.8.8/",
    "http://[2606:4700:4700::1111]/", // global unicast IPv6 is a real site
    "http://[2001:db8::1]/",
  ]) {
    assert.doesNotThrow(() => assertSafeUrl(url), `should allow ${url}`);
  }
});

test("IPv6 loopback is refused however the URL parser spells it", () => {
  // The parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, so a guard written
  // against the dotted form alone lets loopback through. Both must fail.
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:c0a8:101]/"]) {
    assert.throws(() => assertSafeUrl(url), UnsafeUrlError, `should refuse ${url}`);
  }
});

/* -------------------------------- audit -------------------------------- */

const baseInput = (html: string, over: Partial<AuditInput> = {}): AuditInput => ({
  finalUrl: "https://example.com/",
  status: 200,
  html,
  bytes: html.length,
  elapsedMs: 120,
  redirects: 0,
  contentType: "text/html",
  llmsTxt: { present: true, status: 200 },
  robotsTxt: { present: true, status: 200, sample: "User-agent: *\nAllow: /" },
  ...over,
});

const GOOD = `<!doctype html><html><head>
<title>Ace Collision — Auto Body Repair in Dayton, Ohio</title>
<meta name="description" content="Collision repair, paint and frame straightening in Dayton. I-CAR certified, free estimates, lifetime warranty on workmanship.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"Ace Collision","telephone":"+1-937-555-0100","address":{"@type":"PostalAddress","streetAddress":"1 Main St"},"openingHours":"Mo-Fr 08:00-17:00"}</script>
</head><body><h1>Auto body repair in Dayton</h1><img src="a.jpg" alt="Repaired bumper"></body></html>`;

test("a well-formed page scores high and reports no critical findings", () => {
  const report = analyze(baseInput(GOOD));
  assert.equal(report.reachable, true);
  assert.equal(report.findings.filter((f) => f.severity === "critical").length, 0);
  assert.ok(report.score >= 95, `expected a high score, got ${report.score}`);
  assert.ok(report.structuredData.types.includes("AutoRepair"));
});

test("a bare page reports every missing fundamental", () => {
  const report = analyze(baseInput("<html><body><p>hi</p></body></html>"));
  const ids = report.findings.filter((f) => f.severity !== "ok").map((f) => f.id);
  for (const expected of ["title", "meta-description", "viewport", "structured-data", "h1"]) {
    assert.ok(ids.includes(expected), `expected a finding for ${expected}`);
  }
  assert.ok(report.score < 60, `a bare page should score low, got ${report.score}`);
});

test("an unreachable page reports that and stops, rather than scoring the error body", () => {
  const report = analyze(baseInput("<html>404</html>", { status: 503 }));
  assert.equal(report.reachable, false);
  assert.equal(report.score, 0);
  assert.equal(report.findings.length, 1);
  assert.match(report.summary, /503/);
});

test("structured data present but not describing the business is called out separately", () => {
  const html = `<html><head><title>T</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
    </head><body><h1>x</h1></body></html>`;
  const finding = analyze(baseInput(html)).findings.find((f) => f.id === "structured-data");
  assert.equal(finding?.severity, "warn");
  assert.match(finding!.detail, /none describing the business/);
});

test("an incomplete business entity names exactly the missing fields", () => {
  const html = `<html><head><title>T</title>
    <script type="application/ld+json">{"@type":"LocalBusiness","name":"X","address":{"@type":"PostalAddress"}}</script>
    </head><body><h1>x</h1></body></html>`;
  const finding = analyze(baseInput(html)).findings.find((f) => f.id === "structured-data");
  assert.match(finding!.detail, /telephone/);
  assert.match(finding!.detail, /openingHours/);
  assert.doesNotMatch(finding!.detail, /address/);
});

test("robots.txt blocking an AI crawler is surfaced, since it decides whether AI can cite you", () => {
  const report = analyze(
    baseInput(GOOD, {
      robotsTxt: { present: true, status: 200, sample: "User-agent: GPTBot\nDisallow: /" },
    }),
  );
  const finding = report.findings.find((f) => f.id === "robots");
  assert.equal(finding?.severity, "warn");
  assert.match(finding!.detail, /cannot cite/);
});

test("parseJsonLd survives a malformed block instead of throwing", () => {
  const html = `<script type="application/ld+json">{ not json </script>
                <script type="application/ld+json">{"@type":"Dentist","name":"D"}</script>`;
  const parsed = parseJsonLd(html);
  assert.equal(parsed.blocks, 2);
  assert.ok(parsed.types.includes("Dentist"));
  assert.equal(parsed.localBusiness?.name, true);
});

test("nested @graph entities are found", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"LocalBusiness","name":"N","telephone":"1","address":{},"openingHours":"Mo"}]}</script>`;
  const parsed = parseJsonLd(html);
  assert.ok(parsed.types.includes("LocalBusiness"));
  assert.equal(parsed.localBusiness?.openingHours, true);
});

/* ------------------------------ matching ------------------------------ */

test("trade words route to the right line, not just slug matches", () => {
  const cases: [string, string][] = [
    ["roofing", "home-services"],
    ["HVAC contractor", "home-services"],
    ["collision repair", "auto-body"],
    ["body shop", "auto-body"],
    ["ceramic coating", "detailing"],
    ["med spa", "med-aesthetics"],
    ["personal injury attorney", "law"],
    ["chiropractor", "chiro-pt"],
    ["animal hospital", "veterinary"],
    ["barbershop", "salon"],
    ["crossfit box", "gym"],
    ["wine bar", "restaurant"],
  ];
  for (const [query, expected] of cases) {
    const top = matchTemplates(query)[0];
    assert.equal(top?.template.slug, expected, `"${query}" should match ${expected}`);
    assert.ok(top.because.length > 0, "a match must be able to explain itself");
  }
});

test("an unmatched trade returns nothing rather than a bad guess", () => {
  assert.equal(matchTemplates("nuclear submarine refit").length, 0);
  assert.equal(matchTemplates("").length, 0);
});

test("a place noun does not pass as a trade", () => {
  // "yard" once matched Landscaping, so "submarine refit yard" came back as a
  // confident lawn-care lead. Trade words name the work, not the setting.
  for (const q of ["submarine refit yard", "rail yard operator", "timber yard"]) {
    assert.equal(matchTemplates(q).length, 0, `"${q}" should not match a template line`);
  }
  // The trade itself must still match.
  assert.equal(matchTemplates("lawn care company")[0]?.template.slug, "landscaping");
  assert.equal(matchTemplates("hardscape contractor")[0]?.template.slug, "landscaping");
});

test("ranking is stable across calls", () => {
  const a = matchTemplates("dentist").map((m) => m.template.slug);
  const b = matchTemplates("dentist").map((m) => m.template.slug);
  assert.deepEqual(a, b);
});

/* ----------------------------- rate limit ----------------------------- */

test("the limiter allows exactly the budget, then closes", async () => {
  const store = new MemoryCounterStore();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const r = await checkRateLimit(store, "ip", 5, now);
    assert.equal(r.allowed, true, `call ${i + 1} should be allowed`);
    assert.equal(r.remaining, 4 - i);
  }
  const blocked = await checkRateLimit(store, "ip", 5, now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);
});

test("the window rolls over", async () => {
  const store = new MemoryCounterStore();
  const now = Date.now();
  await checkRateLimit(store, "ip", 1, now);
  assert.equal((await checkRateLimit(store, "ip", 1, now)).allowed, false);
  assert.equal((await checkRateLimit(store, "ip", 1, now + 60_000)).allowed, true);
});

/* ------------------------------ services ------------------------------ */

test("the Care plan is not quotable — it is pitched at delivery, never before", () => {
  const blob = JSON.stringify(SERVICES).toLowerCase();
  assert.doesNotMatch(blob, /care plan/);
  assert.doesNotMatch(blob, /\/mo\b/);
});

test("price labels read the way they are spoken", () => {
  const byId = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
  assert.equal(priceLabel(byId["registry-launch"]), "$149 flat");
  assert.equal(priceLabel(byId["live-tool-preview"]), "$149, credited toward a build");
  // A range is not "flat" — the word is reserved for a single number.
  assert.equal(priceLabel(byId["full-build"]), "$750-1,900, by scope");
});

test("the renamed preview offer never reuses the live store's See It First name", () => {
  // See It First is an existing local-business SKU at the same price. Two
  // different products under one name would collide in the store and in search.
  const blob = JSON.stringify(SERVICES);
  assert.doesNotMatch(blob, /See It First/i);
  assert.ok(SERVICES.some((s) => s.name === "Live Tool Preview"));
});
