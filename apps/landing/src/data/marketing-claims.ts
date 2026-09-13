export const MARKETING_CLAIM_REGISTRY_VERSION = 2 as const;

export type MarketingClaimStatus = 'verified' | 'illustrative' | 'disabled';

export interface MarketingClaimEvidence {
  id: string;
  repositoryPath: string;
  description: string;
}

export interface MarketingClaimContract {
  claimId: string;
  capabilityId: string;
  status: MarketingClaimStatus;
  value: number;
  localeKey: `socialProof.stat${1 | 2 | 3}Label`;
  localePaths?: readonly string[];
  locales: readonly ['es', 'en', 'pt', 'fr'];
  scope: { plans: 'all' | 'plan_dependent_catalog'; regions: 'global' };
  verifiedAt: string;
  expiresAt: string;
  owner: 'product-engineering';
  evidence: readonly MarketingClaimEvidence[];
}

/**
 * Positive, build-enforced registry for quantitative claims on the explicitly
 * registered landing surfaces below. This is not a general rendered-HTML
 * scanner: new surfaces must be registered before they may carry a number.
 * Narrative copy remains subject to the denylist until it is migrated to an
 * explicit claimId.
 *
 * ── VERSION 2: WHAT LEFT, AND WHY ──────────────────────────────────────────
 *
 * Three claims were retired rather than restated.
 *
 * `product.verticals.count` put the number eighteen in front of the words
 * "vertical configurations" across nine locale paths. It was defensible as a
 * count of PUBLIC industry presets and
 * indefensible as a product claim: the canonical catalogue is 20 industries and
 * 76 profiles, of which the audited closure report certifies zero. A number that
 * is simultaneously smaller than the catalogue and larger than what has been
 * proven is not made honest by swapping the digit — so the copy now states the
 * certification STATE, and the count is gone from every customer-facing string.
 *
 * `product.knowledge_tiers.count` and `product.prompt_layers.count` were
 * internal architecture. Nobody chooses a platform on how many tiers its RAG has.
 *
 * What replaced them is the pair a reader can act on — how many channels you can
 * connect, and how many have finished certification — with the second one
 * published at its real value of zero.
 */
export const MARKETING_CLAIMS = Object.freeze({
  selfServiceChannelCount: {
    claimId: 'product.channels.self_service.count', capabilityId: 'self_service_channels', status: 'verified', value: 5,
    localeKey: 'socialProof.stat1Label', locales: ['es', 'en', 'pt', 'fr'],
    localePaths: ['cta.guarantees', 'product.channelsFeaturesTitle'],
    scope: { plans: 'plan_dependent_catalog', regions: 'global' }, verifiedAt: '2026-09-12', expiresAt: '2026-12-12', owner: 'product-engineering',
    evidence: [{ id: 'channel-policy', repositoryPath: 'packages/shared/src/channel-policy.ts', description: 'Canonical self-service channel policy: whatsapp, instagram, messenger, telegram, web_widget.' }],
  },
  certifiedChannelCount: {
    claimId: 'product.channels.certified.count', capabilityId: 'certified_channels', status: 'verified', value: 0,
    localeKey: 'socialProof.stat2Label', locales: ['es', 'en', 'pt', 'fr'],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-09-12', expiresAt: '2026-12-12', owner: 'product-engineering',
    evidence: [
      { id: 'closure-report', repositoryPath: 'docs/audits/2026-09-09/closure-report.md', description: 'Derived closure report: 0 of 5 channels and 0 of 76 profiles have finished certification.' },
      { id: 'closure-report-data', repositoryPath: 'docs/audits/2026-09-09/closure-report.json', description: 'Machine-readable counters behind the same report.' },
    ],
  },
  interfaceLanguageCount: {
    claimId: 'product.interface_languages.count', capabilityId: 'interface_i18n', status: 'verified', value: 4,
    localeKey: 'socialProof.stat3Label', locales: ['es', 'en', 'pt', 'fr'],
    localePaths: ['trust.latamBadge', 'cta.guarantees'],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-09-12', expiresAt: '2026-12-12', owner: 'product-engineering',
    evidence: [{ id: 'landing-locales', repositoryPath: 'apps/landing/messages', description: 'Four complete landing locale catalogs plus the es-AR regional overlay.' }],
  },
} as const satisfies Record<string, MarketingClaimContract>);
