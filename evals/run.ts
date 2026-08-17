/**
 * The eval harness.
 *
 * Reads evals/qa_pairs.xml, calls the real tools through the real server, and
 * checks the text an agent would actually receive. Network calls are served
 * from fixtures so a run is deterministic and works offline — the audit rules
 * are what is under test here, not the internet.
 *
 * Run: npm run eval        (exit code is non-zero if any pair fails)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpHandler } from "@modelcontextprotocol/server";

import { buildServer } from "../src/server.ts";
import { FOOTER } from "../src/services.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------ fixtures ------------------------------ */

const GOOD_PAGE = `<!doctype html><html lang="en"><head>
<title>Ace Collision — Auto Body Repair in Dayton</title>
<meta name="description" content="Collision repair, paint and frame straightening in Dayton, Ohio. I-CAR certified technicians, free estimates and a lifetime warranty on workmanship.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AutoRepair","name":"Ace Collision","telephone":"+1-937-555-0100","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Dayton"},"openingHours":"Mo-Fr 08:00-17:00"}</script>
</head><body><h1>Auto body repair in Dayton</h1>
<img src="/a.jpg" alt="A repaired rear bumper"></body></html>`;

const BARE_PAGE = `<html><body><p>Coming soon</p></body></html>`;

/** Stands in for the network. Anything unlisted is a 404. */
const FIXTURES: Record<string, { status: number; body: string }> = {
  "https://good.example/": { status: 200, body: GOOD_PAGE },
  "https://good.example/llms.txt": { status: 200, body: "# Ace Collision\nAuto body repair." },
  "https://good.example/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
  "https://bare.example/": { status: 200, body: BARE_PAGE },
  "https://bare.example/llms.txt": { status: 404, body: "" },
  "https://bare.example/robots.txt": { status: 404, body: "" },
  "https://down.example/": { status: 503, body: "<html>Service Unavailable</html>" },
  "https://down.example/llms.txt": { status: 404, body: "" },
  "https://down.example/robots.txt": { status: 404, body: "" },
};

const fixtureFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : (input as Request).url;
  const hit = FIXTURES[url] ?? { status: 404, body: "" };
  return new Response(hit.body, {
    status: hit.status,
    headers: { "content-type": "text/html" },
  });
};

/* ------------------------- a very small XML read ------------------------- */

interface QaPair {
  id: string;
  question: string;
  answer: string;
  tool: string;
  args: Record<string, string>;
  expect: string[];
  reject: string[];
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

function parseQaPairs(xml: string): QaPair[] {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "");
  const blocks = [...stripped.matchAll(/<qa_pair\b([^>]*)>([\s\S]*?)<\/qa_pair>/g)];

  return blocks.map((block) => {
    const attrs = block[1];
    const inner = block[2];
    const one = (tag: string) =>
      unescapeXml(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(inner)?.[1] ?? "");
    const many = (tag: string) =>
      [...inner.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
        unescapeXml(m[1]),
      );

    const callBlock = /<call\b([^>]*)>([\s\S]*?)<\/call>/.exec(inner);
    const args: Record<string, string> = {};
    for (const a of (callBlock?.[2] ?? "").matchAll(
      /<arg\s+name="([^"]+)">([\s\S]*?)<\/arg>/g,
    )) {
      args[a[1]] = unescapeXml(a[2]);
    }

    return {
      id: /id="([^"]+)"/.exec(attrs)?.[1] ?? "(unnamed)",
      question: one("question"),
      answer: one("answer"),
      tool: /tool="([^"]+)"/.exec(callBlock?.[1] ?? "")?.[1] ?? "",
      args,
      expect: many("expect"),
      reject: many("reject"),
    };
  });
}

/* -------------------------------- run -------------------------------- */

/** Pull the text an agent would see out of a CallToolResult. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

async function main(): Promise<void> {
  const xml = readFileSync(join(HERE, "qa_pairs.xml"), "utf8");
  const pairs = parseQaPairs(xml);
  if (pairs.length === 0) throw new Error("no qa_pairs parsed — is qa_pairs.xml intact?");

  // Drive the evals over the wire, through the same handler the Worker uses.
  // Calling the tool functions directly would skip schema validation, the
  // header rules and the result envelope — exactly the layers a client hits.
  const handler = createMcpHandler(() => buildServer({ fetchImpl: fixtureFetch }), {
    responseMode: "json",
  });

  let passed = 0;
  const failures: string[] = [];

  for (const pair of pairs) {
    let text: string;
    try {
      text = textOf(await callTool(handler, pair.tool, pair.args));
    } catch (error) {
      failures.push(`${pair.id}: ${(error as Error).message}`);
      continue;
    }

    const missing = pair.expect.filter((e) => !text.includes(e));
    const present = pair.reject.filter((r) => text.includes(r));
    const noFooter = text.includes(FOOTER) ? [] : ["(footer missing)"];
    const problems = [
      ...missing.map((m) => `missing ${JSON.stringify(m)}`),
      ...present.map((p) => `should not contain ${JSON.stringify(p)}`),
      ...noFooter,
    ];

    if (problems.length === 0) {
      passed++;
      console.log(`  ok   ${pair.id}`);
    } else {
      console.log(`  FAIL ${pair.id}`);
      failures.push(`${pair.id}: ${problems.join("; ")}`);
    }
  }

  console.log(`\n${passed}/${pairs.length} qa_pairs passed`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

const PROTOCOL_VERSION = "2026-07-28";

/** One spec-correct tools/call over the Streamable HTTP handler. */
async function callTool(
  handler: { fetch: (r: Request) => Promise<Response> },
  name: string,
  args: Record<string, string>,
): Promise<unknown> {
  const body = {
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "upshift-evals", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };

  const response = await handler.fetch(
    new Request("https://mcp.upshiftsites.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": "tools/call",
        "mcp-name": name,
      },
      body: JSON.stringify(body),
    }),
  );

  const payload = JSON.parse(await response.text());
  if (payload.error) {
    throw new Error(`protocol error ${payload.error.code}: ${payload.error.message}`);
  }
  return payload.result;
}

await main();
