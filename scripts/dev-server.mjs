/**
 * Local server — the production Worker handler, on Node instead of workerd.
 *
 * `wrangler dev` needs macOS 13.5+ and will not boot on this box. This serves
 * the *same* default export from src/worker.ts against an in-memory KV shim,
 * so routes, protocol handling, rate limiting and every tool run for real.
 * Deployment is still `wrangler deploy`; this is the development path, not a
 * second implementation.
 *
 * Run: npm run dev     →  http://127.0.0.1:8788/mcp
 */

import { createServer } from "node:http";
import worker from "../src/worker.ts";

const PORT = Number(process.env.PORT ?? 8788);
const HOST = "127.0.0.1"; // localhost only, per the transport's security note

/** Enough of the KV surface for the rate limiter, with real TTL expiry. */
const kv = (() => {
  const map = new Map();
  return {
    async get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (hit.expires <= Date.now()) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, opts = {}) {
      map.set(key, {
        value,
        expires: Date.now() + (opts.expirationTtl ?? 60) * 1000,
      });
    },
  };
})();

const env = {
  RATE_LIMIT: kv,
  RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN ?? "1000", // generous locally
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
};

createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? `${HOST}:${PORT}`}${req.url}`;
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise((resolve) => {
          const chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
        });

  const request = new Request(url, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x]) : v == null ? [] : [[k, v]],
    ),
    body: body?.length ? body : undefined,
    duplex: "half",
  });

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
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
  }
}).listen(PORT, HOST, () => {
  console.log(`upshift-mcp dev  →  http://${HOST}:${PORT}`);
  console.log(`  MCP endpoint   →  http://${HOST}:${PORT}/mcp`);
  console.log(`  landing page   →  http://${HOST}:${PORT}/`);
});
