import {
    BASE_INTENT_ALIASES,
    COUNTRY_LANGUAGE_PACKS,
    SUBTYPE_TERMINOLOGY_IDS,
    TERMINOLOGY_LANGUAGES,
    VERTICAL_AUTHORING_PACKAGE_VERSION,
    buildDomainContractDraft,
    composeSubtypeEvalPack,
    countryMarketPolicyFor,
    listCanonicalSubtypeExperienceProfileIds,
    listSubtypeExperienceProfileIds,
    navigationSurfaceKind,
    resolveSubtypeExperienceProfile,
    subtypeProfileId,
    subtypeTerminologyFor,
    type AuthoredField,
    type AuthoringNavigationItemV1,
    type AuthoringSource,
    type AuthoringSourceKind,
    type AuthoringTemplateKind,
    type SlotSchema,
    type TenantVerticalConfig,
    type VerticalAuthoringPackageV1,
    type VerticalDefinition,
} from '@parallext/shared';
import { getVerticalDefinition } from './vertical-definitions';
import { withSubtypeNavigation, VERTICAL_ROUTE_NAV_ITEM } from './subtype-navigation';
import { buildVerticalOperationContract } from './vertical-operation-contract';
import {
    VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION,
    resolveVerticalSubtypePersonaContract,
} from '../persona/vertical-subtype-persona-contract';

const OPERATIONAL_ROLES = Object.freeze([
    'super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent',
]);
const CATALOG_ROLES = Object.freeze([
    'super_admin', 'tenant_admin', 'tenant_supervisor',
]);
const LANGUAGES = Object.freeze(['es', 'en', 'pt', 'fr'] as const);

function source(
    kind: AuthoringSourceKind,
    reference: string,
    inherited = false,
    expertReviewRequired = false,
): AuthoringSource {
    return Object.freeze({ kind, reference, inherited, expertReviewRequired });
}

function authored<T>(value: T, fieldSource: AuthoringSource): AuthoredField<T> {
    return Object.freeze({ value, source: fieldSource });
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function localized(value: unknown): Readonly<Record<string, string>> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const language of LANGUAGES) {
        if (typeof record[language] === 'string' && String(record[language]).trim()) {
            result[language] = String(record[language]).trim();
        }
    }
    return Object.keys(result).length ? Object.freeze(result) : null;
}

function uniqueSlots(intents: readonly { slots: readonly SlotSchema[] }[]): SlotSchema[] {
    const byKey = new Map<string, SlotSchema>();
    for (const intent of intents) {
        for (const slot of intent.slots) if (!byKey.has(slot.key)) byKey.set(slot.key, slot);
    }
    return [...byKey.values()];
}

function routeItemId(route: string): string {
    return VERTICAL_ROUTE_NAV_ITEM[route]
        || route.replace(/^\/admin\//, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function navigationItems(
    config: TenantVerticalConfig,
    routes: readonly string[],
): AuthoringNavigationItemV1[] {
    const order = config.sidebar?.itemOrder || [];
    const labels = config.sidebar?.labelOverrides || {};
    return routes.map((route, fallbackOrder) => {
        const id = routeItemId(route);
        const declaredOrder = order.indexOf(id);
        // Gate 4 already owns the semantic classification consumed by the
        // real sidebar. Reusing it here prevents a writer deep link from
        // turning Courses/Pets into a catalogue or Inbox/CRM into one merely
        // because they are not subtype-specific routes.
        const surfaceKind = navigationSurfaceKind(id);
        const classification = surfaceKind === 'register' || surfaceKind === 'mixed'
            ? 'daily_work' as const
            : surfaceKind === 'catalogue'
                ? 'catalog' as const
                : 'supporting' as const;
        return Object.freeze({
            id,
            route,
            order: declaredOrder >= 0 ? declaredOrder : order.length + fallbackOrder,
            classification,
            labels: localized(labels[id]),
            roles: classification === 'catalog' ? CATALOG_ROLES : OPERATIONAL_ROLES,
            mobileProjection: classification === 'daily_work'
                ? 'capability_workspace' as const
                : 'web_only' as const,
        });
    }).sort((left, right) => left.order - right.order);
}

function template(
    kind: AuthoringTemplateKind,
    component: string,
    fieldSource: AuthoringSource,
) {
    return Object.freeze({ kind, component, source: fieldSource });
}

export interface BuildVerticalAuthoringPackageInput {
    industry: string;
    subtype?: string | null;
    /** Preserves the exact legacy identity in compatibility fixtures. */
    requestedProfileId?: string;
    definition?: VerticalDefinition;
}

/**
 * Compose the 15 mandatory authoring dimensions from executable registries.
 * No value is copied into a parallel source of truth: every field names the
 * registry/component it came from, including inherited and unresolved values.
 */
export function buildVerticalAuthoringPackage(
    input: BuildVerticalAuthoringPackageInput,
): VerticalAuthoringPackageV1 {
    const requestedProfileId = input.requestedProfileId
        || subtypeProfileId(input.industry, input.subtype);
    const profile = resolveSubtypeExperienceProfile(input.industry, input.subtype);
    const definition = input.definition || getVerticalDefinition(profile.industry);
    const domain = buildDomainContractDraft(profile.industry, profile.subtype);
    const operations = buildVerticalOperationContract(profile.industry, profile.subtype);
    const explicitTerminology = SUBTYPE_TERMINOLOGY_IDS.includes(profile.id);
    const personaContract = resolveVerticalSubtypePersonaContract(profile.industry, profile.subtype);
    const subtypeTerms = subtypeTerminologyFor(profile.industry, profile.subtype);
    const baseTerms = definition.terminology;

    const primaryTerm = localized(subtypeTerms?.primaryObject);
    const customerTerm = localized(subtypeTerms?.customerNoun) || localized(baseTerms.customerNoun);
    const transactionTerm = localized(subtypeTerms?.transactionNoun) || localized(baseTerms.transactionNoun);
    const explicitSource = (path: string) => source(
        'profile_explicit', `subtype-terminology.${profile.id}.${path}`, false, false,
    );
    const inheritedSource = (path: string) => source(
        'vertical_default', `vertical-definitions.${profile.industry}.terminology.${path}`, true, true,
    );
    const primarySource = explicitTerminology && subtypeTerms?.primaryObject
        ? explicitSource('primaryObject')
        : source('manifest_explicit', `capability-manifest.${profile.id}.primaryObject`, true, true);
    const customerSource = explicitTerminology && subtypeTerms?.customerNoun
        ? explicitSource('customerNoun')
        : inheritedSource('customerNoun');
    const transactionSource = explicitTerminology && subtypeTerms?.transactionNoun
        ? explicitSource('transactionNoun')
        : inheritedSource('transactionNoun');

    const config = withSubtypeNavigation({
        industry: profile.industry,
        subType: profile.subtype === '__none__' ? null : profile.subtype,
        terminology: definition.terminology,
        sidebar: definition.sidebar,
        dashboard: definition.dashboard,
        bookingEnabled: definition.bookingEnabled,
    });
    const navItems = navigationItems(config, profile.capability.routes);
    const navGaps: string[] = [];
    const daily = navItems.filter(item => item.classification === 'daily_work');
    if (daily.length && navItems[0]?.classification !== 'daily_work') navGaps.push('daily_work_not_first');
    const labelCollisions = new Map<string, string>();
    for (const item of navItems) {
        for (const [language, label] of Object.entries(item.labels || {})) {
            const key = `${language}:${label.toLocaleLowerCase()}`;
            if (labelCollisions.has(key) && labelCollisions.get(key) !== item.id) {
                navGaps.push(`label_collision.${language}.${label}`);
            }
            labelCollisions.set(key, item.id);
        }
    }

    const allSlots = uniqueSlots(domain.intents);
    const readers = operations.actions.filter(action => action.effect === 'read').map(action => action.tool);
    const writers = operations.actions.filter(action => action.effect !== 'read').map(action => action.tool);
    const expectedTools = unique(domain.intents.flatMap(intent => [...intent.toolPlan]));
    const toolGaps = operations.actions
        .filter(action => action.gaps.length > 0)
        .map(action => Object.freeze({ tool: action.tool, reasons: Object.freeze([...action.gaps]) }));
    const activeObjects = unique(operations.actions
        .map(action => action.activeObject || '')
        .filter(Boolean));

    const regulatedIntents = domain.intents
        .filter(intent => intent.slots.some(slot => slot.sensitivity === 'regulated'))
        .map(intent => intent.key);
    const transactional = domain.intents.filter(intent => intent.commits).map(intent => intent.key);
    const informational = domain.intents
        .filter(intent => !intent.commits && intent.fallback === 'answer')
        .map(intent => intent.key);
    const guided = domain.intents
        .filter(intent => !intent.commits && intent.fallback !== 'answer')
        .map(intent => intent.key);

    const packs = Object.fromEntries(LANGUAGES.map(language => [
        language,
        composeSubtypeEvalPack({ industry: profile.industry, subtype: profile.subtype, language }),
    ])) as Record<(typeof LANGUAGES)[number], ReturnType<typeof composeSubtypeEvalPack>>;
    const esPack = packs.es;
    const keyCount = (patterns: readonly RegExp[]) => esPack
        .filter(scenario => patterns.some(pattern => pattern.test(scenario.key))).length;

    const countryOverlays = Object.values(COUNTRY_LANGUAGE_PACKS).map(pack => Object.freeze({
        country: pack.country,
        packId: pack.id,
        packStatus: pack.status,
        market: countryMarketPolicyFor(pack.country),
        recognizedAliases: Object.freeze(pack.aliases.map(alias => Object.freeze({
            value: alias.value,
            intent: alias.intent,
            confidence: alias.confidence,
        }))),
        ambiguousConsentPhrases: Object.freeze(pack.aliases
            .filter(alias => alias.intent !== 'affirm' || alias.confidence !== 'high')
            .map(alias => alias.value)),
        preferredTerms: Object.freeze({ ...(pack.preferredTerms || {}) }),
        prohibitedRegisters: Object.freeze([...(pack.prohibitedRegisters || [])]),
    }));
    const neverConsentPhrases = unique(BASE_INTENT_ALIASES
        .filter(alias => alias.intent !== 'affirm' || alias.confidence !== 'high')
        .map(alias => alias.value));

    const role = localized(definition.agent.role) || Object.freeze({ es: 'Agente digital' });
    const targetCustomer = customerTerm || Object.freeze({ es: 'cliente' });
    const jobs = domain.intents.map(intent => intent.description);
    const jobsSource = jobs.length
        ? source('domain_derived', `domain-contract.v${domain.contractVersion}.${profile.id}.intents`)
        : source('unresolved', `domain-contract.v${domain.contractVersion}.${profile.id}.intents`, false, true);
    const relatedObjects = unique([
        ...activeObjects,
        ...profile.capability.routes.map(route => routeItemId(route)),
    ]);

    const expertReviews = unique([
        !explicitTerminology ? 'terminology.domain_glossary' : '',
        'templates.persona_role',
        !personaContract ? 'templates.rules_profile_fit' : '',
        profile.alerts.includes('REG') || regulatedIntents.length
            ? 'regulated.domain_and_jurisdiction' : '',
    ]);
    const implementationBlockers = unique([
        ...domain.unresolved.map(gap => `domain.${gap}`),
        ...operations.gaps
            .filter(gap => !domain.unresolved.includes(gap))
            .map(gap => `operation.${gap}`),
        ...navGaps.map(gap => `navigation.${gap}`),
        jobs.length ? '' : 'identity.jobs_to_be_done',
    ]);
    const promotionBlockers = unique([
        ...domain.certification.blockers.map(gap => `certification.${gap}`),
        ...expertReviews.map(review => `expert.${review}`),
        'market.country_pack_not_certified',
    ]);

    const criticalFieldSources: Record<string, AuthoringSource> = {
        'identity.business': source('profile_explicit', `subtype-profile.${profile.id}`),
        'identity.targetCustomer': customerSource,
        'identity.jobsToBeDone': jobsSource,
        'objects.primary': source('manifest_explicit', `capability-manifest.${profile.id}.primaryObject`),
        'objects.related': source('operation_derived', `operation-contract.v${operations.version}.${profile.id}`),
        'commercial.scope': source('profile_explicit', `subtype-profile.${profile.id}.scope`),
        'commercial.exclusions': source('profile_explicit', `subtype-profile.${profile.id}.exclusions`),
        'intents': source('domain_derived', `domain-contract.v${domain.contractVersion}.${profile.id}.intents`),
        'slots': source('domain_derived', `domain-contract.v${domain.contractVersion}.${profile.id}.slots`),
        'authority': source('operation_derived', `operation-contract.v${operations.version}.${profile.id}.systemOfRecord`),
        'tools': source('operation_derived', `operation-contract.v${operations.version}.${profile.id}.actions`),
        'navigation': source('manifest_explicit', `capability-manifest.${profile.id}.routes`),
        'terminology': explicitTerminology ? explicitSource('') : inheritedSource(''),
        'templates': personaContract
            ? source('profile_explicit', `vertical-subtype-persona-contract.v${VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION}.${profile.id}`)
            : source('vertical_default', `vertical-definitions.${profile.industry}.agent`, true, true),
        'localization': source('country_overlay', 'country-language-packs.v1'),
        'privacy': source('universal_component', 'l1.privacy+slot.persistence'),
        'evals': source('domain_derived', `eval:v${domain.contractVersion}:${profile.id}`),
        'benchmark': source('profile_explicit', `subtype-profile.${profile.id}.benchmark`),
    };

    const legacy = !listCanonicalSubtypeExperienceProfileIds().includes(requestedProfileId);
    return Object.freeze({
        version: VERTICAL_AUTHORING_PACKAGE_VERSION,
        packageId: `authoring:v${VERTICAL_AUTHORING_PACKAGE_VERSION}:${requestedProfileId}`,
        requestedProfileId,
        profileId: profile.id,
        profileVersion: profile.version,
        manifestVersion: profile.manifestVersion,
        domainContractVersion: domain.contractVersion,
        operationContractVersion: operations.version,
        compatibility: Object.freeze({
            legacy,
            resolvesTo: profile.id,
            migrationNote: legacy ? profile.migrationNote || `Compatibilidad: ${requestedProfileId} → ${profile.id}.` : null,
        }),
        identity: Object.freeze({
            business: authored(Object.freeze({
                industry: profile.industry,
                subtype: profile.subtype,
                personaRole: role,
            }), source('profile_explicit', `subtype-profile.${profile.id}`)),
            targetCustomer: authored(targetCustomer, customerSource),
            jobsToBeDone: authored(Object.freeze(jobs), jobsSource),
        }),
        objects: Object.freeze({
            primary: authored(profile.capability.primaryObject,
                source('manifest_explicit', `capability-manifest.${profile.id}.primaryObject`)),
            related: authored(Object.freeze(relatedObjects),
                source('operation_derived', `operation-contract.v${operations.version}.${profile.id}`)),
        }),
        commercial: Object.freeze({
            scope: authored(profile.scope, source('profile_explicit', `subtype-profile.${profile.id}.scope`)),
            claims: authored(Object.freeze([...domain.prompt.claims]),
                source('domain_derived', `domain-contract.v${domain.contractVersion}.${profile.id}.claims`)),
            exclusions: authored(Object.freeze([...profile.exclusions]),
                source('profile_explicit', `subtype-profile.${profile.id}.exclusions`)),
            availability: profile.availability,
        }),
        intents: Object.freeze({
            all: Object.freeze([...domain.intents]),
            informational: Object.freeze(informational),
            guided: Object.freeze(guided),
            transactional: Object.freeze(transactional),
            regulated: Object.freeze(regulatedIntents),
        }),
        slots: Object.freeze({
            all: Object.freeze(allSlots),
            required: Object.freeze(allSlots.filter(slot => slot.required).map(slot => slot.key)),
            optional: Object.freeze(allSlots.filter(slot => !slot.required).map(slot => slot.key)),
            sensitive: Object.freeze(allSlots
                .filter(slot => slot.sensitivity === 'sensitive' || slot.sensitivity === 'regulated')
                .map(slot => slot.key)),
            derived: Object.freeze(allSlots.filter(slot => slot.source === 'derived').map(slot => slot.key)),
            prohibitedComponent: 'l1.privacy.prohibited_data',
        }),
        authority: Object.freeze({
            sourcesOfTruth: Object.freeze(operations.actions.map(action => Object.freeze({
                tool: action.tool,
                owner: action.systemOfRecord.owner,
                boundary: action.systemOfRecord.boundary,
                freshness: action.systemOfRecord.freshness,
                conflict: action.systemOfRecord.conflict,
            }))),
            fallbackComponent: 'l1.authority.fail_closed_handoff',
        }),
        tools: Object.freeze({
            readers: Object.freeze(unique(readers)),
            writers: Object.freeze(unique(writers)),
            expected: Object.freeze(expectedTools),
            activeObjects: Object.freeze(activeObjects),
            missingTools: Object.freeze(toolGaps),
            degradedComponent: 'l1.tools.degraded_honesty',
        }),
        navigation: Object.freeze({
            items: Object.freeze(navItems),
            dailyWorkFirst: !daily.length || navItems[0]?.classification === 'daily_work',
            catalogSeparated: navGaps.every(gap => !gap.startsWith('label_collision')),
            roleContract: 'dashboard.route_access.v1',
            mobileContract: 'mobile.capability_workspaces.v1',
            gaps: Object.freeze(navGaps),
        }),
        terminology: Object.freeze({
            primaryObject: authored(primaryTerm, primarySource),
            customerNoun: authored(customerTerm, customerSource),
            transactionNoun: authored(transactionTerm, transactionSource),
            recognizedAliasesComponent: 'country_language_pack.aliases',
            prohibitedTerms: authored(Object.freeze([...(subtypeTerms?.avoid || [])]),
                explicitTerminology ? explicitSource('avoid') : inheritedSource('avoid')),
            neverConsentPhrases: Object.freeze(neverConsentPhrases),
        }),
        templates: Object.freeze([
            template('welcome', `vertical.${profile.industry}.persona.welcome`,
                source('vertical_default', `vertical-definitions.${profile.industry}.agent.greeting`, true, true)),
            template('discovery', `vertical.${profile.industry}.persona.discovery`,
                personaContract
                    ? source('profile_explicit', `vertical-subtype-persona-contract.v${VERTICAL_SUBTYPE_PERSONA_CONTRACT_VERSION}.${profile.id}`)
                    : source('vertical_default', `vertical-definitions.${profile.industry}.agent.rules`, true, true)),
            ...(['confirmation', 'blocked', 'handoff', 'success', 'follow_up'] as const).map(kind =>
                template(kind, `l1.turn.${kind}`, source('universal_component', `prompt-assembler.l1.${kind}`))),
        ]),
        localization: Object.freeze({
            baseLanguages: TERMINOLOGY_LANGUAGES,
            countryOverlays: Object.freeze(countryOverlays),
            fallbackPack: 'es-419',
        }),
        privacy: Object.freeze({
            disclosureComponent: 'l1.role_disclosure',
            regulatedSlots: Object.freeze(allSlots
                .filter(slot => slot.sensitivity === 'regulated').map(slot => slot.key)),
            neverPersistSlots: Object.freeze(allSlots
                .filter(slot => slot.persistence === 'never').map(slot => slot.key)),
            retentionSource: 'slot.persistence',
        }),
        evals: Object.freeze({
            contractVersion: domain.contractVersion,
            byLanguage: Object.freeze(Object.fromEntries(LANGUAGES.map(language => [
                language, packs[language].length,
            ])) as Record<(typeof LANGUAGES)[number], number>),
            positive: keyCount([/greeting/, /happy_path/]),
            negative: keyCount([/missing_capability/, /limit_/, /blocked/, /tool_failed/, /avoid_/]),
            adversarial: keyCount([/impersonation/, /unconfirmed/, /injection/, /currency_conversion/]),
            toolHonesty: esPack.filter(scenario =>
                (scenario.expectedActions?.length || 0) > 0
                || /tool_|missing_slot|repeat_request/.test(scenario.key)).length,
        }),
        benchmark: Object.freeze({
            competitor: profile.benchmark,
            auditedReadiness: profile.auditedReadiness,
            auditedDemand: profile.auditedDemand,
            confidence: profile.auditConfidence,
            authorisedClaim: profile.scope,
            certificationStatus: domain.status,
        }),
        governance: Object.freeze({
            stage: 'mechanically_complete',
            criticalFieldSources: Object.freeze(criticalFieldSources),
            expertReviewsRequired: Object.freeze(expertReviews),
            implementationBlockers: Object.freeze(implementationBlockers),
            promotionBlockers: Object.freeze(promotionBlockers),
        }),
    });
}

export function listVerticalAuthoringPackages(input: {
    includeLegacy?: boolean;
} = {}): VerticalAuthoringPackageV1[] {
    const ids = input.includeLegacy
        ? listSubtypeExperienceProfileIds()
        : listCanonicalSubtypeExperienceProfileIds();
    return ids.map(requestedProfileId => {
        const [industry, subtype] = requestedProfileId.split('/');
        return buildVerticalAuthoringPackage({
            industry,
            subtype: subtype === '__none__' ? null : subtype,
            requestedProfileId,
        });
    });
}

export function summariseVerticalAuthoringPackages(
    packages: readonly VerticalAuthoringPackageV1[],
) {
    return Object.freeze({
        total: packages.length,
        mechanicallyComplete: packages.filter(entry => entry.governance.stage === 'mechanically_complete').length,
        legacy: packages.filter(entry => entry.compatibility.legacy).length,
        terminologyExpertReview: packages.filter(entry =>
            entry.governance.expertReviewsRequired.includes('terminology.domain_glossary')).length,
        promptTemplateExpertReview: packages.filter(entry =>
            entry.governance.expertReviewsRequired.includes('templates.rules_profile_fit')).length,
        regulatedExpertReview: packages.filter(entry =>
            entry.governance.expertReviewsRequired.includes('regulated.domain_and_jurisdiction')).length,
        profilesWithImplementationBlockers: packages.filter(entry =>
            entry.governance.implementationBlockers.length > 0).length,
        profilesWithNavigationGaps: packages.filter(entry => entry.navigation.gaps.length > 0).length,
        profilesWithToolGaps: packages.filter(entry => entry.tools.missingTools.length > 0).length,
    });
}
