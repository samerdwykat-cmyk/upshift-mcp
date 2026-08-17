#!/usr/bin/env node
/**
 * `npx upshift-mcp` — the same server the Worker deploys, run locally.
 *
 * Default is stdio, because that is what an MCP client spawning a command
 * expects; nothing but protocol frames may touch stdout in that mode.
 * `--http` serves the full Worker (landing page included) on localhost
 * instead. Both modes build the server from the same factory the deployed
 * Worker uses.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.ts";
import { serveHttp } from "./node-http.ts";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.error(`upshift-mcp — Upshift's reference MCP server, locally

Usage:
  upshift-mcp            serve MCP over stdio (for clients that spawn a command)
  upshift-mcp --http     serve over HTTP on 127.0.0.1 (default port 8788)
  upshift-mcp --http --port 9000

The hosted instance needs no install: https://mcp.upshiftsites.com/mcp`);
  process.exit(0);
}

if (args.includes("--http")) {
  const portFlag = args[args.indexOf("--port") + 1];
  serveHttp(args.includes("--port") ? { port: Number(portFlag) } : {});
} else {
  // Same posture as the deployed Worker: modern spec served, 2025-era
  // openings still answered rather than turned away.
  serveStdio(() => buildServer(), {
    legacy: "serve",
    onerror: (error) => console.error("mcp", error.message),
  });
  console.error("upshift-mcp serving MCP on stdio (--help for options)");
}
