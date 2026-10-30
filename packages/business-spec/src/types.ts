/**
 * Tipos de la especificación compilada, de la foto del tenant y del resultado.
 * Fuente del formato: docs/domain/business-requirements-format.md (schema §4–§10).
 */
import type { Expr } from './expr';

export type Level = 'bloqueante' | 'necesario' | 'recomendado';
export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export type MissingCode = 'PREG' | 'NC+AV' | 'HUM' | 'EXT' | 'GAP';
export type PredicateKind =
    | 'custom' | 'confirmed_fields' | 'value_or_empty' | 'default_accepted' | 'count_min' | 'platform_pack';

/** Estado guardado (C0 §0.3): solo hechos del momento de la escritura. */
export type StoredStatus = 'confirmed' | 'example' | 'seeded';
/** Estado efectivo que calcula el motor (schema §7.1). */
export type ValueState = 'confirmado' | 'ejemplo' | 'sembrado' | 'ausente' | 'contradictorio' | 'caducado';
export type RequirementResult = 'cumple' | 'parcial' | 'no_cumple' | 'n/a';
export type Verdict = 'no_listo' | 'limitado' | 'listo';
export type GapCause =
    | 'ausente' | 'ejemplo' | 'sembrado' | 'contradictorio' | 'parcial' | 'caducado'
    | 'hecho_sin_declarar' | 'plataforma';
export type PriceType = 'fijo' | 'desde' | 'a_cotizar' | 'gratis';
export type LegacyRule = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';

export const LEVEL_RANK: Readonly<Record<Level, number>> = { recomendado: 1, necesario: 2, bloqueante: 3 };
export const LEVEL_RULES: Readonly<Record<Level, readonly Rule[]>> = {
    bloqueante: ['R1', 'R2', 'R3'], necesario: ['R4'], recomendado: ['R5'],
};

// ─────────────────────────── especificación compilada ───────────────────────────

export interface CriticalityWhen { if: Expr; ifSource: string; level: Level; rule: Rule }

export interface OverrideRule {
    /** ID destino (ya instanciado). */
    target: string;
    /** Quién lo declara: `profile:P02`, `object:food_order`, `domain:health`. */
    source: string;
    level?: Level;
    rule?: Rule;
    if?: Expr;
    ifSource?: string;
    params?: Record<string, unknown>;
    why: string;
    adr?: string;
}

export interface CompiledRequirement {
    id: string;
    title: string;
    layer: string;
    kind: string;
    /** Objeto al que pertenece (plantillas instanciadas y extras de objeto). */
    object?: string;
    /** `OBJ.*.CATALOG` si sale de la plantilla. */
    templateId?: string;
    appliesWhen: Expr;
    appliesWhenSource: string;
    answers: string[];
    exposure: string;
    data: Record<string, unknown>;
    level: Level;
    rule: Rule;
    conditional?: string;
    when: CriticalityWhen[];
    whenMissing: { code: MissingCode; behavior: string; never: string[] };
    sources: { allowed: string[]; acceptsTextEvidence: boolean; maxAge?: string };
    /** `sources.allowed ⊆ {country_pack, derived}`: el dueño no lo puede cumplir (schema §6). */
    platform: boolean;
    uiToday: string;
    /** Ruta del panel donde se completa (primera `/admin/...` de `ui_today`), o null si es «nuevo». */
    uiTarget: string | null;
    storageToday: string;
    predicate: string;
    predicateByLevel?: Partial<Record<Level, string>>;
    predicateKind: PredicateKind;
    predicateParams: Record<string, unknown>;
    gapMessage: string | Record<string, string>;
    derived: boolean;
    qaTruth: string;
    deprecatedBy?: string;
    ownerDecision?: string;
}

export interface ObjectDef {
    object: string;
    label: string;
    variants: Record<string, string>;
    templateApplies: string[];
    catalogFields: { required: string[]; optional: string[] };
    availabilityKinds: string[];
    defaultWriteMode: 'direct_commit' | 'request_to_business' | 'none';
    defaultIdentity: string;
    availabilityDefault?: { source: string; field?: string; gap_message?: string };
}

export interface ProfileDef {
    profile: string;
    name: string;
    objectsDefault: { object: string; variant: string | null }[];
    /** Dominios incondicionales. */
    domains: string[];
    /** hecho → dominio (operating_facts_defaults.conditional_domain_facts). */
    conditionalDomainFacts: Record<string, string>;
    operatingFactsDefaults: { modality: string[] | null; delivery_offered: boolean | null; has_prepayment: boolean | null };
}

export interface IntentDef { id: string; layer: string; block: string; title: string; ifMissing: string[]; conversational: boolean }

export interface CompiledSpec {
    specVersion: string;
    requirements: Record<string, CompiledRequirement>;
    /** Orden estable de evaluación y de informe. */
    order: string[];
    objects: Record<string, ObjectDef>;
    profiles: Record<string, ProfileDef>;
    domains: string[];
    subtypeToProfile: Record<string, string>;
    intents: Record<string, IntentDef>;
    overrides: OverrideRule[];
}

// ─────────────────────────── foto del tenant ───────────────────────────

export interface ValueRecord {
    value: unknown;
    status: StoredStatus;
    origin: string;
    confirmedBy?: string | null;
    confirmedAt?: string | null;
    sourceRef?: unknown;
    validUntil?: string | null;
    specVersion?: string | null;
    /** Dónde vive hoy (p. ej. `settings.businessHours`): sirve para explicar contradicciones. */
    storage?: string;
    scopeKey?: string;
    legacyRule?: LegacyRule | null;
}

export interface ItemRecord {
    id: string;
    active: boolean;
    fields: Record<string, unknown>;
    contentStatus: StoredStatus;
    priceType?: PriceType | null;
    priceStatus?: 'confirmed' | 'example' | null;
    origin: string;
    legacyRule?: LegacyRule | null;
    /** Estado por campo cuando difiere del ítem (p. ej. `allergens` = valor por defecto de columna, L4). */
    fieldStatus?: Record<string, StoredStatus>;
    createdAt?: string | null;
    updatedAt?: string | null;
}

export interface TextRecord {
    id: string;
    kind: 'faq' | 'document';
    title: string;
    body: string;
    published: boolean;
    status: StoredStatus;
    origin: string;
    legacyRule?: LegacyRule | null;
    covers?: string[];
    accessible?: boolean;
    validTo?: string | null;
}

export interface AccountRecord {
    id: string;
    role: string;
    active: boolean;
    emailVerified: boolean;
    handoffNotifications: boolean;
}

export interface CountryPackInfo {
    id: string;
    country: string;
    emergency: { general?: string | null; medical?: string | null; crisisLine?: string | null; reviewStatus: string } | null;
    consumerRights: unknown | null;
}

export interface AvailabilityInfo {
    /** Días hacia adelante con disponibilidad cargada en el motor nativo. */
    nativeDaysLoaded?: number;
    integrationSyncedAt?: string | null;
    manualUpdatedAt?: string | null;
    /** Ventanas de agenda (día 0=domingo … 6=sábado) para detectar contradicción con el horario. */
    agendaWindows?: { day: number; open: string; close: string }[];
    agendaStatus?: StoredStatus;
}

export interface TenantSnapshot {
    schema: 'business-spec/tenant-snapshot@1';
    tenant: { ref: string; slug?: string | null; name?: string | null };
    capturedAt: string;
    values: Record<string, ValueRecord[]>;
    items: Record<string, ItemRecord[]>;
    texts: TextRecord[];
    accounts: AccountRecord[];
    staff: { activeBookable: number };
    availability: Record<string, AvailabilityInfo>;
    integrations: { paymentProvider: boolean };
    platform: { countryPack: CountryPackInfo | null; followUpRegistry: boolean };
    provisioningWindow: { tenantCreatedAt: string | null; completedAt: string | null };
    defaultsAcceptance: { specVersion: string; ids: string[]; acceptedBy: string; acceptedAt: string }[];
    source: { kind: 'legacy' | 'provenance'; notes?: string[] };
}

// ─────────────────────────── resultado ───────────────────────────

export interface Gap {
    cause: GapCause;
    message: string;
    intents: { id: string; title: string }[];
    uiTarget: string | null;
    uiToday: string;
    /** Requisitos cuyo fallo nace de este (schema §9, causa raíz). */
    rootOf: string[];
    /** Si este fallo nace de otro requisito, el ID de la raíz (el hueco se muestra allí). */
    rootCause?: string;
}

export interface RequirementEvaluation {
    id: string;
    title: string;
    layer: string;
    level: Level;
    rule: Rule;
    applies: boolean;
    result: RequirementResult;
    valueState: ValueState | null;
    ratio?: { ok: number; total: number };
    levelResults?: Partial<Record<Level, 'cumple' | 'parcial' | 'no_cumple'>>;
    platform: boolean;
    derived: boolean;
    detail?: string;
    gap?: Gap;
}

export interface ReadinessResult {
    specVersion: string;
    tenant: { ref: string; slug?: string | null; name?: string | null };
    asOf: string;
    snapshotHash: string;
    resultHash: string;
    verdict: Verdict;
    config: {
        profileId: string | null;
        subtype: string | null;
        objects: { object: string; variant: string | null; writeMode: string; writeModeDeclared: boolean }[];
        domains: string[];
        facts: Record<string, unknown>;
    };
    counts: {
        applicable: number;
        blocking: number;
        blockingFailing: number;
        necessary: number;
        necessaryFailing: number;
        recommended: number;
        recommendedFailing: number;
    };
    requirements: RequirementEvaluation[];
    /** Requisitos que fallan como bloqueantes (R1–R3): deciden `no_listo`. */
    blockingGaps: string[];
    /** Fallan como necesarios (R4) y no como bloqueantes: deciden `limitado`. */
    necessaryGaps: string[];
    /** Fallan solo como recomendados (R5): suman a la cobertura. */
    recommendedGaps: string[];
    platformGaps: { id: string; message: string }[];
    /** Avisos que no bloquean (sembrados, contradicciones, dato heredado); `uiTarget` = dónde se revisa. */
    qualityWarnings: { id: string; message: string; uiTarget: string | null }[];
    coverage: { byArea: Record<string, { ok: number; total: number }>; r5Pct: number };
    limitedIntents: { id: string; title: string; requirementIds: string[] }[];
}
