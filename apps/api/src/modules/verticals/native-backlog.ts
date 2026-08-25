import {
    EVAL_LANGUAGES,
    NAVIGATION_SURFACE_KIND,
    SUBTYPE_EXPERIENCE_PROFILES,
    TOOL_GROUP_PLAN_FEATURE,
    TOOL_GROUP_READINESS,
    assuranceLevelSatisfies,
    buildDomainContractDraft,
    composeSubtypeEvalPack,
    profileSystemOfRecordPolicy,
    resolveSubtypeExperienceProfile,
    type ResolvedSubtypeExperienceProfile,
    type SubtypeAlert,
    type VerticalPrimaryObject,
    type VerticalReadinessKey,
    type VerticalRoutePath,
    type VerticalToolGroup,
} from '@parallext/shared';
import { staticToolsForAgentConfig } from '../conversations/agent-tool-registry';
import { PROVIDER_INTEGRATION_POLICIES } from '../conversations/effective-capability.service';
import {
    ASYNC_GATED_TOOL_NAMES,
    getMissingToolControls,
    getToolPolicy,
    isBusinessWriteTool,
    type ToolPolicy,
} from '../conversations/tool-policy-registry';
import { READINESS } from './vertical-readiness.service';

/**
 * Executable status of the historical native-depth findings.
 *
 * Profile alerts are audit provenance and deliberately never change. This
 * module resolves them against the registries that actually run the product;
 * later provider, tenant, expert and product gates remain explicit.
 */
export const DERIVABLE_ALERTS: readonly SubtypeAlert[] = Object.freeze([
    'WRITER', 'CAP', 'LIVE', 'UX', 'SEC', 'SOR', 'PAY', 'E2E',
]);

export type BacklogItemState =
    | 'open'
    | 'stale'
    | 'external_gate'
    | 'decision_gate'
    | 'expert_gate';

export type BacklogResponsibility = 'internal' | 'decision' | 'external' | 'mixed';
export type BacklogEvidenceStatus = 'verified' | 'missing' | 'required';
export type BacklogGateKind = 'internal' | 'external' | 'decision' | 'expert';
export type BacklogGateStatus = 'verified' | 'open' | 'required';

export interface NativeBacklogEvidence {
    key: string;
    status: BacklogEvidenceStatus;
    source:
        | 'capability_manifest'
        | 'readiness_registry'
        | 'navigation_contract'
        | 'tool_policy_registry'
        | 'provider_runtime_policy'
        | 'eval_contract'
        | 'domain_contract'
        | 'external_evidence';
    detail: string;
}

export interface NativeBacklogGate {
    kind: BacklogGateKind;
    status: BacklogGateStatus;
    detail: string;
}

export interface NativeBacklogItem {
    alert: SubtypeAlert;
    state: BacklogItemState;
    responsibility: BacklogResponsibility;
    detail: string;
    nextAction: string;
    evidence: NativeBacklogEvidence[];
    gates: NativeBacklogGate[];
    /** Only code/product-surface work; credentials and pilots never enter here. */
    openCodeWork: string[];
}

export interface NativeBacklogEntry {
    profileId: string;
    strategy: string;
    items: NativeBacklogItem[];
    openCodeWork: string[];
}

export interface NativeBacklogDetailedSummary {
    generatedFrom: {
        profiles: number;
        alerts: number;
        derivableAlerts: readonly SubtypeAlert[];
    };
    states: Record<BacklogItemState, number>;
    responsibilities: Record<BacklogResponsibility, number>;
    internalGates: { verified: number; open: number };
    laterGates: { external: number; decision: number; expert: number };
    profilesWithOpenCode: Array<{
        profileId: string;
        alerts: SubtypeAlert[];
        work: string[];
    }>;
}

const ALERT_RESPONSIBILITY: Readonly<Record<SubtypeAlert, BacklogResponsibility>> = Object.freeze({
    WRITER: 'internal', LIVE: 'internal', CAP: 'internal', UX: 'internal', SEC: 'internal',
    E2E: 'mixed', SOR: 'mixed', PAY: 'mixed',
    REG: 'external', MISCLASS: 'decision', STOP: 'decision',
});

const BASE_READINESS = new Set<VerticalReadinessKey>([
    'business_identity', 'pipeline', 'faq_content',
]);

/** Minimum data contract for each primary object, not a competitive-depth claim. */
const PRIMARY_OBJECT_READINESS: Readonly<Partial<Record<VerticalPrimaryObject, readonly VerticalReadinessKey[]>>> = {
    appointment: ['appointment_services'],
    catalog_item: ['catalog_items'],
    treatment_plan: ['treatment_catalog'],
    real_estate_listing: ['listings'],
    food_order: ['menu_items'],
    vehicle: ['vehicle_inventory'],
    tour_package: ['tour_packages'],
    property_booking: ['properties'],
    course: ['courses'],
    professional_case: ['professional_cases'],
    pet: ['pets'],
    membership: ['membership_plans'],
    insurance_policy: ['insurance_plans'],
    service_request: ['service_catalog'],
    vehicle_rental: ['vehicle_inventory'],
    pet_boarding: ['boarding_capacity'],
    photo_session: ['photo_sessions'],
    repair_order: [],
};

const PRIMARY_OBJECT_ROUTE: Readonly<Record<VerticalPrimaryObject, string>> = Object.freeze({
    lead: '/admin/contacts', appointment: '/admin/appointments',
    catalog_item: '/admin/inventory', treatment_plan: '/admin/treatment-plans',
    real_estate_listing: '/admin/listings', food_order: '/admin/food-orders',
    vehicle: '/admin/vehicles', tour_package: '/admin/tours',
    property_booking: '/admin/stays', course: '/admin/courses',
    professional_case: '/admin/cases', pet: '/admin/pets',
    membership: '/admin/memberships', insurance_policy: '/admin/insurance',
    service_request: '/admin/service-requests', vehicle_rental: '/admin/resource-rentals',
    pet_boarding: '/admin/resource-rentals', photo_session: '/admin/photo-sessions',
    repair_order: '/admin/repair-orders',
});

/**
 * Read→commit pairs backed by executable capacity contracts.
 *
 * Capacity is not necessarily the profile's primary record. A workshop's
 * primary object is a vehicle and a home-service business tracks a service
 * request, but both commit scarce staff/time through the shared appointment
 * engine. Restricting this registry to `primaryObject` made working capacity
 * look absent and encouraged duplicate schedulers.
 */
const CAPACITY_TOOL_PAIRS: readonly {
    read: string;
    write: string;
    contract: string;
    preferredPrimaryObjects?: readonly VerticalPrimaryObject[];
}[] = Object.freeze([
    { read: 'check_availability', write: 'create_appointment', contract: 'appointment-capacity.util.spec.ts' },
    { read: 'check_home_service_availability', write: 'create_service_request', contract: 'home-service-capacity.contract.spec.ts', preferredPrimaryObjects: ['service_request'] },
    { read: 'check_package_availability', write: 'create_tour_booking', contract: 'tours.service.spec.ts', preferredPrimaryObjects: ['tour_package'] },
    { read: 'check_property_availability', write: 'create_property_booking', contract: 'lodging-source-of-truth.spec.ts', preferredPrimaryObjects: ['property_booking'] },
    { read: 'get_course_schedule', write: 'enroll_student', contract: 'education.service.spec.ts', preferredPrimaryObjects: ['course'] },
    { read: 'get_class_schedule', write: 'book_class', contract: 'gym capacity/waitlist contracts', preferredPrimaryObjects: ['membership'] },
    { read: 'check_vehicle_rental_availability', write: 'create_vehicle_rental', contract: 'resource-rentals.service.spec.ts', preferredPrimaryObjects: ['vehicle_rental'] },
    { read: 'check_daycare_availability', write: 'create_pet_boarding', contract: 'resource-rentals.service.spec.ts', preferredPrimaryObjects: ['pet_boarding'] },
    { read: 'check_date_availability', write: 'request_photo_quote', contract: 'photography-date-capacity.contract.spec.ts', preferredPrimaryObjects: ['photo_session'] },
]);

function routeToSurfaceItem(route: string): string | null {
    if (!route.startsWith('/admin/')) return null;
    const segment = route.slice('/admin/'.length).split('/')[0];
    return segment ? segment.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) : null;
}

function isRouteReachableFromManifest(route: string, manifestRoutes: readonly string[]): boolean {
    if (route.startsWith('/admin/settings/') || route === '/admin/knowledge') return true;
    return manifestRoutes.some(base => route === base || route.startsWith(`${base}/`));
}

function toolNamesForProfile(profile: ResolvedSubtypeExperienceProfile): string[] {
    const config = Object.fromEntries(
        profile.capability.toolGroups.map(group => [group, { enabled: true }]),
    );
    return staticToolsForAgentConfig(config).map(tool => String(tool.name));
}

export function businessWritersForProfile(industry: string, subtype: string): string[] {
    return toolNamesForProfile(resolveSubtypeExperienceProfile(industry, subtype))
        .filter(isBusinessWriteTool);
}

function profileToolPolicies(profile: ResolvedSubtypeExperienceProfile): Array<{
    name: string; policy: ToolPolicy | undefined;
}> {
    return toolNamesForProfile(profile).map(name => ({ name, policy: getToolPolicy(name) }));
}

function evidence(
    key: string,
    status: BacklogEvidenceStatus,
    source: NativeBacklogEvidence['source'],
    detail: string,
): NativeBacklogEvidence {
    return { key, status, source, detail };
}

function internalResult(
    alert: SubtypeAlert,
    evidenceItems: NativeBacklogEvidence[],
    openCodeWork: string[],
    verifiedDetail: string,
    nextAction: string,
): NativeBacklogItem {
    const open = openCodeWork.length > 0 || evidenceItems.some(item => item.status === 'missing');
    return {
        alert,
        state: open ? 'open' : 'stale',
        responsibility: ALERT_RESPONSIBILITY[alert],
        detail: open ? `Queda trabajo interno comprobable: ${openCodeWork.join(' ')}` : verifiedDetail,
        nextAction: open ? nextAction : 'Preservar esta cobertura en los contratos y pruebas de regresión.',
        evidence: evidenceItems,
        gates: [{
            kind: 'internal', status: open ? 'open' : 'verified',
            detail: open ? 'El contrato de código todavía no está completo.' : verifiedDetail,
        }],
        openCodeWork,
    };
}

function writerItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const writers = businessWritersForProfile(profile.industry, profile.subtype);
    const missing = writers.length ? [] : [
        `Implementar un writer de negocio para ${profile.id}, con ownership, idempotencia y Active Object.`,
    ];
    return internalResult(
        'WRITER',
        [evidence('business_writers', writers.length ? 'verified' : 'missing', 'tool_policy_registry',
            writers.length ? `${writers.length} writer(s): ${writers.join(', ')}.` : 'No publica writers de negocio.')],
        missing,
        `La alerta histórica quedó obsoleta: publica ${writers.join(', ')}.`,
        missing[0] || 'Implementar y registrar el writer.',
    );
}

function capacityItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const manifest = profile.capability;
    const tools = new Set(toolNamesForProfile(profile));
    const expectedReadiness = PRIMARY_OBJECT_READINESS[manifest.primaryObject] || [];
    const undeclared = expectedReadiness.filter(key => !manifest.readiness.requirements.includes(key));
    const unimplemented = manifest.readiness.requirements
        .filter(key => !BASE_READINESS.has(key))
        .filter(key => !READINESS[key]);
    const availablePairs = CAPACITY_TOOL_PAIRS
        .filter(pair => tools.has(pair.read) && tools.has(pair.write));
    const matchingPair = availablePairs.find(pair =>
        pair.preferredPrimaryObjects?.includes(manifest.primaryObject)) || availablePairs[0];
    const expectedRoute = PRIMARY_OBJECT_ROUTE[manifest.primaryObject];
    const hasRoute = !!expectedRoute && manifest.routes.includes(expectedRoute as VerticalRoutePath);
    const evidenceItems: NativeBacklogEvidence[] = [
        evidence('primary_object_readiness', undeclared.length ? 'missing' : 'verified', 'capability_manifest',
            undeclared.length ? `El objeto ${manifest.primaryObject} no declara: ${undeclared.join(', ')}.`
                : `El objeto ${manifest.primaryObject} declara ${expectedReadiness.join(', ') || 'readiness base'}.`),
        evidence('readiness_evaluator', unimplemented.length ? 'missing' : 'verified', 'readiness_registry',
            unimplemented.length ? `Sin evaluador/CTA para: ${unimplemented.join(', ')}.`
                : 'Cada readiness específico declarado tiene evaluador y CTA.'),
        evidence('capacity_read_write_pair', matchingPair ? 'verified' : 'missing', 'tool_policy_registry',
            matchingPair ? `${matchingPair.read} → ${matchingPair.write}; contrato: ${matchingPair.contract}.`
                : `No existe un par lectura→commit de capacidad publicado por ${profile.id}.`),
        evidence('primary_object_surface', hasRoute ? 'verified' : 'missing', 'navigation_contract',
            hasRoute ? `Superficie directa ${expectedRoute}.` : `Falta la superficie primaria ${expectedRoute || '(sin mapear)'}.`),
    ];
    const openCodeWork: string[] = [];
    if (undeclared.length) openCodeWork.push(`Añadir readiness ${undeclared.join(', ')} al manifiesto de ${profile.id}.`);
    if (unimplemented.length) openCodeWork.push(`Implementar evaluador y CTA para ${unimplemented.join(', ')}.`);
    if (!matchingPair) openCodeWork.push(`Implementar lectura de capacidad y commit atómico para ${manifest.primaryObject}.`);
    if (!hasRoute) openCodeWork.push(`Exponer ${expectedRoute || 'la superficie primaria'} en el manifiesto y menú.`);
    return internalResult(
        'CAP', evidenceItems, openCodeWork,
        'El mínimo interno de recursos/capacidad está conectado a readiness, tools y superficie operativa.',
        'Cerrar las evidencias CAP faltantes y añadir pruebas negativas de concurrencia.',
    );
}

function providerPoliciesForProfile(profileId: string): Array<[string, typeof PROVIDER_INTEGRATION_POLICIES[string]]> {
    return Object.entries(PROVIDER_INTEGRATION_POLICIES)
        .filter(([, policy]) => policy.profileIds.includes(profileId));
}

function hasCompleteProfileSorBoundary(profileId: string): boolean {
    const policy = profileSystemOfRecordPolicy(profileId);
    if (!policy || !policy.readTools.length || !policy.displacedWriters.length) return false;
    if (policy.boundary === 'native') {
        return policy.owner === 'parallly'
            && policy.freshness.mode === 'transactional'
            && policy.freshness.requiresSuccessfulSync === false
            && policy.conflict === 'native_atomic';
    }
    if (policy.boundary === 'conditional_provider') {
        return policy.owner === 'conditional_binding'
            && policy.providerKinds.length > 0
            && policy.freshness.mode === 'native_or_provider_live_or_certified_mirror'
            && policy.freshness.requiresSuccessfulSync === false
            && policy.conflict === 'binding_authoritative_fail_closed';
    }
    return policy.owner === 'external_provider'
        && policy.providerKinds.length > 0
        && policy.freshness.mode === 'provider_live_or_certified_mirror'
        && policy.freshness.requiresSuccessfulSync === true
        && policy.conflict === 'provider_authoritative_fail_closed';
}

function profileSorBoundaryDetail(profileId: string): string | null {
    const policy = profileSystemOfRecordPolicy(profileId);
    if (!policy) return null;
    return `${policy.boundary}: owner=${policy.owner}; reads=${policy.readTools.join(',')}; `
        + `displaces=${policy.displacedWriters.join(',')}; freshness=${policy.freshness.mode}; `
        + `conflict=${policy.conflict}`;
}

function liveItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const tools = profileToolPolicies(profile);
    const liveReads = tools.filter(({ policy }) => policy
        && policy.commitsBusiness === false
        && (policy.effect === 'read' || policy.effect === 'conditional_write'));
    const groupReadiness = profile.capability.toolGroups
        .map(group => TOOL_GROUP_READINESS[group as VerticalToolGroup])
        .filter((key): key is VerticalReadinessKey => !!key);
    const missingReadiness = groupReadiness.filter(key => !READINESS[key]);
    const providers = providerPoliciesForProfile(profile.id);
    const externalSorExpected = profile.strategy === 'hybrid' && profile.alerts.includes('SOR');
    const hasProfileBoundary = hasCompleteProfileSorBoundary(profile.id);
    const hasRuntimeProviderBoundary = hasProfileBoundary || providers.length > 0;
    const evidenceItems = [
        evidence('live_read_path', liveReads.length ? 'verified' : 'missing', 'tool_policy_registry',
            liveReads.length ? `Lecturas no comprometedoras: ${liveReads.map(item => item.name).join(', ')}.`
                : 'El perfil no publica una lectura de estado/disponibilidad.'),
        evidence('live_read_readiness', missingReadiness.length ? 'missing' : 'verified', 'readiness_registry',
            missingReadiness.length ? `Sin evaluador de frescura/datos para ${missingReadiness.join(', ')}.`
                : `Readiness evaluable: ${groupReadiness.join(', ') || 'sin dataset vertical adicional'}.`),
        evidence('source_freshness_boundary', externalSorExpected && !hasRuntimeProviderBoundary ? 'missing' : 'verified',
            'provider_runtime_policy', externalSorExpected
                ? hasRuntimeProviderBoundary
                    ? profileSorBoundaryDetail(profile.id)
                        || `Runtime provider policy: ${providers.map(([name]) => name).join(', ')}.`
                    : 'El perfil híbrido declara SOR pero ninguna política runtime de proveedor lo cubre.'
                : 'El perfil usa su registro nativo dentro del alcance declarado.'),
    ];
    const openCodeWork: string[] = [];
    if (!liveReads.length) openCodeWork.push(`Implementar una lectura viva para ${profile.id}.`);
    if (missingReadiness.length) openCodeWork.push(`Conectar ${missingReadiness.join(', ')} al evaluador de readiness/frescura.`);
    if (externalSorExpected && !hasRuntimeProviderBoundary) {
        openCodeWork.push(`Declarar para ${profile.id} la política runtime de SOR/proveedor, frescura y writers desplazados.`);
    }
    return internalResult(
        'LIVE', evidenceItems, openCodeWork,
        'La lectura viva tiene readiness y una frontera de frescura/SOR ejecutable.',
        'Implementar la lectura/frescura faltante y probar error, stale y datos vacíos por separado.',
    );
}

function uxItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const manifest = profile.capability;
    const expectedRoute = PRIMARY_OBJECT_ROUTE[manifest.primaryObject];
    const hasPrimaryRoute = !!expectedRoute && manifest.routes.includes(expectedRoute as VerticalRoutePath);
    const verticalRoutes = manifest.routes.filter(route => !['/admin/inbox', '/admin/contacts', '/admin/pipeline'].includes(route));
    const unclassified = verticalRoutes.filter(route => {
        const item = routeToSurfaceItem(route);
        return !item || !NAVIGATION_SURFACE_KIND[item];
    });
    const deadRepairRoutes = manifest.readiness.requirements.flatMap(key => {
        const repair = READINESS[key]?.repairRoute;
        return repair && !isRouteReachableFromManifest(repair, manifest.routes) ? [repair] : [];
    });
    const evidenceItems = [
        evidence('primary_object_direct_route', hasPrimaryRoute ? 'verified' : 'missing', 'navigation_contract',
            hasPrimaryRoute ? `Ruta primaria: ${expectedRoute}.` : `No declara ${expectedRoute || 'ruta primaria'}.`),
        evidence('surface_classification', unclassified.length ? 'missing' : 'verified', 'navigation_contract',
            unclassified.length ? `Rutas sin clasificación register/catalogue/mixed: ${unclassified.join(', ')}.`
                : `${verticalRoutes.length} ruta(s) vertical(es) clasificadas.`),
        evidence('repair_cta_reachability', deadRepairRoutes.length ? 'missing' : 'verified', 'readiness_registry',
            deadRepairRoutes.length ? `CTA fuera de las rutas del perfil: ${deadRepairRoutes.join(', ')}.`
                : 'Todos los CTA de readiness son globales o alcanzables desde una ruta del perfil.'),
    ];
    const openCodeWork: string[] = [];
    if (!hasPrimaryRoute) openCodeWork.push(`Añadir la ruta directa ${expectedRoute || 'del objeto primario'}.`);
    if (unclassified.length) openCodeWork.push(`Clasificar y publicar ${unclassified.join(', ')} en navegación.`);
    if (deadRepairRoutes.length) openCodeWork.push(`Corregir CTA muertos: ${deadRepairRoutes.join(', ')}.`);
    return internalResult(
        'UX', evidenceItems, openCodeWork,
        'El objeto primario, sus superficies y los CTA de reparación son alcanzables y están clasificados.',
        'Cerrar la ruta/menú/CTA faltante y cubrirla con contrato de navegación.',
    );
}

/** Exported because SEC may be introduced by a future profile. */
export function securityEvidenceForProfile(profileId: string): {
    evidence: NativeBacklogEvidence[]; openCodeWork: string[];
} | null {
    const [industry, subtype] = profileId.split('/');
    let profile: ResolvedSubtypeExperienceProfile;
    try { profile = resolveSubtypeExperienceProfile(industry, subtype); } catch { return null; }
    const policies = profileToolPolicies(profile);
    const unregistered = policies.filter(item => !item.policy).map(item => item.name);
    const globallyMissing = new Map(getMissingToolControls().map(item => [item.name, item.missing]));
    const missingControls = policies.filter(item => globallyMissing.has(item.name))
        .map(item => `${item.name}(${globallyMissing.get(item.name)!.join(',')})`);
    const ownershipGaps = policies
        .filter(({ policy }) => policy?.dataClassification === 'sensitive' && policy.ownership === 'none')
        .map(item => item.name);
    const profileTools = toolNamesForProfile(profile);
    const assuranceGaps = Object.entries(profile.capability.assurance.enforcedActions)
        .filter(([name, required]) => {
            if (!profileTools.includes(name)) return false;
            const policy = getToolPolicy(name);
            return !policy || policy.assuranceEnforcement === 'missing'
                || !assuranceLevelSatisfies(policy.assurance, required);
        }).map(([name]) => name);
    const evidenceItems = [
        evidence('tool_policy_coverage', unregistered.length ? 'missing' : 'verified', 'tool_policy_registry',
            unregistered.length ? `Tools sin policy: ${unregistered.join(', ')}.` : `${policies.length} tools registradas.`),
        evidence('central_controls', missingControls.length ? 'missing' : 'verified', 'tool_policy_registry',
            missingControls.length ? `Controles incompletos: ${missingControls.join(', ')}.`
                : 'Sin assurance/idempotency/confirmation/human-approval faltantes.'),
        evidence('sensitive_ownership', ownershipGaps.length ? 'missing' : 'verified', 'tool_policy_registry',
            ownershipGaps.length ? `Lecturas sensibles sin ownership: ${ownershipGaps.join(', ')}.`
                : 'Toda tool sensible declara ownership.'),
        evidence('manifest_assurance', assuranceGaps.length ? 'missing' : 'verified', 'capability_manifest',
            assuranceGaps.length ? `Assurance del manifiesto no ejecutable: ${assuranceGaps.join(', ')}.`
                : 'Las acciones publicables satisfacen el nivel declarado.'),
    ];
    return {
        evidence: evidenceItems,
        openCodeWork: evidenceItems.filter(item => item.status === 'missing')
            .map(item => `Cerrar ${item.key} en ${profile.id}: ${item.detail}`),
    };
}

function securityItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const result = securityEvidenceForProfile(profile.id)!;
    return internalResult(
        'SEC', result.evidence, result.openCodeWork,
        'Las tools del perfil tienen policy, ownership y controles coherentes con assurance.',
        'Cerrar los controles de seguridad y añadir pruebas negativas multi-tenant.',
    );
}

function mixedItem(
    alert: 'SOR' | 'PAY' | 'E2E',
    internalEvidence: NativeBacklogEvidence[],
    openCodeWork: string[],
    internalVerified: string,
    externalDetail: string,
    nextAction: string,
): NativeBacklogItem {
    const internalOpen = openCodeWork.length > 0 || internalEvidence.some(item => item.status === 'missing');
    return {
        alert,
        state: internalOpen ? 'open' : 'external_gate',
        responsibility: 'mixed',
        detail: internalOpen
            ? `La parte interna sigue abierta: ${openCodeWork.join(' ')} La puerta externa también permanece pendiente.`
            : `${internalVerified} Permanece la puerta externa: ${externalDetail}`,
        nextAction: internalOpen ? nextAction : externalDetail,
        evidence: [...internalEvidence, evidence(`${alert.toLowerCase()}_external_gate`, 'required', 'external_evidence', externalDetail)],
        gates: [
            { kind: 'internal', status: internalOpen ? 'open' : 'verified', detail: internalOpen ? openCodeWork.join(' ') : internalVerified },
            { kind: 'external', status: 'required', detail: externalDetail },
        ],
        openCodeWork,
    };
}

function sorItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const providers = providerPoliciesForProfile(profile.id);
    const profilePolicy = profileSystemOfRecordPolicy(profile.id);
    const tools = toolNamesForProfile(profile);
    const writers = tools.filter(isBusinessWriteTool);
    const reads = tools.filter(name => getToolPolicy(name)?.commitsBusiness === false);
    const nativeBoundary = profile.strategy === 'build' && writers.length > 0 && reads.length > 0;
    const providerBoundary = providers.length > 0
        && providers.every(([, policy]) => policy.tools.length > 0 && policy.localWritersDisplaced.length > 0);
    const profileBoundary = hasCompleteProfileSorBoundary(profile.id)
        && !!profilePolicy
        && profilePolicy.readTools.some(tool => tools.includes(tool))
        && profilePolicy.displacedWriters.some(tool => tools.includes(tool));
    const hasBoundary = profileBoundary || nativeBoundary || providerBoundary;
    const internalEvidence = [evidence(
        'runtime_sor_boundary', hasBoundary ? 'verified' : 'missing', 'provider_runtime_policy',
        profileBoundary
            ? profileSorBoundaryDetail(profile.id)!
            : providerBoundary
                ? providers.map(([name, policy]) => `${name}: reads=${policy.tools.join(',')} displaces=${policy.localWritersDisplaced.join(',')}`).join('; ')
            : nativeBoundary ? `Registro nativo: ${reads.join(', ')} → ${writers.join(', ')}.`
                : 'No hay política runtime que declare lectura, dueño y writers desplazados.',
    )];
    const openCodeWork = hasBoundary ? [] : [
        `Definir y ejecutar la frontera SOR de ${profile.id}: owner, reads, writers desplazados, frescura y conflicto.`,
    ];
    return mixedItem(
        'SOR', internalEvidence, openCodeWork,
        'La frontera de sistema de registro está expresada en el runtime.',
        'Validar mapeo, ownership y reconciliación con el sistema real elegido por el tenant/proveedor.',
        'Implementar la frontera SOR fail-closed y sus pruebas antes de conectar credenciales.',
    );
}

function paymentItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const names = ['create_payment_link', 'get_payment_status', 'refund_payment'];
    const missingPolicies = names.filter(name => !getToolPolicy(name));
    const missingControls = getMissingToolControls().filter(item => names.includes(item.name))
        .map(item => `${item.name}(${item.missing.join(',')})`);
    const planGated = TOOL_GROUP_PLAN_FEATURE.payments === 'customerPayments';
    const asyncGated = ['create_payment_link', 'get_payment_status'].every(name => ASYNC_GATED_TOOL_NAMES.has(name));
    const internalEvidence = [
        evidence('payment_plan_gate', planGated ? 'verified' : 'missing', 'capability_manifest',
            planGated ? 'payments → customerPayments.' : 'La familia payments no tiene feature de plan.'),
        evidence('payment_runtime_policy', !missingPolicies.length && !missingControls.length ? 'verified' : 'missing', 'tool_policy_registry',
            missingPolicies.length || missingControls.length
                ? `Policies ausentes: ${missingPolicies.join(', ') || 'ninguna'}; controles: ${missingControls.join(', ') || 'ninguno'}.`
                : 'Crear, consultar y reembolsar tienen policy y controles centrales.'),
        evidence('payment_async_gate', asyncGated ? 'verified' : 'missing', 'tool_policy_registry',
            asyncGated ? 'Creación y status pasan por la composición asíncrona.' : 'Falta el gate asíncrono de PSP.'),
    ];
    const openCodeWork = internalEvidence.filter(item => item.status === 'missing')
        .map(item => `Cerrar ${item.key} para ${profile.id}: ${item.detail}`);
    return mixedItem(
        'PAY', internalEvidence, openCodeWork,
        'El plan, la policy y el gate fail-closed de pagos están verificados en código.',
        'Aportar credenciales, entorno de prueba y evidencia transaccional del PSP aplicable al país; no se declara activado aquí.',
        'Cerrar plan/policy/gate de pagos antes de habilitar cualquier proveedor.',
    );
}

function e2eItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const packs = EVAL_LANGUAGES.map(language => ({
        language,
        scenarios: composeSubtypeEvalPack({ industry: profile.industry, subtype: profile.subtype, language }),
    }));
    const missingLanguages = packs.filter(pack => pack.scenarios.length === 0).map(pack => pack.language);
    const actionAssertions = packs.reduce((total, pack) => total + pack.scenarios
        .reduce((count, scenario) => count + (scenario.expectedActions?.length || 0), 0), 0);
    const contract = buildDomainContractDraft(profile.industry, profile.subtype);
    const internalEvidence = [
        evidence('multilingual_eval_pack', missingLanguages.length ? 'missing' : 'verified', 'eval_contract',
            missingLanguages.length ? `Sin escenarios: ${missingLanguages.join(', ')}.`
                : packs.map(pack => `${pack.language}:${pack.scenarios.length}`).join(', ')),
        evidence('eval_action_assertions', actionAssertions > 0 ? 'verified' : 'missing', 'eval_contract',
            actionAssertions > 0 ? `${actionAssertions} assertion(es) de tool/efecto.`
                : 'El perfil sólo tiene criterios de texto; no verifica tool ni efecto.'),
        evidence('domain_intent_contract', contract.intents.length > 0 ? 'verified' : 'missing', 'domain_contract',
            contract.intents.length > 0 ? `${contract.intents.length} intención(es) versionadas.`
                : 'No hay intención versionada para ejecutar el perfil.'),
    ];
    const openCodeWork: string[] = [];
    if (missingLanguages.length) openCodeWork.push(`Crear evals para ${missingLanguages.join(', ')}.`);
    if (!actionAssertions) openCodeWork.push(`Añadir assertions de tool y efecto para ${profile.id}.`);
    if (!contract.intents.length) openCodeWork.push(`Declarar intents ejecutables para ${profile.id}.`);
    return mixedItem(
        'E2E', internalEvidence, openCodeWork,
        'Existe andamiaje determinista multilingüe con intents y assertions.',
        'Ejecutar y firmar evidencia contra tenant, modelo y proveedor reales; el contrato sigue draft hasta entonces.',
        'Completar el set determinista antes de solicitar evidencia real.',
    );
}

function decisionItem(alert: 'STOP' | 'MISCLASS', profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const detail = alert === 'STOP'
        ? `El perfil permanece no comercializable: ${profile.blockedReason || profile.primaryGap}.`
        : `La taxonomía necesita destino y migración: ${profile.primaryGap}.`;
    return {
        alert, state: 'decision_gate', responsibility: 'decision', detail,
        nextAction: alert === 'STOP'
            ? 'Aprobar o rechazar el alcance; mantener writers fail-closed hasta decidir.'
            : 'Elegir familia canónica y diseñar migración de tenants, datos, tools y navegación.',
        evidence: [evidence(alert.toLowerCase(), 'required', 'domain_contract', detail)],
        gates: [{ kind: 'decision', status: 'required', detail }], openCodeWork: [],
    };
}

function expertItem(profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    const detail = `Revisión experta/legal requerida para ${profile.id}; el código no certifica jurisdicción.`;
    return {
        alert: 'REG', state: 'expert_gate', responsibility: 'external', detail,
        nextAction: 'Obtener límites y aprobación por jurisdicción; convertirlos luego en policy y evals versionados.',
        evidence: [evidence('regulated_review', 'required', 'external_evidence', detail)],
        gates: [{ kind: 'expert', status: 'required', detail }], openCodeWork: [],
    };
}

function deriveItem(alert: SubtypeAlert, profile: ResolvedSubtypeExperienceProfile): NativeBacklogItem {
    switch (alert) {
        case 'WRITER': return writerItem(profile);
        case 'CAP': return capacityItem(profile);
        case 'LIVE': return liveItem(profile);
        case 'UX': return uxItem(profile);
        case 'SEC': return securityItem(profile);
        case 'SOR': return sorItem(profile);
        case 'PAY': return paymentItem(profile);
        case 'E2E': return e2eItem(profile);
        case 'STOP':
        case 'MISCLASS': return decisionItem(alert, profile);
        case 'REG': return expertItem(profile);
    }
}

export function deriveNativeBacklog(profileId: string): NativeBacklogEntry | null {
    const entry = (SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)[profileId];
    if (!entry) return null;
    const [industry, subtype] = profileId.split('/');
    const profile = resolveSubtypeExperienceProfile(industry, subtype);
    const alerts = (entry.alerts ?? []) as readonly SubtypeAlert[];
    const items: NativeBacklogItem[] = alerts.map(alert => deriveItem(alert, profile));
    return {
        profileId, strategy: entry.strategy, items,
        openCodeWork: [...new Set(items.flatMap(item => item.openCodeWork))],
    };
}

export function deriveNativeBacklogAll(): NativeBacklogEntry[] {
    return Object.entries(SUBTYPE_EXPERIENCE_PROFILES as Record<string, any>)
        .filter(([, entry]) => (
            (entry.strategy === 'build' || entry.strategy === 'hybrid')
            && resolveSubtypeExperienceProfile(entry.industry, entry.subtype).commercialisable
        ))
        .map(([id]) => deriveNativeBacklog(id)!)
        .filter(Boolean);
}

export function summariseNativeBacklog(): Record<BacklogItemState, number> {
    const summary: Record<BacklogItemState, number> = {
        open: 0, stale: 0, external_gate: 0, decision_gate: 0, expert_gate: 0,
    };
    for (const entry of deriveNativeBacklogAll()) {
        for (const item of entry.items) summary[item.state] += 1;
    }
    return summary;
}

export function summariseNativeBacklogResponsibility(): Record<BacklogResponsibility, number> {
    const summary: Record<BacklogResponsibility, number> = {
        internal: 0, decision: 0, external: 0, mixed: 0,
    };
    for (const entry of deriveNativeBacklogAll()) {
        for (const item of entry.items) summary[item.responsibility] += 1;
    }
    return summary;
}

/** Serializable summary; no controller dependency and no hidden `needs_review` bin. */
export function summariseNativeBacklogDetailed(): NativeBacklogDetailedSummary {
    const entries = deriveNativeBacklogAll();
    const items = entries.flatMap(entry => entry.items);
    return {
        generatedFrom: {
            profiles: entries.length, alerts: items.length, derivableAlerts: DERIVABLE_ALERTS,
        },
        states: summariseNativeBacklog(),
        responsibilities: summariseNativeBacklogResponsibility(),
        internalGates: {
            verified: items.flatMap(item => item.gates)
                .filter(gate => gate.kind === 'internal' && gate.status === 'verified').length,
            open: items.flatMap(item => item.gates)
                .filter(gate => gate.kind === 'internal' && gate.status === 'open').length,
        },
        laterGates: {
            external: items.flatMap(item => item.gates).filter(gate => gate.kind === 'external').length,
            decision: items.flatMap(item => item.gates).filter(gate => gate.kind === 'decision').length,
            expert: items.flatMap(item => item.gates).filter(gate => gate.kind === 'expert').length,
        },
        profilesWithOpenCode: entries.filter(entry => entry.openCodeWork.length > 0).map(entry => ({
            profileId: entry.profileId,
            alerts: entry.items.filter(item => item.openCodeWork.length > 0).map(item => item.alert),
            work: entry.openCodeWork,
        })),
    };
}
