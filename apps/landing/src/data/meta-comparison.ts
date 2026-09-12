/**
 * ═══ WHAT MAY BE SAID ABOUT META'S OWN AGENT ════════════════════════════════
 *
 * Meta ships a business agent that learns a business, takes a tone, books on
 * Google Calendar, reads from Drive, hands off to a person and follows up. Any
 * comparison that starts from "it only answers fixed questions" is false, and a
 * reader who checks will stop believing the rest of the page too.
 *
 * So this registry encodes three disciplines the page cannot escape:
 *
 *   1. SURFACE. The agent inside the WhatsApp Business app, the Business Agent
 *      Platform/API and Meta AI for owners are DIFFERENT products with
 *      different capabilities, prices and payers. An API token price is not the
 *      app's price, and mixing them is the single easiest way to lie by
 *      arithmetic.
 *   2. "NOT DOCUMENTED" IS NOT "DOES NOT EXIST". Where we found no primary
 *      source, the row says we found none — never that the capability is
 *      absent. Availability also varies by market and account, so a feature
 *      missing from one account proves nothing globally.
 *   3. NO SUPERLATIVE, NO NUMBER. "Better", "cheaper", "faster" and any
 *      quantified outcome need a benchmark that has been run against an
 *      eligible account. None has. The page therefore compares STATES and
 *      EVIDENCE, and says where the native option is enough.
 *
 * Every claim's evidence is dated. `REVIEW_EXPIRES_AT` is enforced by
 * `scripts/validate-marketing-claims.cjs`: once the evidence is stale the build
 * fails rather than the page quietly ageing in public.
 */

/** The day the sources below were read. Printed on the page, not hidden. */
export const COMPARISON_VERIFIED_AT = "2026-09-10";
/** After this, the comparison must be re-verified or taken down. */
export const COMPARISON_EXPIRES_AT = "2026-12-10";
export const COMPARISON_OWNER = "product-marketing" as const;

/** Meta products that must never be collapsed into "Meta". */
export type MetaSurfaceId = "appAgent" | "platformApi" | "ownerAssistant";

export interface MetaSurface {
  id: MetaSurfaceId;
  /** Primary source for what this surface is. */
  sourceUrl: string;
  /** Date Meta's page carried, or `undefined` when the page shows none. */
  sourceUpdatedAt?: string;
}

export const META_SURFACES: readonly MetaSurface[] = Object.freeze([
  Object.freeze({
    id: "appAgent",
    sourceUrl: "https://whatsappbusiness.com/products/business-app-ai-agent/",
  }),
  Object.freeze({
    id: "platformApi",
    sourceUrl: "https://developers.facebook.com/documentation/meta-business-agent/overview",
    sourceUpdatedAt: "2026-09-03",
  }),
  Object.freeze({
    id: "ownerAssistant",
    sourceUrl: "https://faq.whatsapp.com/1337427890552510",
  }),
]);

/**
 * What we are entitled to say about one side of one task.
 *
 * `notDocumented` is the load-bearing value: it records the state of our
 * SEARCH, not the state of the product.
 */
export type EvidenceState =
  | "implementedNotCertified"
  | "documented"
  | "documentedWithLimits"
  | "requiresAccountCheck"
  | "notDocumented";

/** How the two sides relate once both are stated honestly. */
export type TaskVerdict =
  | "bothCovered"
  | "differentScope"
  | "notComparable"
  | "nativeMayBeEnough";

export interface ComparisonTask {
  id: string;
  /** Which Meta product this row is about. Rendered on the row. */
  metaSurface: MetaSurfaceId;
  parallly: EvidenceState;
  meta: EvidenceState;
  verdict: TaskVerdict;
  /** Primary sources for the Meta side of THIS row. At least one, always. */
  sources: readonly string[];
}

export const COMPARISON_TASKS: readonly ComparisonTask[] = Object.freeze([
  Object.freeze({
    id: "knowledge",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documented",
    verdict: "bothCovered",
    sources: Object.freeze([
      "https://whatsappbusiness.com/products/business-app-ai-agent/",
      "https://faq.whatsapp.com/1868464300583929",
    ]),
  }),
  Object.freeze({
    id: "tone",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documented",
    verdict: "bothCovered",
    sources: Object.freeze([
      "https://whatsappbusiness.com/resources/resource-library/meta-business-agent-whatsapp/",
      "https://faq.whatsapp.com/810657551906035/?cms_platform=android",
    ]),
  }),
  Object.freeze({
    id: "booking",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documentedWithLimits",
    verdict: "differentScope",
    sources: Object.freeze(["https://faq.whatsapp.com/1474886260686868/"]),
  }),
  Object.freeze({
    id: "handoff",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documented",
    verdict: "differentScope",
    sources: Object.freeze(["https://faq.whatsapp.com/291930066973116"]),
  }),
  Object.freeze({
    id: "followUp",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documentedWithLimits",
    verdict: "differentScope",
    sources: Object.freeze([
      "https://whatsappbusiness.com/resources/success-stories/albor-arte-mx/",
    ]),
  }),
  Object.freeze({
    id: "customerPayments",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "requiresAccountCheck",
    verdict: "differentScope",
    sources: Object.freeze(["https://faq.whatsapp.com/2845236629168319"]),
  }),
  Object.freeze({
    id: "channels",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documentedWithLimits",
    verdict: "differentScope",
    sources: Object.freeze([
      "https://metabusinessai.com/waitlist",
      "https://faq.whatsapp.com/1153795669452207/?cms_platform=web",
    ]),
  }),
  Object.freeze({
    id: "operation",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documentedWithLimits",
    verdict: "differentScope",
    sources: Object.freeze([
      "https://faq.whatsapp.com/3398508707096369/?cms_platform=android",
      "https://www.facebookblueprint.com/student/path/253041-meta-business-suite-customer-connection",
    ]),
  }),
  Object.freeze({
    id: "learningControl",
    metaSurface: "appAgent",
    parallly: "implementedNotCertified",
    meta: "documented",
    verdict: "differentScope",
    sources: Object.freeze([
      "https://faq.whatsapp.com/291930066973116",
      "https://faq.whatsapp.com/1557560618760689/?cms_platform=android",
    ]),
  }),
  Object.freeze({
    id: "cost",
    metaSurface: "platformApi",
    parallly: "documented",
    meta: "requiresAccountCheck",
    // There is no price to compare: Meta announced that starting the native
    // agent is free with paid subscriptions "later" and published no figure,
    // while the API prices tokens. Declaring a winner here would require
    // inventing one side of the comparison.
    verdict: "notComparable",
    sources: Object.freeze([
      "https://about.fb.com/news/2026/06/meta-business-agent/amp/",
      "https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages",
    ]),
  }),
]);

/**
 * Situations where the native agent plausibly answers the need and this page
 * says so. A comparison that never concedes anything is an advertisement.
 */
export const NATIVE_IS_ENOUGH_CASES = Object.freeze(["single", "informational", "noOperation"] as const);

/** Claims the evidence review explicitly refused. Kept so they cannot return. */
export const REFUTED_CLAIMS = Object.freeze([
  "metaOnlyFaq",
  "metaNoBooking",
  "metaWhatsappOnly",
  "cheaper",
  "noDataToMeta",
] as const);
