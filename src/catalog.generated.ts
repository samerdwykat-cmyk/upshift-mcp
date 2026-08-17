/**
 * The catalog, generated from the live store so this server cannot quote a
 * price or link a demo that does not exist.
 *
 * Regenerate:  npm run gen:catalog     (reads ../upshift-agency-site/src/data/store.ts)
 *
 * DO NOT hand-edit. Every field here is asserted against the store in
 * test/catalog.test.ts — a drifted price fails the build, which is the point:
 * an agent quoting a stale number is worse than an agent that cannot quote.
 */

export interface TemplateLine {
  slug: string;
  line: string;
  name: string;
  tagline: string;
  audience: string;
  demo: string;
  store: string;
  price: { solo: number; studio: number; agency: number; dfy: number };
}

export const TEMPLATES: readonly TemplateLine[] = [
  {
    slug: "auto-body",
    line: "Body Shop in a Box",
    name: "Auto Body Shop Website Template",
    tagline: "Collision, paint & frame — an estimate-first site that wins the job before the insurer steers it.",
    audience: "Independent body shops, collision centers, paint & refinish shops, PDR specialists",
    demo: "https://upshiftsites.com/demo/auto-body/",
    store: "https://upshiftsites.com/store/auto-body/",
    price: { solo: 79, studio: 149, agency: 349, dfy: 1500 },
  },
  {
    slug: "plastic-surgery",
    line: "Plastic Surgery",
    name: "Plastic Surgery Website Template",
    tagline: "Rhinoplasty, breast & body: a consultation-first surgical site with quoted-in-full pricing.",
    audience: "Plastic surgeons, cosmetic surgery practices, medical marketing agencies",
    demo: "https://upshiftsites.com/demo/plastic-surgery/",
    store: "https://upshiftsites.com/store/plastic-surgery/",
    price: { solo: 129, studio: 249, agency: 499, dfy: 1500 },
  },
  {
    slug: "med-aesthetics",
    line: "Med-Aesthetics",
    name: "Med-Aesthetics Website Template",
    tagline: "GLP-1, IV therapy & injectables — a booking-first site for cash-pay clinics.",
    audience: "Med spas, medical weight-loss & IV clinics, injectors, aesthetic practices",
    demo: "https://upshiftsites.com/demo/med-aesthetics/",
    store: "https://upshiftsites.com/store/med-aesthetics/",
    price: { solo: 79, studio: 149, agency: 349, dfy: 1500 },
  },
  {
    slug: "home-services",
    line: "Home-Services",
    name: "Home-Services Website Template",
    tagline: "HVAC, roofing & plumbing — a click-to-call, quote-first site built to lower your cost per lead.",
    audience: "HVAC, roofing, plumbing & electrical contractors, and the agencies building for them",
    demo: "https://upshiftsites.com/demo/home-services/",
    store: "https://upshiftsites.com/store/home-services/",
    price: { solo: 59, studio: 119, agency: 299, dfy: 1500 },
  },
  {
    slug: "real-estate",
    line: "Real-Estate",
    name: "Real-Estate Agent Website Template",
    tagline: "IDX-ready listings, neighborhood guides & a home-valuation page that turns browsers into seller leads.",
    audience: "Solo agents, teams, boutique brokerages & the marketers building for them",
    demo: "https://upshiftsites.com/demo/real-estate/",
    store: "https://upshiftsites.com/store/real-estate/",
    price: { solo: 49, studio: 99, agency: 249, dfy: 1500 },
  },
  {
    slug: "dental",
    line: "Dental",
    name: "Dental Practice Website Template",
    tagline: "Family + cosmetic dentistry — a booking-first site with implant & aligner program pages.",
    audience: "Family, cosmetic & implant dentistry practices, DSO-independent clinics",
    demo: "https://upshiftsites.com/demo/dental/",
    store: "https://upshiftsites.com/store/dental/",
    price: { solo: 79, studio: 149, agency: 349, dfy: 1500 },
  },
  {
    slug: "law",
    line: "Law",
    name: "Law Firm Website Template",
    tagline: "Personal injury, family & estate — a case-review-first site with claim-careful results.",
    audience: "Personal-injury, family & estate firms, solo attorneys, legal marketers",
    demo: "https://upshiftsites.com/demo/law/",
    store: "https://upshiftsites.com/store/law/",
    price: { solo: 99, studio: 199, agency: 399, dfy: 1500 },
  },
  {
    slug: "chiro-pt",
    line: "Chiro + PT",
    name: "Chiropractic & PT Website Template",
    tagline: "Chiro + physical therapy — a booking-first clinic site with a conditions-treated SEO surface.",
    audience: "Chiropractors, physical therapists, combined chiro+PT and sports-rehab clinics",
    demo: "https://upshiftsites.com/demo/chiro-pt/",
    store: "https://upshiftsites.com/store/chiro-pt/",
    price: { solo: 79, studio: 149, agency: 349, dfy: 1500 },
  },
  {
    slug: "veterinary",
    line: "Veterinary",
    name: "Veterinary Clinic Website Template",
    tagline: "Small-animal care — a booking-first clinic site with urgent-care triage and honest pricing.",
    audience: "Small-animal clinics, independent vets, multi-doctor practices",
    demo: "https://upshiftsites.com/demo/veterinary/",
    store: "https://upshiftsites.com/store/veterinary/",
    price: { solo: 79, studio: 149, agency: 349, dfy: 1500 },
  },
  {
    slug: "landscaping",
    line: "Landscaping",
    name: "Landscaping Website Template",
    tagline: "Design-build & maintenance — an estimate-first site with honest big-project pricing.",
    audience: "Design-build landscapers, lawn-care companies, hardscape contractors",
    demo: "https://upshiftsites.com/demo/landscaping/",
    store: "https://upshiftsites.com/store/landscaping/",
    price: { solo: 59, studio: 119, agency: 299, dfy: 1500 },
  },
  {
    slug: "gym",
    line: "Gym & Fitness",
    name: "Gym & Fitness Studio Website Template",
    tagline: "Strength studios, CrossFit boxes & small gyms — a timetable-first site that fills classes.",
    audience: "Strength gyms, CrossFit boxes, boutique studios, PT-led fitness businesses, and the agencies building for them",
    demo: "https://upshiftsites.com/demo/gym/",
    store: "https://upshiftsites.com/store/gym/",
    price: { solo: 59, studio: 119, agency: 299, dfy: 1500 },
  },
  {
    slug: "salon",
    line: "Salon & Barber",
    name: "Salon & Barbershop Website Template",
    tagline: "Salons & barbershops — a booking-first site where the price list is the design.",
    audience: "Hair salons, barbershops, colour studios, blow-dry bars, booth renters, and the agencies building for them",
    demo: "https://upshiftsites.com/demo/salon/",
    store: "https://upshiftsites.com/store/salon/",
    price: { solo: 59, studio: 119, agency: 299, dfy: 1500 },
  },
  {
    slug: "restaurant",
    line: "Restaurant",
    name: "Restaurant Website Template",
    tagline: "Neighbourhood restaurants & bars — dark-first, with the actual menu on the home page.",
    audience: "Neighbourhood restaurants, bistros, wine bars, chef-owned rooms, and the agencies building for them",
    demo: "https://upshiftsites.com/demo/restaurant/",
    store: "https://upshiftsites.com/store/restaurant/",
    price: { solo: 49, studio: 99, agency: 249, dfy: 1500 },
  },
  {
    slug: "detailing",
    line: "Detailing",
    name: "Auto Detailing Website Template",
    tagline: "Before/after proof, package tiers & one tap-to-text booking action — one page that books details.",
    audience: "Owner-operators of one-to-three-bay detailing studios who book by text and IG DM",
    demo: "https://upshiftsites.com/demo/detailing/",
    store: "https://upshiftsites.com/store/detailing/",
    price: { solo: 59, studio: 119, agency: 299, dfy: 1500 },
  },
] as const;
