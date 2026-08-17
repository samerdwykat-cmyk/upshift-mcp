/**
 * Guarded fetch for the one tool that takes a URL from the caller.
 *
 * `upshift_site_audit` fetches whatever an agent hands it, which makes this
 * server a confused deputy unless the target is checked first. The rules:
 * http(s) only, no credentials in the URL, no private/loopback/link-local
 * literals, redirects followed by hand so every hop is re-checked, a hard
 * timeout, and a byte cap so a 2GB response cannot exhaust the isolate.
 *
 * Known gap, stated rather than papered over: hostnames are checked as
 * written, not resolved. A public name that resolves to a private address
 * (DNS rebinding) still passes. Closing that needs resolution before connect,
 * which Workers does not expose — see docs/VALIDATION.md.
 */

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  body: string;
  /** Bytes actually read (may be less than Content-Length if truncated). */
  bytes: number;
  truncated: boolean;
  elapsedMs: number;
  /** Every URL in the redirect chain, starting with the requested one. */
  chain: string[];
}

export class UnsafeUrlError extends Error {}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

/** Hostnames that are never a customer's website. */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

/** Decimal-dotted IPv4 in a range that must never be reachable from here. */
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((o) => Number(o) > 255)) return true; // malformed → refuse
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * IPv6 is allowlisted, not denylisted: only global unicast (2000::/3) is
 * reachable, everything else refused.
 *
 * Enumerating the bad ranges is how this leaks. `http://[::ffff:127.0.0.1]/`
 * looks like a decimal-dotted loopback, but WHATWG URL parsing normalises the
 * hostname to `[::ffff:7f00:1]` — so a check written against the dotted form
 * never fires and the request reaches loopback. Allowing only 2000::/3 makes
 * every mapped, loopback, unique-local, link-local and multicast form fail by
 * construction rather than by enumeration.
 */
function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false; // not an IPv6 literal
  const firstHextet = /^([0-9a-f]{0,4}):/.exec(h)?.[1] ?? "";
  if (firstHextet === "") return true; // starts with "::" — never global unicast
  const value = Number.parseInt(firstHextet, 16);
  if (Number.isNaN(value)) return true;
  return value < 0x2000 || value > 0x3fff;
}

/** Throws UnsafeUrlError unless this is a URL we are willing to fetch. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`only http and https are supported, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs carrying credentials are refused");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new UnsafeUrlError(`refusing to fetch internal host: ${host}`);
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new UnsafeUrlError(`refusing to fetch private address: ${host}`);
  }
  return url;
}

/**
 * Fetch with the guard applied at every redirect hop.
 *
 * `redirect: "manual"` is the point: letting the runtime follow redirects
 * would check only the first URL, and an open redirect on a public host is
 * the standard way past a first-hop-only check.
 */
export async function safeFetch(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SafeFetchResult> {
  const started = Date.now();
  const chain: string[] = [];
  let current = assertSafeUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    chain.push(current.toString());
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal,
      headers: {
        // Identify honestly. A shop blocking this is entitled to.
        "user-agent": "UpshiftSiteAudit/1.0 (+https://upshiftsites.com/store/services/)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      current = assertSafeUrl(new URL(location, current).toString());
      continue;
    }

    const { body, bytes, truncated } = await readCapped(response);
    return {
      finalUrl: current.toString(),
      status: response.status,
      headers: response.headers,
      body,
      bytes,
      truncated,
      elapsedMs: Date.now() - started,
      chain,
    };
  }
  throw new UnsafeUrlError(`more than ${MAX_REDIRECTS} redirects from ${raw}`);
}

/** Read at most MAX_BYTES, then stop pulling from the stream. */
async function readCapped(
  response: Response,
): Promise<{ body: string; bytes: number; truncated: boolean }> {
  if (!response.body) return { body: "", bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      if (bytes + value.byteLength > MAX_BYTES) {
        chunks.push(value.subarray(0, MAX_BYTES - bytes));
        bytes = MAX_BYTES;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { body: new TextDecoder().decode(merged), bytes, truncated };
}

/** Fetch a sibling path (llms.txt, robots.txt) — absence is a normal answer. */
export async function probePath(
  origin: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ present: boolean; status: number; sample?: string }> {
  try {
    const result = await safeFetch(new URL(path, origin).toString(), fetchImpl);
    return {
      present: result.status === 200 && result.bytes > 0,
      status: result.status,
      sample: result.status === 200 ? result.body.slice(0, 400) : undefined,
    };
  } catch {
    return { present: false, status: 0 };
  }
}
