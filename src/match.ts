/**
 * Template matching for `upshift_template_match`.
 *
 * Deliberately a transparent scorer rather than an embedding: an agent asking
 * "which template fits a roofing company" deserves an answer it can explain to
 * the person who asked, and every point here traces to a word that matched.
 */

import { TEMPLATES, type TemplateLine } from "./catalog.generated.ts";

/**
 * Words that should pull a trade toward a line the slug does not name.
 *
 * Rule for adding one: it must name a *trade or the work*, never a place or a
 * generic object. "yard" was here once and sent "submarine refit yard" to
 * Landscaping with full confidence — a location noun matches businesses that
 * merely occupy one. "lawn", "hardscape" and "irrigation" carry the trade;
 * "yard" only carries a setting.
 */
const SYNONYMS: Record<string, string[]> = {
  "auto-body": ["collision", "body shop", "bodyshop", "autobody", "paint", "refinish", "frame", "dent", "pdr", "adas", "bumper", "insurance repair"],
  detailing: ["detail", "detailer", "ceramic coating", "paint correction", "ppf", "tint", "wash", "wrap"],
  // "contractor" is deliberately absent: it is a business form, not a trade —
  // landscapers, roofers and electricians are all contractors, so it ties every
  // line at once. The actual trades below carry the query.
  "home-services": ["hvac", "heating", "cooling", "air conditioning", "plumber", "plumbing", "roofer", "roofing", "electrician", "electrical", "furnace", "drain", "septic", "garage door"],
  landscaping: ["landscape", "landscaper", "lawn", "lawn care", "garden", "gardening", "hardscape", "irrigation", "tree service", "snow removal", "mowing"],
  dental: ["dentist", "dental", "orthodontic", "orthodontist", "implant", "aligner", "invisalign", "hygienist", "endodontic"],
  "med-aesthetics": ["med spa", "medspa", "botox", "filler", "injectable", "iv therapy", "glp-1", "semaglutide", "weight loss", "laser", "aesthetic", "skin"],
  "plastic-surgery": ["plastic surgeon", "cosmetic surgery", "rhinoplasty", "breast augmentation", "liposuction", "tummy tuck", "facelift", "surgeon"],
  law: ["lawyer", "attorney", "law firm", "legal", "personal injury", "family law", "estate", "divorce", "litigation", "counsel"],
  "chiro-pt": ["chiropractor", "chiropractic", "physical therapy", "physiotherapy", "physio", "rehab", "sports medicine", "adjustment", "dry needling"],
  veterinary: ["vet", "veterinarian", "animal hospital", "pet clinic", "small animal", "spay", "neuter"],
  "real-estate": ["realtor", "real estate", "agent", "broker", "brokerage", "listings", "idx", "home valuation", "property"],
  gym: ["fitness", "crossfit", "strength", "personal trainer", "studio", "bootcamp", "yoga", "pilates", "class"],
  salon: ["hair", "barber", "barbershop", "stylist", "colour", "color", "blow dry", "nails", "beauty", "booth rent"],
  restaurant: ["cafe", "bistro", "bar", "eatery", "menu", "dining", "kitchen", "pub", "wine bar", "coffee"],
};

export interface Match {
  template: TemplateLine;
  score: number;
  /** The words that earned the points, so the answer can justify itself. */
  because: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s+&-]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Whole-word phrase match.
 *
 * Substring matching sends "barbershop" to the Restaurant line, because
 * "bar" is one of its trade words. Trades are named by words, so the match
 * has to respect word edges.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(haystack);
}

/**
 * Rank every template line against a free-text industry and optional needs.
 *
 * Scoring: an exact slug or line hit dominates (100), a synonym hit is worth
 * 40, and needs-text overlap against the tagline/audience adds a little. Ties
 * break alphabetically so the output is stable across calls.
 */
export function matchTemplates(industry: string, needs?: string): Match[] {
  const q = norm(industry);
  const n = norm(needs ?? "");
  if (!q) return [];

  const scored = TEMPLATES.map((template) => {
    let score = 0;
    const because: string[] = [];

    const slugWords = template.slug.replace(/-/g, " ");
    if (q === slugWords || q === norm(template.line)) {
      score += 100;
      because.push(`"${industry}" is the ${template.line} line`);
    } else if (containsPhrase(q, slugWords) || containsPhrase(norm(template.line), q)) {
      // Word-bounded, or "lawn care" scores as the Law line because "lawn"
      // contains "law" — and a landscaper is quoted a law-firm template.
      score += 70;
      because.push(`"${industry}" names the ${template.line} line`);
    }

    for (const word of SYNONYMS[template.slug] ?? []) {
      if (containsPhrase(q, word)) {
        score += 40;
        because.push(`"${word}" is a ${template.line} trade`);
        break;
      }
    }

    // Needs text is a nudge, never the deciding factor.
    if (n) {
      const haystack = norm(`${template.tagline} ${template.audience}`);
      const hits = n
        .split(" ")
        .filter((w) => w.length > 4 && haystack.includes(w))
        .slice(0, 3);
      if (hits.length) {
        score += hits.length * 6;
        because.push(`needs mention ${hits.map((h) => `"${h}"`).join(", ")}`);
      }
    }

    return { template, score, because };
  });

  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.template.slug.localeCompare(b.template.slug));
}

export { TEMPLATES };
