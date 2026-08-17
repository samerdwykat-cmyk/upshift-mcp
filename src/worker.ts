/**
 * The Worker: one MCP endpoint at /mcp, a landing page for humans, and the
 * two things that stand between a free public tool and an abuse bill —
 * an origin policy and a rate limit.
 *
 * Transport, protocol negotiation, and the 2026-07-28 header rules are the
 * SDK's job (`createMcpHandler`). Everything here is deployment policy.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer, SERVER_INFO } from "./server.ts";
import {
  checkRateLimit,
  callerKey,
  DEFAULT_LIMIT_PER_MIN,
  type CounterStore,
} from "./ratelimit.ts";
import { SERVICE_PAGE } from "./services.ts";
import { landingPage } from "./landing.ts";

export interface Env {
  /** Fixed-window rate-limit counters. */
  RATE_LIMIT: KVNamespace;
  /**
   * Comma-separated origin allowlist. Unset means "public": any origin may
   * call, which is correct only while this server holds no ambient authority
   * — no auth, no cookies, read-only tools. Set it the moment either changes.
   */
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_PER_MIN?: string;
}

const MCP_PATH = "/mcp";

/** Built once per isolate; the factory runs per request inside the handler. */
const handler = createMcpHandler(() => buildServer(), {
  // Old clients still reach this server from registries and directories.
  // Serving them statelessly costs nothing and keeps the shop window open.
  legacy: "stateless",
  responseMode: "auto",
  onerror: (error) => console.error("mcp", error.message),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const origin = request.headers.get("origin");
    const originVerdict = checkOrigin(origin, env.ALLOWED_ORIGINS);
    if (!originVerdict.allowed) {
      return json({ error: "origin not allowed" }, 403, corsHeaders(null));
    }
    const cors = corsHeaders(originVerdict.echo);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(landingPage(), {
        headers: { "content-type": "text/html; charset=utf-8", ...cors },
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, server: SERVER_INFO }, 200, cors);
    }

    if (url.pathname !== MCP_PATH) {
      return json({ error: "not found", mcp_endpoint: MCP_PATH }, 404, cors);
    }

    // A person who pastes the endpoint into a browser gets a JSON-RPC error,
    // because GET on the MCP endpoint is 405 in this revision. That is correct
    // for a client and useless for a human — and /mcp is the URL that appears
    // in the registry listing, in server.json, and in every outreach email, so
    // the browser case is the one strangers actually hit first.
    //
    // Content negotiation keeps both honest: an MCP client asking for
    // event-stream still gets its 405; a browser asking for HTML gets sent to
    // the landing page. Nothing here claims GET is a valid MCP operation.
    if (request.method === "GET" && prefersHtml(request)) {
      return Response.redirect(new URL("/", url).toString(), 303);
    }

    // Spec 2026-07-28 dropped GET streams and DELETE sessions. The SDK answers
    // 405 for those; the rate limit only needs to guard real work.
    if (request.method === "POST") {
      const limit = Number(env.RATE_LIMIT_PER_MIN ?? DEFAULT_LIMIT_PER_MIN);
      const verdict = await checkRateLimit(
        env.RATE_LIMIT as unknown as CounterStore,
        callerKey(request),
        limit,
      );
      if (!verdict.allowed) {
        return json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message: `Rate limit reached: ${verdict.limit} calls/minute. Retry in ${verdict.retryAfterSec}s. This server is free; the paid ones we build for clients are not limited like this — ${SERVICE_PAGE}`,
            },
          },
          429,
          { ...cors, "retry-after": String(verdict.retryAfterSec) },
        );
      }
    }

    const response = await handler.fetch(request);
    // The SDK owns the body and protocol headers; CORS is deployment policy,
    // so it is layered on rather than baked into the handler.
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * Origin policy.
 *
 * The spec requires servers to validate Origin to blunt DNS rebinding. That
 * attack pays only when the server has authority the attacker lacks — local
 * filesystem access, a session cookie, a private network position. This one
 * has none: it is public, unauthenticated, and read-only, so a browser coaxed
 * into calling it can learn nothing the attacker could not fetch directly.
 *
 * So the default is open, and ALLOWED_ORIGINS makes it strict. When this
 * pattern ships to a client with auth, the allowlist is set on day one.
 */
export function checkOrigin(
  origin: string | null,
  allowed: string | undefined,
): { allowed: boolean; echo: string | null } {
  const list = (allowed ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length === 0) return { allowed: true, echo: origin };
  if (!origin) return { allowed: true, echo: null }; // non-browser client
  return list.includes(origin)
    ? { allowed: true, echo: origin }
    : { allowed: false, echo: null };
}

/**
 * Is this a browser rather than an MCP client?
 *
 * An MCP client always advertises `text/event-stream` — the transport requires
 * it. So event-stream anywhere in Accept means "protocol traffic, answer 405",
 * and only a request that wants HTML without it is treated as a person.
 */
export function prefersHtml(request: Request): boolean {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  if (accept.includes("text/event-stream")) return false;
  return accept.includes("text/html");
}

function corsHeaders(echo: string | null): Record<string, string> {
  return {
    "access-control-allow-origin": echo ?? "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers":
      "content-type, mcp-protocol-version, mcp-method, mcp-name, authorization",
    "access-control-expose-headers": "mcp-protocol-version",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}
