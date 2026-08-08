export const MARKETING_CLAIM_REGISTRY_VERSION = 1 as const;

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
  localeKey: `socialProof.stat${1 | 2 | 3 | 4 | 5}Label`;
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
 */
export const MARKETING_CLAIMS = Object.freeze({
  verticalCount: {
    claimId: 'product.verticals.count', capabilityId: 'vertical_catalog_v1', status: 'verified', value: 18,
    localeKey: 'socialProof.stat1Label', locales: ['es', 'en', 'pt', 'fr'],
    localePaths: [
      'meta.description', 'nav.viewAllSolutions', 'verticals.subtitle',
      'solutions.heroSubtitle', 'howItWorks.step2Desc', 'howItWorks.step2Tag',
      'cta.guarantees', 'product.agentDesc', 'product.agentFeature2',
    ],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-08-08', expiresAt: '2026-11-08', owner: 'product-engineering',
    evidence: [
      { id: 'vertical-manifest', repositoryPath: 'packages/shared/src/vertical-capability-manifest.ts', description: 'Canonical 18-industry manifest.' },
      { id: 'vertical-matrix', repositoryPath: 'apps/api/scripts/run-vertical-contract-matrix.cjs', description: 'Static 76 x 4 x 5 contract runner.' },
    ],
  },
  channelCount: {
    claimId: 'product.channels.adapters.count', capabilityId: 'channel_adapter_registry', status: 'verified', value: 6,
    localeKey: 'socialProof.stat2Label', locales: ['es', 'en', 'pt', 'fr'],
    localePaths: ['cta.guarantees', 'product.channelsFeaturesTitle'],
    scope: { plans: 'plan_dependent_catalog', regions: 'global' }, verifiedAt: '2026-08-08', expiresAt: '2026-11-08', owner: 'product-engineering',
    evidence: [{ id: 'channel-module', repositoryPath: 'apps/api/src/modules/channels/channels.module.ts', description: 'Runtime adapter registration.' }],
  },
  interfaceLanguageCount: {
    claimId: 'product.interface_languages.count', capabilityId: 'interface_i18n', status: 'verified', value: 4,
    localeKey: 'socialProof.stat3Label', locales: ['es', 'en', 'pt', 'fr'],
    localePaths: ['trust.latamBadge', 'cta.guarantees'],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-08-08', expiresAt: '2026-11-08', owner: 'product-engineering',
    evidence: [{ id: 'landing-locales', repositoryPath: 'apps/landing/messages', description: 'Four complete landing locale catalogs.' }],
  },
  knowledgeTierCount: {
    claimId: 'product.knowledge_tiers.count', capabilityId: 'knowledge_architecture', status: 'verified', value: 5,
    localeKey: 'socialProof.stat4Label', locales: ['es', 'en', 'pt', 'fr'],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-08-08', expiresAt: '2026-11-08', owner: 'product-engineering',
    evidence: [
      { id: 'knowledge-service', repositoryPath: 'apps/api/src/modules/knowledge/knowledge.service.ts', description: 'RAG and knowledge runtime.' },
      { id: 'catalog-service', repositoryPath: 'apps/api/src/modules/catalog/catalog.service.ts', description: 'Catalog tier runtime.' },
    ],
  },
  promptLayerCount: {
    claimId: 'product.prompt_layers.count', capabilityId: 'prompt_assembler_v3', status: 'verified', value: 3,
    localeKey: 'socialProof.stat5Label', locales: ['es', 'en', 'pt', 'fr'],
    scope: { plans: 'all', regions: 'global' }, verifiedAt: '2026-08-08', expiresAt: '2026-11-08', owner: 'product-engineering',
    evidence: [{ id: 'prompt-assembler', repositoryPath: 'apps/api/src/modules/conversations/prompt-assembler.service.ts', description: 'Contract, persona and turn-context assembler.' }],
  },
} as const satisfies Record<string, MarketingClaimContract>);
