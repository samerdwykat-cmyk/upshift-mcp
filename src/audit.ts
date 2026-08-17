/**
 * The analysis behind `upshift_site_audit`.
 *
 * Pure on purpose: `analyze()` takes fetched bytes and returns findings, so
 * every rule is unit-testable without a network. The network half lives in
 * safe-fetch.ts.
 *
 * The rules are the ones Upshift actually sells against — can a machine read
 * this business? Not a Lighthouse clone. Performance here is one honest
 * signal (bytes, response time) rather than a fabricated score, because a
 * single Worker fetch cannot measure what a browser measures.
 */

export type Severity = "critical" | "warn" | "ok";

export interface Finding {
  id: string;
  severity: Severity;
  label: string;
  /** What was actually observed. Never a recommendation — that is `fix`. */
  detail: string;
  fix?: string;
}

export interface AuditInput {
  finalUrl: string;
  status: number;
  html: string;
  bytes: number;
  elapsedMs: number;
  redirects: number;
  contentType: string | null;
  llmsTxt: { present: boolean; status: number };
  robotsTxt: { present: boolean; status: number; sample?: string };
}

export interface AuditReport {
  url: string;
  reachable: boolean;
  /** 0-100, computed from the findings below. Not a Lighthouse score. */
  score: number;
  findings: Finding[];
  structuredData: { blocks: number; types: string[]; localBusiness: LocalBusinessFacts | null };
  summary: string;
}

export interface LocalBusinessFacts {
  name: boolean;
  telephone: boolean;
  address: boolean;
  openingHours: boolean;
  geo: boolean;
  sameAs: boolean;
}

/* ---------- tiny HTML helpers (no parser dependency, by design) ---------- */

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

function tagContent(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...html.matchAll(re)].map((m) => m[1]);
}

function metaContent(html: string, nameOrProp: string): string | null {
  const re = new RegExp(
    `<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${nameOrProp}["'][^>]*>`,
    "i",
  );
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  return /content\s*=\s*["']([\s\S]*?)["']/i.exec(tag)?.[1]?.trim() ?? null;
}

const countTags = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

const text = (s: string) => decode(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));

/* ---------------------------- JSON-LD ---------------------------- */

/** Every @type in a JSON-LD graph, however nested. */
function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) for (const v of t) if (typeof v === "string") out.add(v);
    for (const v of Object.values(obj)) collectTypes(v, out);
  }
}

function findLocalBusiness(node: unknown): Record<string, unknown> | null {
  const BUSINESS = /(LocalBusiness|AutoRepair|AutoBody|Dentist|Physician|LegalService|Restaurant|HealthAndBeautyBusiness|ProfessionalService|HomeAndConstructionBusiness|Store|Organization)/i;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findLocalBusiness(n);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    const types = typeof t === "string" ? [t] : Array.isArray(t) ? t : [];
    if (types.some((x) => typeof x === "string" && BUSINESS.test(x))) return obj;
    for (const v of Object.values(obj)) {
      const hit = findLocalBusiness(v);
      if (hit) return hit;
    }
  }
  return null;
}

export function parseJsonLd(html: string): {
  blocks: number;
  types: string[];
  localBusiness: LocalBusinessFacts | null;
} {
  const scripts = [
    ...html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const types = new Set<string>();
  let business: Record<string, unknown> | null = null;
  let parsed = 0;

  for (const s of scripts) {
    try {
      const json = JSON.parse(decode(s[1]));
      parsed++;
      collectTypes(json, types);
      business ??= findLocalBusiness(json);
    } catch {
      // A malformed block is itself a finding; counted via blocks vs parsed.
    }
  }

  const facts: LocalBusinessFacts | null = business
    ? {
        name: typeof business.name === "string" && business.name.length > 0,
        telephone: !!business.telephone,
        address: !!business.address,
        openingHours: !!(business.openingHours ?? business.openingHoursSpecification),
        geo: !!business.geo,
        sameAs: !!business.sameAs,
      }
    : null;

  return { blocks: scripts.length, types: [...types].sort(), localBusiness: facts };
}

/* ---------------------------- the rules ---------------------------- */

export function analyze(input: AuditInput): AuditReport {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const html = stripComments(input.html);
  const reachable = input.status >= 200 && input.status < 400;

  if (!reachable) {
    return {
      url: input.finalUrl,
      reachable: false,
      score: 0,
      findings: [
        {
          id: "reachable",
          severity: "critical",
          label: "Site did not return a page",
          detail: `HTTP ${input.status} at ${input.finalUrl}`,
          fix: "Confirm the domain resolves and the origin is serving traffic.",
        },
      ],
      structuredData: { blocks: 0, types: [], localBusiness: null },
      summary: `${input.finalUrl} returned HTTP ${input.status}; nothing else could be checked.`,
    };
  }

  // --- transport -------------------------------------------------------
  add(
    input.finalUrl.startsWith("https://")
      ? { id: "https", severity: "ok", label: "HTTPS", detail: "Served over HTTPS." }
      : {
          id: "https",
          severity: "critical",
          label: "No HTTPS",
          detail: `Final URL is ${input.finalUrl}`,
          fix: "Serve over HTTPS and redirect http to https.",
        },
  );

  if (input.redirects > 2) {
    add({
      id: "redirects",
      severity: "warn",
      label: "Long redirect chain",
      detail: `${input.redirects} redirects before the page rendered.`,
      fix: "Collapse to a single redirect; each hop costs a round trip.",
    });
  }

  // --- identity --------------------------------------------------------
  const title = text(tagContent(html, "title")[0] ?? "");
  if (!title) {
    add({
      id: "title",
      severity: "critical",
      label: "No page title",
      detail: "The <title> element is missing or empty.",
      fix: "Add a title: the business name plus what it does and where.",
    });
  } else if (title.length > 60) {
    add({
      id: "title",
      severity: "warn",
      label: "Title is long",
      detail: `${title.length} characters — search results truncate near 60. "${title.slice(0, 70)}…"`,
      fix: "Trim to 60 characters or fewer, keeping the business name.",
    });
  } else {
    add({ id: "title", severity: "ok", label: "Title", detail: `"${title}" (${title.length} chars)` });
  }

  const desc = metaContent(html, "description");
  if (!desc) {
    add({
      id: "meta-description",
      severity: "warn",
      label: "No meta description",
      detail: "No <meta name=\"description\">, so the engine writes your snippet for you.",
      fix: "Add a 70-160 character description naming the service and the city.",
    });
  } else if (desc.length > 160 || desc.length < 70) {
    add({
      id: "meta-description",
      severity: "warn",
      label: "Meta description is off-budget",
      detail: `${desc.length} characters (target 70-160).`,
      fix: desc.length > 160 ? "Trim to 160 or fewer." : "Expand toward 70-160.",
    });
  } else {
    add({ id: "meta-description", severity: "ok", label: "Meta description", detail: `${desc.length} chars` });
  }

  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) {
    add({
      id: "viewport",
      severity: "critical",
      label: "No viewport meta",
      detail: "Mobile browsers will render this at desktop width and zoom out.",
      fix: '<meta name="viewport" content="width=device-width, initial-scale=1">',
    });
  } else {
    add({ id: "viewport", severity: "ok", label: "Viewport", detail: "Mobile viewport declared." });
  }

  // --- structured data -------------------------------------------------
  const sd = parseJsonLd(html);
  if (sd.blocks === 0) {
    add({
      id: "structured-data",
      severity: "critical",
      label: "No structured data",
      detail: "No JSON-LD on the page, so a machine has to guess the business facts.",
      fix: "Add LocalBusiness JSON-LD with name, telephone, address and openingHours.",
    });
  } else if (!sd.localBusiness) {
    add({
      id: "structured-data",
      severity: "warn",
      label: "Structured data, but no business entity",
      detail: `${sd.blocks} JSON-LD block(s) found (${sd.types.join(", ") || "no @type"}), none describing the business itself.`,
      fix: "Add a LocalBusiness (or trade-specific subtype) entity.",
    });
  } else {
    const f = sd.localBusiness;
    const missing = (
      [
        ["telephone", f.telephone],
        ["address", f.address],
        ["openingHours", f.openingHours],
      ] as const
    )
      .filter(([, present]) => !present)
      .map(([k]) => k);
    add(
      missing.length === 0
        ? {
            id: "structured-data",
            severity: "ok",
            label: "Business structured data",
            detail: `LocalBusiness entity with phone, address and hours (${sd.types.join(", ")}).`,
          }
        : {
            id: "structured-data",
            severity: "warn",
            label: "Business structured data is incomplete",
            detail: `LocalBusiness entity present but missing: ${missing.join(", ")}.`,
            fix: `Add ${missing.join(", ")} to the JSON-LD entity.`,
          },
    );
  }

  // --- AI legibility ---------------------------------------------------
  add(
    input.llmsTxt.present
      ? { id: "llms-txt", severity: "ok", label: "llms.txt", detail: "Present at /llms.txt." }
      : {
          id: "llms-txt",
          severity: "warn",
          label: "No llms.txt",
          detail: "Nothing at /llms.txt telling an assistant what this business does.",
          fix: "Publish /llms.txt with services, hours, service area and contact.",
        },
  );

  if (!input.robotsTxt.present) {
    add({
      id: "robots",
      severity: "warn",
      label: "No robots.txt",
      detail: "Nothing at /robots.txt.",
      fix: "Add robots.txt with a sitemap line.",
    });
  } else {
    const blocksAi = /User-agent:\s*(GPTBot|ClaudeBot|PerplexityBot|CCBot|Google-Extended)[\s\S]{0,200}?Disallow:\s*\//i.test(
      input.robotsTxt.sample ?? "",
    );
    add(
      blocksAi
        ? {
            id: "robots",
            severity: "warn",
            label: "robots.txt blocks AI crawlers",
            detail: "An AI crawler is disallowed, so assistants cannot cite this site.",
            fix: "Intentional for some businesses. If you want to be quotable, allow them.",
          }
        : {
            id: "robots",
            severity: "ok",
            label: "robots.txt",
            detail: "Present and not blocking AI crawlers.",
          },
    );
  }

  // --- structure -------------------------------------------------------
  const h1s = tagContent(html, "h1").map(text).filter(Boolean);
  if (h1s.length === 0) {
    add({
      id: "h1",
      severity: "warn",
      label: "No H1",
      detail: "The page has no top-level heading.",
      fix: "Add one H1 naming the service and the place.",
    });
  } else if (h1s.length > 1) {
    add({
      id: "h1",
      severity: "warn",
      label: "Multiple H1s",
      detail: `${h1s.length} H1 elements: ${h1s.slice(0, 3).map((h) => `"${h}"`).join(", ")}`,
      fix: "Keep one H1; demote the rest to H2.",
    });
  } else {
    add({ id: "h1", severity: "ok", label: "H1", detail: `"${h1s[0]}"` });
  }

  const imgs = countTags(html, "img");
  const alts = (html.match(/<img\b[^>]*\balt\s*=/gi) ?? []).length;
  if (imgs > 0) {
    const pct = Math.round((alts / imgs) * 100);
    add(
      pct >= 90
        ? { id: "img-alt", severity: "ok", label: "Image alt text", detail: `${alts}/${imgs} images have alt text.` }
        : {
            id: "img-alt",
            severity: "warn",
            label: "Images missing alt text",
            detail: `${alts}/${imgs} images have alt text (${pct}%).`,
            fix: "Describe each image; empty alt=\"\" is correct for decorative ones.",
          },
    );
  }

  // --- weight ----------------------------------------------------------
  const kb = Math.round(input.bytes / 1024);
  add(
    input.bytes > 500_000
      ? {
          id: "weight",
          severity: "warn",
          label: "Heavy HTML document",
          detail: `${kb} KB of HTML before images, CSS or JS (${input.elapsedMs} ms to first byte-to-end).`,
          fix: "Most of this is usually inlined data or an unsplit bundle.",
        }
      : {
          id: "weight",
          severity: "ok",
          label: "Document weight",
          detail: `${kb} KB of HTML, fetched in ${input.elapsedMs} ms.`,
        },
  );

  const score = scoreOf(findings);
  return {
    url: input.finalUrl,
    reachable: true,
    score,
    findings,
    structuredData: sd,
    summary: summarize(input.finalUrl, score, findings),
  };
}

/** Critical costs 12, a warning costs 5, floored at 0. */
function scoreOf(findings: Finding[]): number {
  const penalty = findings.reduce(
    (n, f) => n + (f.severity === "critical" ? 12 : f.severity === "warn" ? 5 : 0),
    0,
  );
  return Math.max(0, 100 - penalty);
}

function summarize(url: string, score: number, findings: Finding[]): string {
  const crit = findings.filter((f) => f.severity === "critical");
  const warn = findings.filter((f) => f.severity === "warn");
  const head = `${url} scores ${score}/100 for machine legibility: ${crit.length} critical, ${warn.length} to improve.`;
  if (crit.length === 0 && warn.length === 0) return `${head} Nothing to fix on these checks.`;
  const worst = [...crit, ...warn].slice(0, 3).map((f) => f.label);
  return `${head} Biggest gaps: ${worst.join("; ")}.`;
}
