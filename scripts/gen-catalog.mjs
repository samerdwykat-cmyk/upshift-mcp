/**
 * Regenerate src/catalog.generated.ts from the live store.
 *
 * The store is the source of truth for prices and demo links. Copying them by
 * hand is how an agent ends up quoting a number nobody sells any more, so they
 * are generated, and test/catalog.test.ts re-reads the store to prove the
 * generated file has not drifted.
 *
 * Run: npm run gen:catalog
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const STORE_REPO = resolve(ROOT, "..", "upshift-agency-site");

export function readTemplatesFromStore(storeRepo = STORE_REPO) {
  // The extractor has to live inside the store repo for its relative import
  // of ./src/data/store.ts to resolve.
  const scratch = mkdtempSync(join(storeRepo, ".catalog-"));
  const script = join(scratch, "extract.mts");
  try {
    writeFileSync(
      script,
      `import { products, isTemplate } from "../src/data/store.ts";
       console.log(JSON.stringify(products.filter(isTemplate).map((p) => ({
         slug: p.slug, name: p.name, line: p.line, tagline: p.tagline,
         audience: p.audience, demo: p.demo ?? null, released: !!p.released,
         prices: Object.fromEntries((p.tiers ?? []).map((t) => [t.tier, t.price])),
       }))));`,
    );
    const out = execFileSync(process.execPath, ["--experimental-strip-types", script], {
      cwd: storeRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function renderCatalog(templates) {
  const rows = templates
    .map(
      (x) => `  {
    slug: ${JSON.stringify(x.slug)},
    line: ${JSON.stringify(x.line)},
    name: ${JSON.stringify(x.name)},
    tagline: ${JSON.stringify(x.tagline)},
    audience: ${JSON.stringify(x.audience)},
    demo: ${JSON.stringify("https://upshiftsites.com" + x.demo)},
    store: ${JSON.stringify("https://upshiftsites.com/store/" + x.slug + "/")},
    price: { solo: ${x.prices.solo}, studio: ${x.prices.studio}, agency: ${x.prices.agency}, dfy: ${x.prices.dfy} },
  },`,
    )
    .join("\n");

  return `/**
 * The catalog, generated from the live store so this server cannot quote a
 * price or link a demo that does not exist.
 *
 * Regenerate:  npm run gen:catalog
 *
 * DO NOT hand-edit. test/catalog.test.ts re-reads the store and fails on any
 * drift — an agent quoting a stale number is worse than one that cannot quote.
 */

export interface TemplateLine {
  slug: string;
  line: string;
  name: string;
  tagline: string;
  audience: string;
  /** Live demo, absolute so a tool response is copy-pasteable. */
  demo: string;
  store: string;
  price: { solo: number; studio: number; agency: number; dfy: number };
}

export const TEMPLATES: readonly TemplateLine[] = [
${rows}
] as const;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const templates = readTemplatesFromStore();
  if (templates.length === 0) throw new Error("store returned no templates");
  writeFileSync(join(ROOT, "src", "catalog.generated.ts"), renderCatalog(templates));
  console.log(`wrote src/catalog.generated.ts — ${templates.length} template lines`);
}
