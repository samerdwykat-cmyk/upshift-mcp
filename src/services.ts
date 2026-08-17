/**
 * What Upshift sells for MCP work, and what it costs.
 *
 * This is the table `upshift_quote` reads and the one the service page renders.
 * Keep it in step with upshift-agency-site/src/data/store.ts — test/catalog.test.ts
 * asserts the overlap, so a divergence fails CI rather than reaching a buyer.
 *
 * Deliberately absent: the Care plan. It is pitched at delivery and never
 * before, so an agent asking for a quote must not be able to surface it.
 */

export interface ServiceOffer {
  id: string;
  name: string;
  /** Flat price in USD, or the low end when `priceMax` is set. */
  price: number;
  priceMax?: number;
  /** True when the fee is credited against a later build. */
  credited: boolean;
  turnaround: string;
  /** Which buyer this is for, in the seller's own words. */
  forWhom: string;
  includes: readonly string[];
}

export const SERVICES: readonly ServiceOffer[] = [
  {
    id: "registry-launch",
    name: "Registry Launch",
    price: 149,
    credited: false,
    turnaround: "2 business days",
    forWhom: "You built an MCP server and it is not listed anywhere yet.",
    includes: [
      "server.json authored and validated",
      "Submitted to the official MCP registry",
      "Listed on Glama and two further catalogs",
      "npm or PyPI publish, if you have not published yet",
      "Smoke test from a clean client against the published entry",
    ],
  },
  {
    id: "live-tool-preview",
    name: "Live Tool Preview",
    price: 149,
    credited: true,
    turnaround: "3 business days",
    forWhom: "You have an API and no MCP server, and want to see it work before committing.",
    includes: [
      "One or two of your existing endpoints, live as MCP tools",
      "Running against a real client, screen-recorded",
      "Streamable HTTP on the current spec revision",
      "The full $149 credited toward a Full Build",
    ],
  },
  {
    id: "mcp-upgrade",
    name: "MCP Upgrade",
    price: 499,
    credited: false,
    turnaround: "1 week",
    forWhom: "You have a working MCP server that predates the current spec.",
    includes: [
      "stdio to remote (Streamable HTTP)",
      "Migration to the current spec revision, including SDK v2",
      "OAuth 2.1 resource-server auth",
      "Registry listing",
      "An eval suite, so you can prove it still works after the migration",
    ],
  },
  {
    id: "full-build",
    name: "Full Build",
    price: 750,
    priceMax: 1900,
    credited: false,
    turnaround: "1 to 2 weeks",
    forWhom: "You want a production MCP server for your product.",
    includes: [
      "A designed tool map — not one tool per endpoint",
      "Up to 12 tools with schema validation",
      "Auth, per-tool rate limiting, structured logging",
      "An eval suite that exercises the tools the way an agent calls them",
      "Docs, registry listing, and launch",
      "Wrap ($750) covers an existing API; Build ($1,900) covers design from scratch",
    ],
  },
] as const;

/** Metered / agent-payable work. Real, but quoted per job rather than listed. */
export const ASK_US = {
  name: "Metered & agent-payable builds",
  from: 3500,
  note: "Per-call billing, x402 or Stripe machine payments. Scoped per job — ask.",
} as const;

export const SERVICE_PAGE = "https://upshiftsites.com/store/services/";

/** One line, appended to every tool response. The server is a shop window. */
export const FOOTER = `Built by Upshift. We ship these for $149-1,900 · ${SERVICE_PAGE}`;

export const byId = (id: string): ServiceOffer | undefined =>
  SERVICES.find((s) => s.id === id);

/**
 * Price as it should be spoken.
 *
 * "flat" is only true of a single number — calling a $750-1,900 range flat is
 * the kind of small dishonesty a buyer notices on the invoice.
 */
export function priceLabel(s: ServiceOffer): string {
  const n = (v: number) => `$${v.toLocaleString("en-US")}`;
  if (s.priceMax) return `${n(s.price)}-${n(s.priceMax).slice(1)}, by scope`;
  return s.credited ? `${n(s.price)}, credited toward a build` : `${n(s.price)} flat`;
}
