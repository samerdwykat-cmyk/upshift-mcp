/**
 * The page a human gets at the root.
 *
 * Agents arrive at /mcp; people arrive here after seeing the server in a
 * registry. Its whole job is: prove the server is real, show how to connect,
 * and say what building one costs. Inlined and dependency-free — a Worker
 * serving a script tag from a CDN is a bad advertisement for the service.
 */

import { SERVICES, priceLabel, SERVICE_PAGE } from "./services.ts";
import { TEMPLATES } from "./catalog.generated.ts";

export function landingPage(): string {
  const rows = SERVICES.map(
    (s) => `<tr>
      <th scope="row">${esc(s.name)}</th>
      <td class="p">${esc(priceLabel(s))}</td>
      <td>${esc(s.turnaround)}</td>
      <td class="w">${esc(s.forWhom)}</td>
    </tr>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upshift MCP Server</title>
<meta name="description" content="Upshift's reference MCP server: audit a site's machine legibility, match a trade to a website template, and get real prices. Free, remote, current-spec.">
<style>
  :root{
    --bg:#0d0f13; --panel:#14171d; --line:#242932; --ink:#e7eaf0;
    --dim:#98a1b0; --hot:#e8590c; --ok:#3fb950; --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:52rem;margin:0 auto;padding:4rem 1.25rem 6rem}
  .eyebrow{font:600 .75rem/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--hot)}
  h1{font-size:clamp(2rem,6vw,3rem);line-height:1.05;letter-spacing:-.02em;margin:.75rem 0 0}
  .lede{color:var(--dim);font-size:1.125rem;max-width:38rem;margin:1rem 0 0}
  h2{font-size:1.25rem;letter-spacing:-.01em;margin:3.5rem 0 1rem;padding-top:1.5rem;border-top:1px solid var(--line)}
  code,pre{font-family:var(--mono);font-size:.875rem}
  pre{background:var(--panel);border:1px solid var(--line);border-radius:.5rem;
    padding:1rem;overflow-x:auto;margin:0}
  code:not(pre code){background:var(--panel);border:1px solid var(--line);
    border-radius:.25rem;padding:.1em .4em}
  .badge{display:inline-flex;align-items:center;gap:.5rem;background:var(--panel);
    border:1px solid var(--line);border-radius:99px;padding:.35rem .85rem;
    font:600 .8125rem/1 var(--mono);color:var(--dim);margin-top:1.5rem}
  .dot{width:.5rem;height:.5rem;border-radius:99px;background:var(--ok)}
  ul{padding-left:1.1rem;color:var(--dim)} li{margin:.4rem 0}
  li b{color:var(--ink);font-weight:600}
  .tbl{width:100%;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:.9375rem;min-width:34rem}
  th,td{text-align:left;padding:.7rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
  thead th{font:600 .75rem/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
  tbody th{font-weight:600}
  .p{color:var(--hot);font-weight:600;white-space:nowrap}
  .w{color:var(--dim)}
  a{color:var(--ink);text-decoration-color:var(--hot);text-underline-offset:3px}
  a:hover{color:var(--hot)}
  .cta{display:inline-block;margin-top:2rem;background:var(--hot);color:#fff;font-weight:600;
    padding:.8rem 1.4rem;border-radius:.4rem;text-decoration:none}
  footer{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);
    color:var(--dim);font-size:.875rem}
  @media(prefers-color-scheme:light){
    :root{--bg:#fff;--panel:#f6f7f9;--line:#e3e6ea;--ink:#14171d;--dim:#5a6472}
  }
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">Model Context Protocol</p>
  <h1>The Upshift MCP server</h1>
  <p class="lede">Three tools an agent can call right now: audit a website's machine
  legibility, match a trade to a website template, and get real prices. Free, remote,
  and built on the current spec revision.</p>
  <p class="badge"><span class="dot"></span> Live · Streamable HTTP · spec 2026-07-28</p>

  <h2>Connect</h2>
  <pre><code>{
  "mcpServers": {
    "upshift": {
      "type": "http",
      "url": "https://mcp.upshiftsites.com/mcp"
    }
  }
}</code></pre>

  <h2>Tools</h2>
  <ul>
    <li><b>upshift_site_audit(url)</b> — fetches a live page and reports structured data,
    llms.txt, robots.txt, title and meta budgets, headings, alt-text coverage, HTTPS and
    document weight, with a 0-100 score.</li>
    <li><b>upshift_template_match(industry, needs?)</b> — ranks Upshift's
    ${TEMPLATES.length} template lines against a trade, with live demo links and prices.</li>
    <li><b>upshift_quote(job_type, scope?)</b> — the real price table for MCP server work
    and for websites.</li>
  </ul>

  <h2>What we charge to build one of these</h2>
  <div class="tbl"><table>
    <thead><tr><th>Offer</th><th>Price</th><th>Turnaround</th><th>For</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <p class="lede" style="font-size:1rem">A production-grade MCP server built in-house runs
  $15,000&ndash;40,000 of engineering time. We are not competing with free; we are competing
  with your backlog.</p>
  <a class="cta" href="${SERVICE_PAGE}">See the full service page</a>

  <footer>
    Built by <a href="https://upshiftsites.com/">Upshift</a>.
    This server is rate limited and read-only. Source of every price on this page:
    the live store.
  </footer>
</div>
</body>
</html>`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
