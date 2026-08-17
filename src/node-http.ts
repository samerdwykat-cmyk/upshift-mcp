/**
 * The production Worker handler, served over Node's http module.
 *
 * One bridge, two callers: `npm run dev` (source, via --experimental-strip-types)
 * and the published CLI's --http mode (compiled). Routes, protocol handling,
 * rate limiting and every tool run through the same `worker.fetch` Cloudflare
 * calls — this is a host shim, not a second implementation.
 */

import { createServer, type Server } from "node:http";
import worker, { type Env } from "./worker.ts";

export interface ServeHttpOptions {
  port?: number;
  /** Localhost only by default, per the transport's security note. */
  host?: string;
  rateLimitPerMin?: string;
  allowedOrigins?: string;
}

/** Enough of the KV surface for the rate limiter, with real TTL expiry. */
function memoryKv() {
  const map = new Map<string, { value: string; expires: number }>();
  return {
    async get(key: string) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expires <= Date.now()) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key: string, value: string, opts: { expirationTtl?: number } = {}) {
      map.set(key, {
        value,
        expires: Date.now() + (opts.expirationTtl ?? 60) * 1000,
      });
    },
  };
}

export function serveHttp(options: ServeHttpOptions = {}): Server {
  const port = options.port ?? Number(process.env.PORT ?? 8788);
  const host = options.host ?? "127.0.0.1";

  const env = {
    RATE_LIMIT: memoryKv(),
    // Generous locally: the limit exists to guard the deployed endpoint, and
    // here the caller owns the machine it would be guarding.
    RATE_LIMIT_PER_MIN: options.rateLimitPerMin ?? process.env.RATE_LIMIT_PER_MIN ?? "1000",
    ALLOWED_ORIGINS: options.allowedOrigins ?? process.env.ALLOWED_ORIGINS,
  } as unknown as Env;

  return createServer(async (req, res) => {
    const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url}`;
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await new Promise<Buffer>((resolve) => {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
          });

    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]): [string, string][] =>
        Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]],
      ),
      body: body?.length ? body : undefined,
      duplex: "half",
    } as RequestInit);

    try {
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error(error);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String((error as Error)?.message ?? error) }));
    }
  }).listen(port, host, () => {
    console.error(`upshift-mcp  →  http://${host}:${port}`);
    console.error(`  MCP endpoint   →  http://${host}:${port}/mcp`);
    console.error(`  landing page   →  http://${host}:${port}/`);
  });
}
