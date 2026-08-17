/**
 * Local server — the production Worker handler, on Node instead of workerd.
 *
 * `wrangler dev` needs macOS 13.5+ and will not boot on this box. This serves
 * the *same* default export from src/worker.ts against an in-memory KV shim,
 * so routes, protocol handling, rate limiting and every tool run for real.
 * Deployment is still `wrangler deploy`; this is the development path, not a
 * second implementation.
 *
 * The bridge itself lives in src/node-http.ts, shared with the published
 * CLI's --http mode.
 *
 * Run: npm run dev     →  http://127.0.0.1:8788/mcp
 */

import { serveHttp } from "../src/node-http.ts";

serveHttp();
