/**
 * Code-backed product state used by the landing.
 *
 * What changed here, and why: this used to be five ARCHITECTURE counts —
 * verticals, channels, interface languages, knowledge tiers, prompt layers.
 * Three of them answered no question a buyer asks (nobody chooses a platform on
 * how many prompt layers it assembles), and one of them — the vertical count —
 * put a number on a catalogue that is larger than the number suggested and
 * whose entries are, without exception, NOT certified. A count that flatters
 * and misleads at the same time is worse than no count.
 *
 * What remains is a STATE a reader can act on and the closure report can back:
 * how many channels you can connect yourself, how many of them have finished
 * certification (zero, today), and how many languages the interface speaks.
 *
 * `check:claims` cross-checks these values against the canonical channel policy
 * and the locale files, and fails when the certified count drifts from the
 * audited closure report.
 */
export const PRODUCT_CAPABILITY_COUNTS = {
  /** Channels a tenant can connect from the dashboard, subject to plan. */
  selfServiceChannels: 5,
  /**
   * Channels with end-to-end certification completed.
   *
   * `docs/audits/2026-09-09/closure-report.md` reports 0 of 5. It is published
   * rather than hidden because a page that lists five channels and says nothing
   * about certification invites the reader to assume all five are certified —
   * which is precisely the claim the report refuses.
   */
  certifiedChannels: 0,
  interfaceLanguages: 4,
  /**
   * Industry pages published on this site. NOT a marketing claim and not
   * rendered as a headline number: it exists so the validator can keep the
   * sitemap, the router and the solutions hub agreeing with each other.
   */
  publishedIndustryPages: 18,
} as const;
