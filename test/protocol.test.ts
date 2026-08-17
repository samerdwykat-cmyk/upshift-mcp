/**
 * End-to-end through the real Worker handler.
 *
 * These are the cases that decide whether a client can talk to this server at
 * all, so they go through `worker.fetch` — the same entrypoint Cloudflare
 * calls — rather than through the tool functions directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { checkOrigin, type Env } from "../src/worker.ts";

const V = "2026-07-28";

function stubEnv(over: Partial<Env> = {}): Env {
  const map = new Map<string, string>();
  return {
    RATE_LIMIT: {
      get: async (k: string) => map.get(k) ?? null,
      put: async (k: string, v: string) => void map.set(k, v),
    },
    ...over,
  } as unknown as Env;
}

function rpc(method: string, params: Record<string, unknown> = {}, id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": V,
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

function post(body: ReturnType<typeof rpc>, headers: Record<string, string> = {}) {
  return new Request("https://mcp.upshiftsites.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": V,
      "mcp-method": body.method,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const bodyOf = async (r: Response) => JSON.parse(await r.text());

test("server/discover advertises the current spec and the tools capability", async () => {
  const res = await worker.fetch(post(rpc("server/discover")), stubEnv());
  assert.equal(res.status, 200);
  const { result } = await bodyOf(res);
  assert.deepEqual(result.supportedVersions, [V]);
  assert.equal(result.resultType, "complete");
  assert.ok(result.capabilities.tools, "tools capability must be advertised");
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "upshift");
  assert.match(result.instructions, /upshift_site_audit/);
});

test("tools/list returns exactly the three documented tools", async () => {
  const res = await worker.fetch(post(rpc("tools/list")), stubEnv());
  const { result } = await bodyOf(res);
  assert.deepEqual(
    result.tools.map((t: { name: string }) => t.name).sort(),
    ["upshift_quote", "upshift_site_audit", "upshift_template_match"],
  );
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} needs an object input schema`);
    assert.ok(tool.description.length > 40, `${tool.name} needs a usable description`);
  }
});

test("a header that disagrees with the body is rejected, not served", async () => {
  // The whole point of the mirrored headers: a proxy routing on the header
  // must not be able to disagree with the server executing on the body.
  const res = await worker.fetch(
    post(rpc("tools/call", { name: "upshift_quote", arguments: { job_type: "mcp" } }), {
      "mcp-name": "some_other_tool",
    }),
    stubEnv(),
  );
  assert.equal(res.status, 400);
  const { error } = await bodyOf(res);
  assert.equal(error.code, -32020);
});

test("an unsupported protocol version reports what is supported", async () => {
  const body = rpc("tools/list");
  body.params._meta["io.modelcontextprotocol/protocolVersion"] = "1999-01-01";
  const res = await worker.fetch(
    post(body, { "mcp-protocol-version": "1999-01-01" }),
    stubEnv(),
  );
  assert.equal(res.status, 400);
  const { error } = await bodyOf(res);
  assert.equal(error.code, -32022);
  assert.deepEqual(error.data.supported, [V]);
});

test("an unknown method is 404 with -32601, distinguishable from a missing endpoint", async () => {
  const res = await worker.fetch(post(rpc("does/notExist")), stubEnv());
  assert.equal(res.status, 404);
  const { error } = await bodyOf(res);
  assert.equal(error.code, -32601);
});

test("GET and DELETE on the endpoint are 405 — this revision has no streams or sessions", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await worker.fetch(
      new Request("https://mcp.upshiftsites.com/mcp", { method }),
      stubEnv(),
    );
    assert.equal(res.status, 405, `${method} should be 405`);
  }
});

test("the rate limit closes and reports how long to wait", async () => {
  const env = stubEnv({ RATE_LIMIT_PER_MIN: "3" } as Partial<Env>);
  const req = () =>
    worker.fetch(
      new Request("https://mcp.upshiftsites.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": V,
          "mcp-method": "tools/list",
          "cf-connecting-ip": "203.0.113.9",
        },
        body: JSON.stringify(rpc("tools/list")),
      }),
      env,
    );

  for (let i = 0; i < 3; i++) assert.equal((await req()).status, 200, `call ${i + 1} should pass`);
  const blocked = await req();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0, "must say when to retry");
});

test("callers are limited independently", async () => {
  const env = stubEnv({ RATE_LIMIT_PER_MIN: "1" } as Partial<Env>);
  const call = (ip: string) =>
    worker.fetch(
      new Request("https://mcp.upshiftsites.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": V,
          "mcp-method": "tools/list",
          "cf-connecting-ip": ip,
        },
        body: JSON.stringify(rpc("tools/list")),
      }),
      env,
    );
  assert.equal((await call("198.51.100.1")).status, 200);
  assert.equal((await call("198.51.100.1")).status, 429);
  assert.equal((await call("198.51.100.2")).status, 200, "a second caller has its own budget");
});

test("the landing page serves and names the endpoint", async () => {
  const res = await worker.fetch(
    new Request("https://mcp.upshiftsites.com/"),
    stubEnv(),
  );
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /\/mcp/);
  assert.match(html, /2026-07-28/);
});

test("origin policy: open by default, strict once an allowlist is set", () => {
  assert.equal(checkOrigin("https://anything.example", undefined).allowed, true);
  assert.equal(checkOrigin("https://evil.example", "https://good.example").allowed, false);
  assert.equal(checkOrigin("https://good.example", "https://good.example").allowed, true);
  assert.equal(
    checkOrigin(null, "https://good.example").allowed,
    true,
    "a non-browser client sends no Origin and must still work",
  );
});

test("a browser lands on the shop window; an MCP client still gets its 405", async () => {
  // /mcp is the URL in the registry listing and in every outreach email, so a
  // person pasting it into a browser is the first impression, not an edge case.
  const browser = await worker.fetch(
    new Request("https://mcp.upshiftsites.com/mcp", {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    }),
    stubEnv(),
  );
  assert.equal(browser.status, 303);
  assert.equal(new URL(browser.headers.get("location")!).pathname, "/");

  // An MCP client advertises event-stream. It must keep getting 405 — the
  // GET stream endpoint does not exist in this revision.
  for (const accept of ["application/json, text/event-stream", "text/event-stream"]) {
    const client = await worker.fetch(
      new Request("https://mcp.upshiftsites.com/mcp", { headers: { accept } }),
      stubEnv(),
    );
    assert.equal(client.status, 405, `accept: ${accept} must stay 405`);
  }

  // curl with no Accept is not a browser either.
  const bare = await worker.fetch(new Request("https://mcp.upshiftsites.com/mcp"), stubEnv());
  assert.equal(bare.status, 405);
});
