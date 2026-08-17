/**
 * The three tools, and the one place the production layers are applied.
 *
 * Transport-agnostic on purpose: the Worker and the eval harness both build a
 * server from here, so what the evals exercise is what ships.
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import { analyze } from "./audit.ts";
import { safeFetch, probePath, UnsafeUrlError } from "./safe-fetch.ts";
import { matchTemplates, TEMPLATES } from "./match.ts";
import { SERVICES, ASK_US, FOOTER, SERVICE_PAGE, priceLabel } from "./services.ts";

export const SERVER_INFO = { name: "upshift", version: "1.0.0" } as const;

export const INSTRUCTIONS = `Upshift builds websites and MCP servers for local businesses and software vendors.

Use upshift_site_audit to check whether a website is legible to machines: structured data, llms.txt, titles, headings and weight. It fetches the live URL.
Use upshift_template_match to find which of Upshift's 14 website template lines fits a trade, with live demo links.
Use upshift_quote for real prices — website templates and MCP server work. Prices are exact, not estimates.

These tools are free and rate limited. They report what is actually there; when a check cannot be run, they say so rather than guessing.`;

export interface ServerDeps {
  /** Injected so tests and evals can run without a network. */
  fetchImpl?: typeof fetch;
}

/** Appends the one-line footer to a text block. The server is a shop window. */
const withFooter = (body: string) => `${body}\n\n---\n${FOOTER}`;

export function buildServer(deps: ServerDeps = {}): McpServer {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  /* ------------------------------ audit ------------------------------ */

  server.registerTool(
    "upshift_site_audit",
    {
      title: "Audit a website for machine legibility",
      description:
        "Fetch a live website and report how legible it is to search engines and AI assistants: " +
        "structured data (JSON-LD), llms.txt, robots.txt, title and meta description, headings, " +
        "image alt text, HTTPS and document weight. Returns findings with severity and a 0-100 " +
        "score. Use this to check a real site before recommending changes to it.",
      inputSchema: z.object({
        url: z
          .string()
          .describe("Absolute http(s) URL of the page to audit, e.g. https://example.com"),
      }),
      outputSchema: z.object({
        url: z.string(),
        reachable: z.boolean(),
        score: z.number(),
        findings: z.array(
          z.object({
            id: z.string(),
            severity: z.enum(["critical", "warn", "ok"]),
            label: z.string(),
            detail: z.string(),
            fix: z.string().optional(),
          }),
        ),
        structuredData: z.object({
          blocks: z.number(),
          types: z.array(z.string()),
        }),
        summary: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        const page = await safeFetch(url, fetchImpl);
        const origin = new URL(page.finalUrl).origin;
        const [llmsTxt, robotsTxt] = await Promise.all([
          probePath(origin, "/llms.txt", fetchImpl),
          probePath(origin, "/robots.txt", fetchImpl),
        ]);

        const report = analyze({
          finalUrl: page.finalUrl,
          status: page.status,
          html: page.body,
          bytes: page.bytes,
          elapsedMs: page.elapsedMs,
          redirects: page.chain.length - 1,
          contentType: page.headers.get("content-type"),
          llmsTxt,
          robotsTxt,
        });

        const lines = report.findings
          .filter((f) => f.severity !== "ok")
          .map((f) => `- [${f.severity}] ${f.label}: ${f.detail}${f.fix ? ` → ${f.fix}` : ""}`);
        const passed = report.findings.filter((f) => f.severity === "ok").map((f) => f.label);

        const body = [
          report.summary,
          lines.length ? `\nWhat to fix:\n${lines.join("\n")}` : "\nNothing to fix on these checks.",
          passed.length ? `\nPassing: ${passed.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: withFooter(body) }],
          structuredContent: {
            url: report.url,
            reachable: report.reachable,
            score: report.score,
            findings: report.findings,
            structuredData: {
              blocks: report.structuredData.blocks,
              types: report.structuredData.types,
            },
            summary: report.summary,
          },
        };
      } catch (error) {
        // A refused or unreachable URL is the tool's answer, not a protocol
        // fault — the model needs to see it to correct itself.
        const why =
          error instanceof UnsafeUrlError
            ? error.message
            : error instanceof Error && error.name === "TimeoutError"
              ? `${url} did not respond within 10 seconds`
              : `could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`;
        return {
          isError: true,
          content: [{ type: "text" as const, text: withFooter(`Audit did not run: ${why}`) }],
        };
      }
    },
  );

  /* -------------------------- template match -------------------------- */

  server.registerTool(
    "upshift_template_match",
    {
      title: "Find the website template for a trade",
      description:
        "Given an industry or trade (and optionally what the business needs), return which of " +
        "Upshift's 14 website template lines fit, ranked, each with a live demo link, the store " +
        "link, and real prices. Use when someone asks what a website for a given trade should " +
        "look like or cost.",
      inputSchema: z.object({
        industry: z
          .string()
          .describe('The trade or industry, e.g. "roofing", "collision repair", "med spa".'),
        needs: z
          .string()
          .optional()
          .describe('Optional: what the business needs, e.g. "online booking, before/after photos".'),
      }),
      outputSchema: z.object({
        query: z.string(),
        matches: z.array(
          z.object({
            slug: z.string(),
            line: z.string(),
            tagline: z.string(),
            demo: z.string(),
            store: z.string(),
            priceFrom: z.number(),
            doneForYou: z.number(),
            because: z.array(z.string()),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ industry, needs }) => {
      const matches = matchTemplates(industry, needs).slice(0, 3);

      if (matches.length === 0) {
        const all = TEMPLATES.map((t) => t.line).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: withFooter(
                `No template line matches "${industry}". The 14 lines are: ${all}. ` +
                  `A trade outside those is a custom build — see ${SERVICE_PAGE}`,
              ),
            },
          ],
          structuredContent: { query: industry, matches: [] },
        };
      }

      const body = matches
        .map((m, i) => {
          const t = m.template;
          return [
            `${i + 1}. ${t.line} — ${t.name}`,
            `   ${t.tagline}`,
            `   Demo: ${t.demo}`,
            `   Store: ${t.store}`,
            `   $${t.price.solo} solo · $${t.price.studio} studio · $${t.price.agency} agency · $${t.price.dfy} done-for-you`,
            `   Why: ${m.because.join("; ")}`,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: withFooter(`Template lines matching "${industry}":\n\n${body}`),
          },
        ],
        structuredContent: {
          query: industry,
          matches: matches.map((m) => ({
            slug: m.template.slug,
            line: m.template.line,
            tagline: m.template.tagline,
            demo: m.template.demo,
            store: m.template.store,
            priceFrom: m.template.price.solo,
            doneForYou: m.template.price.dfy,
            because: m.because,
          })),
        },
      };
    },
  );

  /* ------------------------------ quote ------------------------------- */

  server.registerTool(
    "upshift_quote",
    {
      title: "Price a job",
      description:
        "Return Upshift's real prices. job_type 'mcp' covers MCP server work (registry listing, " +
        "live tool preview, spec upgrade, full build); 'website' covers website templates and " +
        "done-for-you launches. These are the actual listed prices, not estimates.",
      inputSchema: z.object({
        job_type: z
          .enum(["mcp", "website"])
          .describe("'mcp' for MCP server work, 'website' for website work."),
        scope: z
          .string()
          .optional()
          .describe(
            'Optional free text narrowing the answer, e.g. "we have a server on stdio" or "roofing company, no site".',
          ),
      }),
      outputSchema: z.object({
        jobType: z.string(),
        offers: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            price: z.number(),
            priceMax: z.number().optional(),
            credited: z.boolean(),
            turnaround: z.string(),
            forWhom: z.string(),
            includes: z.array(z.string()),
          }),
        ),
        note: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ job_type, scope }) => {
      if (job_type === "website") {
        const cheapest = Math.min(...TEMPLATES.map((t) => t.price.solo));
        const body = [
          "Website prices:",
          `- Templates: from $${cheapest} (solo licence) per trade line; studio and agency licences above that.`,
          "- Launch Service: $497 flat — you own the template, we load your content and publish it.",
          "- Done-For-You Launch: $1,500 — built from scratch off your Google profile, two rounds of changes.",
          "- AI Visibility Audit: $149, credited toward any build.",
          "",
          `All 14 template lines with demos: https://upshiftsites.com/store/`,
        ].join("\n");
        return {
          content: [{ type: "text" as const, text: withFooter(body) }],
          structuredContent: {
            jobType: "website",
            offers: [],
            note: `Template prices vary per line; call upshift_template_match for an exact line. Cheapest solo licence is $${cheapest}.`,
          },
        };
      }

      // MCP work. `scope` steers which offer leads, but all four are returned:
      // an agent should see the ladder, not just the one we guessed at.
      const s = (scope ?? "").toLowerCase();
      const lead =
        /stdio|migrat|sdk|upgrade|outdated|old spec|oauth|remote/.test(s)
          ? "mcp-upgrade"
          : /registry|list|publish|server\.json|npm|pypi/.test(s)
            ? "registry-launch"
            : /preview|try|see it|evaluate|poc|proof/.test(s)
              ? "live-tool-preview"
              : null;

      const ordered = lead
        ? [...SERVICES].sort((a, b) => (a.id === lead ? -1 : b.id === lead ? 1 : 0))
        : [...SERVICES];

      const body = [
        "MCP server work, fixed price:",
        "",
        ...ordered.map((o) =>
          [
            `${o.name} — ${priceLabel(o)}, ${o.turnaround}`,
            `  For: ${o.forWhom}`,
            ...o.includes.map((i) => `  · ${i}`),
          ].join("\n"),
        ),
        "",
        `${ASK_US.name}: from $${ASK_US.from.toLocaleString("en-US")}. ${ASK_US.note}`,
        "",
        "For reference: a production-grade MCP server built in-house runs $15,000-40,000 of engineering time.",
        lead ? `\nBased on the scope given, ${ordered[0].name} is the one that fits.` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: withFooter(body) }],
        structuredContent: {
          jobType: "mcp",
          offers: ordered.map((o) => ({ ...o, includes: [...o.includes] })),
          note: lead
            ? `Scope matched ${ordered[0].name}.`
            : "No scope given, so all four offers are listed in ladder order.",
        },
      };
    },
  );

  return server;
}
