import {
    listVerticalCapabilityConfigurations,
    resolveVerticalProductPolicy,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    VERTICAL_CERTIFICATION_ANCHORS,
    VERTICAL_PRODUCT_POLICY_VERSION,
} from '@parallext/shared';
import type {
    LocalizedString,
    ResolvedVerticalCapabilityManifest,
    VerticalDefinition,
    VerticalPrimaryObject,
    VerticalRoutePath,
} from '@parallext/shared';
import { VERTICAL_TOOL_CAPABILITY } from '../../common/contracts/vertical-capability-tools';
import { getVerticalDefinition, VERTICAL_REGISTRY } from '../verticals/vertical-definitions';
import { resolveVerticalSelection } from '../verticals/vertical-identifiers';
import { selectQuotaAwareVerticalDefaults } from '../verticals/verticals.service';
import {
    FACTORY_PLAN_SOURCE,
    FactoryPlanContract,
    loadFactoryPlanContracts,
} from './factory-plan-contracts';

export const VERTICAL_CONTRACT_LAYER = 'contract/static' as const;

export interface VerticalContractScenarioContext {
    industry: string;
    subtype: string | null;
    locale: string;
    plan: string;
}

export interface VerticalContractFailure extends VerticalContractScenarioContext {
    code: string;
    path: string;
    message: string;
}

export interface VerticalContractScenarioResult {
    id: string;
    context: VerticalContractScenarioContext;
    passed: boolean;
    failures: VerticalContractFailure[];
}

export interface VerticalContractMatrixReport {
    layer: typeof VERTICAL_CONTRACT_LAYER;
    bootstrapCertified: false;
    sources: {
        definitions: 'verticals/vertical-definitions';
        capabilityManifestVersion: number;
        productPolicyVersion: number;
        plans: typeof FACTORY_PLAN_SOURCE;
    };
    dimensions: {
        configurations: number;
        locales: number;
        plans: number;
    };
    summary: {
        scenarios: number;
        passed: number;
        failed: number;
        failureCount: number;
    };
    scenarios: VerticalContractScenarioResult[];
}

export interface VerticalContractMatrixSummary extends Omit<VerticalContractMatrixReport, 'scenarios'> {
    failures: VerticalContractFailure[];
}

const PRIMARY_OBJECT_ROUTE: Readonly<Record<VerticalPrimaryObject, VerticalRoutePath>> = {
    lead: '/admin/pipeline',
    appointment: '/admin/appointments',
    catalog_item: '/admin/inventory',
    treatment_plan: '/admin/treatment-plans',
    real_estate_listing: '/admin/listings',
    food_order: '/admin/food-orders',
    vehicle: '/admin/vehicles',
    tour_package: '/admin/tours',
    property_booking: '/admin/properties',
    course: '/admin/courses',
    // The current professional case flow is surfaced through appointments.
    professional_case: '/admin/appointments',
    pet: '/admin/pets',
    membership: '/admin/memberships',
    insurance_policy: '/admin/insurance',
    service_request: '/admin/service-requests',
    photo_session: '/admin/photo-sessions',
};

function nonEmpty(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function unique(values: readonly string[]): boolean {
    return new Set(values).size === values.length;
}

/** Locale dimension is derived from the actual LocalizedString source. */
export function getVerticalContractLocales(): string[] {
    const firstDefinition = Object.values(VERTICAL_REGISTRY)[0];
    if (!firstDefinition) throw new Error('Vertical registry is empty; no locale source is available.');
    const locales = Object.keys(firstDefinition.terminology.customerNoun).sort();
    if (locales.length === 0) throw new Error('LocalizedString source has no locales.');
    return locales;
}

function scenarioId(context: VerticalContractScenarioContext): string {
    return `${context.industry}/${context.subtype ?? 'none'}/${context.locale}/${context.plan}`;
}

function validator(context: VerticalContractScenarioContext) {
    const failures: VerticalContractFailure[] = [];
    const add = (code: string, path: string, message: string): void => {
        failures.push({ ...context, code, path, message });
    };
    return { failures, add };
}

function validateLocalized(
    value: LocalizedString | undefined,
    locale: string,
    path: string,
    add: (code: string, path: string, message: string) => void,
): void {
    if (!value || !nonEmpty((value as Record<string, unknown>)[locale])) {
        add('translation_empty', `${path}.${locale}`, `Missing or empty ${locale} translation.`);
    }
}

function validateTranslations(
    definition: VerticalDefinition,
    manifest: ResolvedVerticalCapabilityManifest,
    locale: string,
    add: (code: string, path: string, message: string) => void,
): void {
    const subtype = manifest.subtype
        ? definition.subTypes.find((candidate) => candidate.key === manifest.subtype)
        : undefined;
    if (manifest.subtype) {
        if (!subtype) {
            add('subtype_definition_missing', 'subTypes', `Subtype ${manifest.subtype} is absent from the registry definition.`);
        } else {
            validateLocalized(subtype.label, locale, `subTypes.${manifest.subtype}.label`, add);
        }
    }

    for (const [key, value] of Object.entries(definition.terminology)) {
        validateLocalized(value, locale, `terminology.${key}`, add);
    }
    for (const key of ['name', 'role', 'greeting', 'rules', 'forbiddenTopics', 'handoffTriggers'] as const) {
        validateLocalized(definition.agent[key] as LocalizedString, locale, `agent.${key}`, add);
    }
    definition.pipeline.stages.forEach((stage, index) =>
        validateLocalized(stage.name, locale, `pipeline.stages[${index}].name`, add));
    definition.faqs.forEach((faq, index) => {
        validateLocalized(faq.question, locale, `faqs[${index}].question`, add);
        validateLocalized(faq.answer, locale, `faqs[${index}].answer`, add);
    });
    definition.services.forEach((service, index) => {
        validateLocalized(service.name, locale, `services[${index}].name`, add);
        validateLocalized(service.description, locale, `services[${index}].description`, add);
    });
    validateLocalized(definition.businessHours.afterHoursMessage, locale, 'businessHours.afterHoursMessage', add);
    for (const [key, label] of Object.entries(definition.sidebar.labelOverrides)) {
        validateLocalized(label, locale, `sidebar.labelOverrides.${key}`, add);
    }
    definition.dashboard.kpis.forEach((kpi, index) =>
        validateLocalized(kpi.label, locale, `dashboard.kpis[${index}].label`, add));
}

function validatePipeline(
    definition: VerticalDefinition,
    add: (code: string, path: string, message: string) => void,
): void {
    const slugs = definition.pipeline.stages.map((stage) => stage.slug);
    if (!unique(slugs)) add('pipeline_slug_duplicate', 'pipeline.stages', 'Pipeline stage slugs must be unique.');
    if (definition.pipeline.stages.length === 0) {
        add('pipeline_empty', 'pipeline.stages', 'The canonical pipeline must not be empty.');
    }

    let terminalCount = 0;
    const terminalOutcomes = new Set<'won' | 'lost'>();
    definition.pipeline.stages.forEach((stage, index) => {
        if (!nonEmpty(stage.slug)) add('pipeline_slug_empty', `pipeline.stages[${index}].slug`, 'Stage slug is empty.');
        if (stage.isTerminal) {
            terminalCount += 1;
            if (stage.terminalOutcome !== 'won' && stage.terminalOutcome !== 'lost') {
                add(
                    'terminal_outcome_missing',
                    `pipeline.stages[${index}].terminalOutcome`,
                    'Every terminal stage must explicitly declare won or lost.',
                );
            } else {
                terminalOutcomes.add(stage.terminalOutcome);
            }
        } else if ((stage as any).terminalOutcome !== undefined && (stage as any).terminalOutcome !== null) {
            add(
                'non_terminal_outcome_present',
                `pipeline.stages[${index}].terminalOutcome`,
                'A non-terminal stage must not declare a terminal outcome.',
            );
        }
    });
    if (terminalCount === 0) {
        add('terminal_stage_missing', 'pipeline.stages', 'The canonical pipeline has no terminal stage.');
    }
    if (!terminalOutcomes.has('won')) {
        add('terminal_won_missing', 'pipeline.stages', 'The canonical pipeline must include a won terminal stage.');
    }
    if (!terminalOutcomes.has('lost')) {
        add('terminal_lost_missing', 'pipeline.stages', 'The canonical pipeline must include a lost terminal stage.');
    }
}

function validateServices(
    definition: VerticalDefinition,
    add: (code: string, path: string, message: string) => void,
): void {
    definition.services.forEach((service, index) => {
        if (!Number.isFinite(service.durationMinutes) || service.durationMinutes <= 0) {
            add('service_duration_invalid', `services[${index}].durationMinutes`, 'Service duration must be greater than zero.');
        }
        if (!nonEmpty(service.currency) || !/^[A-Z]{3}$/.test(service.currency)) {
            add('service_currency_invalid', `services[${index}].currency`, 'Service currency must be a non-empty ISO-like code.');
        }
    });
}

function validateCapabilities(
    manifest: ResolvedVerticalCapabilityManifest,
    add: (code: string, path: string, message: string) => void,
): void {
    if (!unique(manifest.capabilities)) {
        add('capability_duplicate', 'manifest.capabilities', 'Capabilities must be unique.');
    }
    if (!unique(manifest.toolGroups)) {
        add('tool_group_duplicate', 'manifest.toolGroups', 'Tool groups must be unique.');
    }
    for (const tool of manifest.toolGroups) {
        const capability = VERTICAL_TOOL_CAPABILITY[tool];
        if (!capability || !manifest.capabilities.includes(capability)) {
            add(
                'tool_without_capability',
                `manifest.toolGroups.${tool}`,
                `Tool group ${tool} requires capability ${capability || 'unmapped'}.`,
            );
        }
    }
    for (const [tool, capability] of Object.entries(VERTICAL_TOOL_CAPABILITY)) {
        if (manifest.capabilities.includes(capability) && !manifest.toolGroups.includes(tool as any)) {
            add(
                'capability_without_tool',
                `manifest.capabilities.${capability}`,
                `Capability ${capability} requires tool group ${tool}.`,
            );
        }
    }
}

function validateProductPolicy(
    industry: string,
    add: (code: string, path: string, message: string) => void,
): void {
    try {
        const policy = resolveVerticalProductPolicy(industry);
        if (policy.certificationState !== 'implemented_not_certified' || policy.deepMarketingAllowed) {
            add('product_policy_overclaim', 'productPolicy', 'Uncertified verticals must remain in honest marketing mode.');
        }
        const expectedMode = industry === 'otro'
            ? 'generic_fallback'
            : ['finanzas', 'technology', 'servicios_profesionales'].includes(industry)
                ? 'horizontal_preset'
                : (VERTICAL_CERTIFICATION_ANCHORS as readonly string[]).includes(industry)
                    ? 'certification_anchor'
                    : 'vertical_product';
        if (policy.mode !== expectedMode) {
            add('product_policy_mode_mismatch', 'productPolicy.mode', `Expected ${expectedMode}, received ${policy.mode}.`);
        }
    } catch (error: any) {
        add('product_policy_missing', 'productPolicy', error?.message || 'Product policy is missing.');
    }
}

function validatePrimaryObjectAndRoutes(
    manifest: ResolvedVerticalCapabilityManifest,
    add: (code: string, path: string, message: string) => void,
): void {
    if (!nonEmpty(manifest.primaryObject)) {
        add('primary_object_empty', 'manifest.primaryObject', 'Primary object must be defined.');
        return;
    }
    if (manifest.routes.length === 0 || !unique(manifest.routes)) {
        add('routes_invalid', 'manifest.routes', 'Routes must be non-empty and unique.');
    }
    manifest.routes.forEach((route, index) => {
        if (!route.startsWith('/admin/')) {
            add('route_invalid', `manifest.routes[${index}]`, `Route ${route} is not an admin route.`);
        }
    });
    const expectedRoute = PRIMARY_OBJECT_ROUTE[manifest.primaryObject];
    if (!expectedRoute || !manifest.routes.includes(expectedRoute)) {
        add(
            'primary_object_route_missing',
            'manifest.routes',
            `Primary object ${manifest.primaryObject} requires route ${expectedRoute || 'unmapped'}.`,
        );
    }
}

function validatePlanFloors(
    definition: VerticalDefinition,
    manifest: ResolvedVerticalCapabilityManifest,
    plan: FactoryPlanContract,
    add: (code: string, path: string, message: string) => void,
): void {
    const requiredServices = manifest.toolGroups.includes('appointments')
        ? definition.services
        : [];
    if (plan.pipelineStages !== -1 && plan.pipelineStages < definition.pipeline.stages.length) {
        add(
            'plan_pipeline_floor_insufficient',
            'plan.pipelineStages',
            `${plan.slug} allows ${plan.pipelineStages}; ${definition.pipeline.stages.length} canonical stages are required.`,
        );
    }
    if (plan.appointmentServices !== -1 && plan.appointmentServices < requiredServices.length) {
        add(
            'plan_service_floor_insufficient',
            'plan.appointmentServices',
            `${plan.slug} allows ${plan.appointmentServices}; ${requiredServices.length} canonical services are required.`,
        );
    }

    try {
        const selected = selectQuotaAwareVerticalDefaults(
            definition,
            requiredServices,
            {
                pipelineStages: plan.pipelineStages,
                appointmentServices: plan.appointmentServices,
            },
        );
        if (selected.pipelineStages.length !== definition.pipeline.stages.length) {
            add(
                'plan_pipeline_silent_fallback',
                'selected.pipelineStages',
                `Resolver selected ${selected.pipelineStages.length}/${definition.pipeline.stages.length} stages.`,
            );
        }
        if (selected.services.length !== requiredServices.length) {
            add(
                'plan_services_silent_fallback',
                'selected.services',
                `Resolver selected ${selected.services.length}/${requiredServices.length} services.`,
            );
        }
    } catch (error: any) {
        add('plan_resolution_error', 'plan', error?.message || 'Plan resolution failed.');
    }
}

function validateScenario(
    manifest: ResolvedVerticalCapabilityManifest,
    locale: string,
    plan: FactoryPlanContract,
): VerticalContractScenarioResult {
    const context: VerticalContractScenarioContext = {
        industry: manifest.industry,
        subtype: manifest.subtype,
        locale,
        plan: plan.slug,
    };
    const { failures, add } = validator(context);

    try {
        const canonical = resolveVerticalSelection(manifest.industry, manifest.subtype);
        if (canonical.industry !== manifest.industry || canonical.subType !== manifest.subtype) {
            add('canonical_mismatch', 'selection', 'Canonical vertical selection differs from the manifest configuration.');
        }
    } catch (error: any) {
        add('canonical_resolution_error', 'selection', error?.message || 'Canonical resolution failed.');
    }
    if (manifest.manifestVersion !== VERTICAL_CAPABILITY_MANIFEST_VERSION) {
        add(
            'manifest_version_mismatch',
            'manifest.manifestVersion',
            `Expected v${VERTICAL_CAPABILITY_MANIFEST_VERSION}, received v${manifest.manifestVersion}.`,
        );
    }

    let definition: VerticalDefinition | undefined;
    try {
        definition = getVerticalDefinition(manifest.industry);
        if (definition.industry !== manifest.industry) {
            add('definition_industry_mismatch', 'definition.industry', 'Registry industry does not match manifest industry.');
        }
    } catch (error: any) {
        add('definition_missing', 'definition', error?.message || 'Vertical definition is missing.');
    }

    if (definition) {
        validateTranslations(definition, manifest, locale, add);
        validatePipeline(definition, add);
        validateServices(definition, add);
        validatePlanFloors(definition, manifest, plan, add);
    }
    validateCapabilities(manifest, add);
    validatePrimaryObjectAndRoutes(manifest, add);
    validateProductPolicy(manifest.industry, add);

    return { id: scenarioId(context), context, passed: failures.length === 0, failures };
}

/** Execute all static combinations. No Prisma, Redis, network, clock, or randomness. */
export function runVerticalContractMatrix(): VerticalContractMatrixReport {
    const configurations = listVerticalCapabilityConfigurations();
    const locales = getVerticalContractLocales();
    const plans = loadFactoryPlanContracts();
    const scenarios: VerticalContractScenarioResult[] = [];

    for (const configuration of configurations) {
        for (const locale of locales) {
            for (const plan of plans) {
                scenarios.push(validateScenario(configuration, locale, plan));
            }
        }
    }

    const failed = scenarios.filter((scenario) => !scenario.passed);
    return {
        layer: VERTICAL_CONTRACT_LAYER,
        bootstrapCertified: false,
        sources: {
            definitions: 'verticals/vertical-definitions',
            capabilityManifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            productPolicyVersion: VERTICAL_PRODUCT_POLICY_VERSION,
            plans: FACTORY_PLAN_SOURCE,
        },
        dimensions: {
            configurations: configurations.length,
            locales: locales.length,
            plans: plans.length,
        },
        summary: {
            scenarios: scenarios.length,
            passed: scenarios.length - failed.length,
            failed: failed.length,
            failureCount: failed.reduce((total, scenario) => total + scenario.failures.length, 0),
        },
        scenarios,
    };
}

/** Compact JSON-ready shape for CI; only failed scenarios are expanded. */
export function summarizeVerticalContractMatrix(
    report: VerticalContractMatrixReport,
): VerticalContractMatrixSummary {
    const { scenarios, ...summary } = report;
    return {
        ...summary,
        failures: scenarios.flatMap((scenario) => scenario.failures),
    };
}
