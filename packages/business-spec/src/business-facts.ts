/**
 * Valores del negocio que lee el agente (C0 §2.3 y §5 R3b): horario, políticas, `not_offered` e identidad.
 *
 * Puro. El lector de la API (`BusinessFactsReader`) carga las fuentes de un tenant y este módulo decide qué vale,
 * con la MISMA regla que la foto del motor (`fromLegacyRows` + `applyRequirementValues`), así el panel y el agente no
 * pueden decir cosas distintas sobre el mismo dato (ADR 0007 §11, ADR 0009):
 *
 * - un valor escrito por `BusinessFactsService` manda (si se proyectó al almacenamiento viejo, solo mientras ese
 *   almacenamiento conserve la proyección: si una pantalla vieja lo editó después, manda la pantalla);
 * - un valor migrado es una copia del almacenamiento viejo: mientras la fuente no cambie es idéntico a ella, y si cambió
 *   ya no vale. En los dos casos el agente sigue leyendo la fuente vieja tal cual (equivalencia exacta).
 *
 * Expand-contract (C0 §2): durante esta release `BusinessFactsService.write()` escribe también el almacenamiento viejo
 * (`projectToLegacy`), con la huella de lo que la foto leerá de él (`source_ref.projected_to` + `projected_hash`).
 */
import { fromLegacyRows, type LegacyTenantRows } from './legacy-status';
import { migratedRef, projectedRef, valueFingerprint } from './provenance';
import type { TenantSnapshot, ValueRecord } from './types';

type Row = Record<string, any>;

/** Lo que el lector de la API carga de un tenant: lo mínimo para resolver los valores que lee el agente. */
export interface FactSources {
    tenant: {
        ref: string;
        slug?: string;
        name: string;
        created_at?: string | null;
        settings: Row | null;
        operating_country?: string | null;
        operating_timezone?: string | null;
    };
    /** La fila de identidad de `companies` (`is_primary`, o la primera si no hay). */
    companies: Row[];
    /** Filas activas de `policies`. */
    policies: Row[];
    requirement_values: Row[];
}

/** Requisitos que el agente lee por `BusinessFactsReader` (R3b). */
export const RUNTIME_FACT_IDS = [
    'CORE.HOURS.REGULAR', 'CORE.HANDOFF.HOURS_SLA', 'CORE.OFFER.NOT_OFFERED',
    'CORE.IDENTITY.NAME', 'CORE.IDENTITY.DESCRIPTION', 'CORE.LOCATIONS.LIST', 'CORE.CONTACT.CHANNELS',
    'CORE.POLICY.CANCELLATION_CHANGES', 'CORE.POLICY.REFUND_RETURNS', 'CORE.POLICY.WARRANTY', 'CORE.PRIVACY.NOTICE', 'CORE.DELIVERY.TERMS',
] as const;

/** Tipo de la tabla `policies` ↔ requisito (la lectura con reglas L acepta además alias en inglés y español). */
export const POLICY_REQUIREMENTS: Readonly<Record<string, string>> = {
    cancellation: 'CORE.POLICY.CANCELLATION_CHANGES',
    return: 'CORE.POLICY.REFUND_RETURNS',
    warranty: 'CORE.POLICY.WARRANTY',
    privacy: 'CORE.PRIVACY.NOTICE',
    shipping: 'CORE.DELIVERY.TERMS',
};
const POLICY_TYPE_OF: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(POLICY_REQUIREMENTS).map(([t, id]) => [id, t]));

/** Título por defecto de la fila proyectada a `policies` cuando el valor no trae `title`. */
const POLICY_TITLES: Readonly<Record<string, string>> = {
    cancellation: 'Política de cancelación y cambios', return: 'Política de devoluciones y reembolsos', warranty: 'Garantía',
    privacy: 'Aviso de privacidad', shipping: 'Condiciones de envío y entrega',
};

/** Almacenamiento viejo al que se proyecta cada requisito (el nombre que usa la foto en `storage`). */
export function projectedStorageOf(requirementId: string): string | null {
    switch (requirementId) {
        case 'CORE.HOURS.REGULAR': return 'settings.businessHours';
        case 'CORE.IDENTITY.NAME': return 'tenants.name';
        case 'CORE.IDENTITY.DESCRIPTION': return 'companies.about (is_primary)';
        case 'CORE.LOCATIONS.LIST': return 'companies.address/city/country';
        case 'CORE.CONTACT.CHANNELS': return 'companies.phone/email/website/social_links';
        default: return POLICY_TYPE_OF[requirementId] ? `policies.type = ${POLICY_TYPE_OF[requirementId]}` : null;
    }
}

// ─────────────────────────── foto mínima ───────────────────────────

/** Las fuentes del lector como `LegacyTenantRows` (el resto de tablas, vacías). */
export function factRows(src: FactSources): LegacyTenantRows {
    const t = src.tenant;
    return {
        schema: 'business-spec/legacy-rows@1',
        capturedAt: new Date(0).toISOString(),
        tenant: {
            ref: t.ref, slug: t.slug ?? t.ref, name: t.name, industry: null, subtype: null, language: null,
            created_at: t.created_at ?? new Date(0).toISOString(), settings: t.settings ?? {},
            operating_country: t.operating_country ?? null, operating_timezone: t.operating_timezone ?? null, operating_currency: null,
            default_locale: null, country_pack_id: null, country_pack_version: null, regional_provenance: null,
        },
        companies: src.companies ?? [], services: [], service_staff: [], menu_items: [], menu_categories: [], products: [],
        ecommerce_products: [], properties: [], tour_packages: [], tour_inventory: [], real_estate_listings: [], faqs: [],
        policies: src.policies ?? [], legal_text_versions: [], knowledge_documents: [], menu_promotions: [], commercial_offers: [],
        availability_slots: [], staff_members: [], agent_personas: [], requirement_values: src.requirement_values ?? [],
        users: [], payment_provider_configured: false, country_pack: null,
    };
}

export const factSnapshot = (src: FactSources): TenantSnapshot => fromLegacyRows(factRows(src));

/** Valor escrito por `BusinessFactsService` que sigue vigente (no migrado; si se proyectó, la proyección sigue intacta). */
export interface OwnerFact {
    requirementId: string;
    scopeKey: string;
    value: unknown;
    status: string;
    origin: string;
    version: number | null;
    confirmedAt: string | null;
}

/**
 * El valor del dueño que manda para un requisito y alcance, o null (entonces el agente lee el almacenamiento viejo).
 * `applyRequirementValues` ya descartó las filas cuya proyección cambió; aquí solo se separan de las migradas.
 */
export function ownerFact(snap: TenantSnapshot, src: FactSources, requirementId: string, scopeKey = ''): OwnerFact | null {
    const rec = (snap.values[requirementId] ?? []).find((r: ValueRecord) => (r.scopeKey ?? '') === scopeKey && r.legacyRule === null && !migratedRef(r));
    if (!rec) return null;
    const row = (src.requirement_values ?? []).find(r => r.requirement_id === requirementId && String(r.scope_key ?? '') === scopeKey);
    return {
        requirementId, scopeKey, value: rec.value, status: rec.status, origin: rec.origin,
        version: row && Number.isFinite(Number(row.version)) ? Number(row.version) : null, confirmedAt: rec.confirmedAt ?? null,
    };
}

// ─────────────────────────── horario ───────────────────────────

const LONG_DAYS: Readonly<Record<string, string>> = {
    mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday',
};
const HHMM = /^([01]?\d|2[0-4]):[0-5]\d$/;
const pad = (s: string) => s.padStart(5, '0');

/** Tramos de un día del valor (`[{open, close}]` del formulario o `[[a, b]]` del ejemplo de la especificación). */
function spansOf(day: unknown): { open: string; close: string }[] {
    if (!Array.isArray(day)) return [];
    return day.map(s => (Array.isArray(s) ? { open: String(s[0] ?? ''), close: String(s[1] ?? '') }
        : s && typeof s === 'object' ? { open: String((s as Row).open ?? ''), close: String((s as Row).close ?? '') } : null))
        .filter((s): s is { open: string; close: string } => Boolean(s) && HHMM.test(s!.open) && HHMM.test(s!.close))
        .map(s => ({ open: pad(s.open), close: pad(s.close) }));
}

/** Día del horario de hoy (forma de `settings.businessHours`), con todos sus tramos en `windows` si hay más de uno. */
export interface RuntimeDay { enabled: boolean; open: string; close: string; windows?: { open: string; close: string }[] }
export interface RuntimeBusinessHours {
    is247: boolean;
    timezone?: string;
    schedule: Record<string, RuntimeDay>;
    afterHoursMessage?: string;
}

/**
 * `CORE.HOURS.REGULAR` en la forma que lee el runtime de hoy (`settings.businessHours`: días en inglés, un tramo
 * `{enabled, open, close}`). Un día con varios tramos lleva el envolvente en `open/close` y los tramos en `windows`
 * (el agente los lee; la pantalla vieja solo sabe de uno). Un día sin declarar o sin tramos es «cerrado».
 */
export function hoursToRuntime(value: unknown, fallback: { timezone?: string | null; afterHoursMessage?: string | null } = {}): RuntimeBusinessHours | null {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
    if (!v) return null;
    const timezone = typeof v.timezone === 'string' && v.timezone ? v.timezone : fallback.timezone ?? undefined;
    const after = typeof fallback.afterHoursMessage === 'string' ? fallback.afterHoursMessage : undefined;
    const schedule: Record<string, RuntimeDay> = {};
    const days = v.days && typeof v.days === 'object' ? v.days as Row : {};
    for (const [short, long] of Object.entries(LONG_DAYS)) {
        const spans = spansOf(days[short] ?? days[long]);
        schedule[long] = spans.length
            ? { enabled: true, open: spans[0].open, close: spans[spans.length - 1].close, ...(spans.length > 1 ? { windows: spans } : {}) }
            : { enabled: false, open: '00:00', close: '00:00' };
    }
    return {
        is247: v.always_open === true, ...(timezone ? { timezone } : {}), schedule,
        ...(after !== undefined ? { afterHoursMessage: after } : {}),
    };
}

/** Texto de un `text_i18n` (cadena, o el primer idioma con texto). */
export function i18nText(v: unknown, language = 'es'): string | null {
    if (typeof v === 'string') return v.trim() || null;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Row;
        const pick = o[language] ?? o.es ?? Object.values(o).find(x => typeof x === 'string' && x.trim());
        return typeof pick === 'string' && pick.trim() ? pick.trim() : null;
    }
    return null;
}

/**
 * Horario del negocio para el agente: el valor del dueño en la forma del runtime, o `settings.businessHours` tal cual
 * (fuente vieja: sin valor del dueño, o con uno migrado, que es una copia idéntica). El mensaje fuera de horario sale de
 * `CORE.HANDOFF.HOURS_SLA.out_of_hours_message` del dueño si lo hay, si no del almacenamiento viejo.
 */
export function resolveBusinessHours(src: FactSources, snap: TenantSnapshot = factSnapshot(src)): { source: 'requirement_values' | 'legacy'; hours: Row | null; fact: OwnerFact | null } {
    const legacy = (src.tenant.settings ?? {}).businessHours ?? null;
    const fact = ownerFact(snap, src, 'CORE.HOURS.REGULAR');
    const sla = ownerFact(snap, src, 'CORE.HANDOFF.HOURS_SLA');
    const slaMessage = sla ? i18nText((sla.value as Row | null)?.out_of_hours_message) : null;
    if (!fact) {
        if (!slaMessage) return { source: 'legacy', hours: legacy, fact: null };
        return { source: 'legacy', hours: legacy && typeof legacy === 'object' ? { ...legacy, afterHoursMessage: slaMessage } : legacy, fact: null };
    }
    const hours = hoursToRuntime(fact.value, {
        timezone: (legacy as Row | null)?.timezone ?? src.tenant.operating_timezone ?? null,
        afterHoursMessage: slaMessage ?? (legacy as Row | null)?.afterHoursMessage ?? null,
    });
    return { source: 'requirement_values', hours, fact };
}

// ─────────────────────────── políticas ───────────────────────────

const LABELS: Readonly<Record<string, string>> = {
    cancel: 'Cancelación', change: 'Cambios', no_show: 'Inasistencia', late_tolerance: 'Tolerancia de llegada tarde',
    deadline: 'Plazo', charge: 'Cargo', refund: 'Reembolso', returns: 'Devoluciones', refunds: 'Reembolsos', exchanges: 'Cambios de producto',
    exceptions: 'Excepciones', duration: 'Duración', coverage: 'Cobertura', procedure: 'Procedimiento', scope: 'Alcance',
    controller: 'Responsable', purposes: 'Finalidades', url_or_text: 'Aviso', version: 'Versión', methods: 'Métodos', cost: 'Costo',
    min_order: 'Pedido mínimo', eta: 'Tiempo de entrega', free_from: 'Envío gratis desde', carriers: 'Transportadoras', tracking: 'Seguimiento',
    condition: 'Condición', medio: 'Medio', plazo: 'Plazo', not_applicable: 'No aplica',
};

function renderScalar(v: unknown): string {
    if (v === true) return 'sí';
    if (v === false) return 'no';
    if (Array.isArray(v)) return v.map(renderScalar).filter(Boolean).join(', ');
    if (v && typeof v === 'object') {
        const o = v as Row;
        if ('min' in o && 'unit' in o) return `${o.min}${o.max !== undefined && o.max !== null ? `–${o.max}` : ''} ${o.unit}`;
        if ('amount' in o && 'currency' in o) return `${o.amount} ${o.currency}`;
        return Object.entries(o).filter(([, x]) => x !== null && x !== undefined && x !== '')
            .map(([k, x]) => `${LABELS[k] ?? k}: ${renderScalar(x)}`).join('; ');
    }
    return v === null || v === undefined ? '' : String(v);
}

/**
 * Texto de una política estructurada (`policy_terms`): el resumen y, debajo, cada campo declarado. Es lo que devuelve
 * `get_policy` y lo que se proyecta a `policies.content`, así ambos dicen lo mismo.
 */
export function renderPolicyText(value: unknown): string {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
    if (!v) return typeof value === 'string' ? value.trim() : '';
    const lines: string[] = [];
    const summary = i18nText(v.summary);
    if (summary) lines.push(summary);
    for (const [k, x] of Object.entries(v)) {
        if (k === 'summary' || k === 'title' || x === null || x === undefined || x === '') continue;
        const text = renderScalar(x);
        if (text) lines.push(`${LABELS[k] ?? k}: ${text}`);
    }
    return lines.join('\n');
}

export interface RuntimePolicy {
    type: string;
    title: string;
    content: string;
    version: number;
    source: 'requirement_values' | 'legacy';
    /** Fila de `policies` (solo fuente vieja): la usan los consentimientos (`consent_records.policy_id`). */
    id?: string;
    /** Campos estructurados del valor del dueño (sin `summary` ni `title`), si los tiene. */
    terms?: Row;
}

/** Política activa de un tipo para el agente: el valor del dueño, o la fila activa de `policies`. */
export function resolvePolicy(src: FactSources, type: string, snap: TenantSnapshot = factSnapshot(src)): RuntimePolicy | null {
    const requirementId = POLICY_REQUIREMENTS[type];
    const fact = requirementId ? ownerFact(snap, src, requirementId) : null;
    if (fact && fact.value !== null && fact.value !== undefined) {
        const v = fact.value as Row;
        const content = renderPolicyText(v);
        if (content) {
            const terms = Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'summary' && k !== 'title'));
            return {
                type, title: i18nText(v.title) ?? POLICY_TITLES[type] ?? type, content, version: fact.version ?? 1, source: 'requirement_values',
                ...(Object.keys(terms).length ? { terms } : {}),
            };
        }
    }
    const row = (src.policies ?? []).find(p => String(p.type) === type && p.is_active !== false);
    return row ? { type, title: String(row.title ?? ''), content: String(row.content ?? ''), version: Number(row.version ?? 1), source: 'legacy', id: String(row.id) } : null;
}

// ─────────────────────────── not_offered ───────────────────────────

export interface NotOfferedEntry { item: string; alternative?: string; reason?: string }

/**
 * Lo que el negocio declaró que NO hace (`CORE.OFFER.NOT_OFFERED`, D9). `null` = no lo declaró (el agente no puede
 * decir «no lo hacemos»); `[]` = declaró que no hay nada. Solo cuenta un valor confirmado.
 */
export function resolveNotOffered(src: FactSources, snap: TenantSnapshot = factSnapshot(src)): NotOfferedEntry[] | null {
    const fact = ownerFact(snap, src, 'CORE.OFFER.NOT_OFFERED');
    if (!fact || fact.status !== 'confirmed' || !Array.isArray(fact.value)) return null;
    return (fact.value as unknown[]).map(e => {
        if (typeof e === 'string') return { item: e.trim() };
        const o = e && typeof e === 'object' ? e as Row : {};
        const alt = typeof o.alternative === 'string' ? o.alternative.trim() : o.alternative ? renderScalar(o.alternative) : '';
        const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
        return { item: String(o.item ?? '').trim(), ...(alt ? { alternative: alt } : {}), ...(reason ? { reason } : {}) };
    }).filter(e => e.item);
}

// ─────────────────────────── identidad ───────────────────────────

/** Campos de identidad que el valor del dueño cambia sobre la fila de `companies` (solo los declarados). */
export interface IdentityOverlay {
    name?: string;
    about?: string;
    audience?: string[];
    categoryLabel?: string;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    /** Todas las sedes declaradas (la principal primero). */
    locations?: Row[];
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    socialLinks?: Record<string, string>;
    whatsapp?: string | null;
}

const contactPoints = (v: unknown): Row[] => {
    const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as Row).points) ? (v as Row).points : [];
    return (list as unknown[]).filter((p): p is Row => Boolean(p) && typeof p === 'object');
};

/** Identidad para el agente: lo que el dueño declaró por `BusinessFactsService`; lo demás sigue en `companies`. */
export function resolveIdentity(src: FactSources, snap: TenantSnapshot = factSnapshot(src)): { overlay: IdentityOverlay; sources: Record<string, 'requirement_values'> } {
    const overlay: IdentityOverlay = {};
    const sources: Record<string, 'requirement_values'> = {};
    const name = ownerFact(snap, src, 'CORE.IDENTITY.NAME');
    const display = name ? i18nText((name.value as Row | null)?.display_name) : null;
    if (display) { overlay.name = display; sources['CORE.IDENTITY.NAME'] = 'requirement_values'; }
    const desc = ownerFact(snap, src, 'CORE.IDENTITY.DESCRIPTION');
    if (desc?.value && typeof desc.value === 'object') {
        const d = desc.value as Row;
        const short = i18nText(d.short);
        if (short) overlay.about = short;
        if (Array.isArray(d.audience)) overlay.audience = d.audience.map(String);
        const label = i18nText(d.category_label);
        if (label) overlay.categoryLabel = label;
        sources['CORE.IDENTITY.DESCRIPTION'] = 'requirement_values';
    }
    const loc = ownerFact(snap, src, 'CORE.LOCATIONS.LIST');
    if (loc?.value && typeof loc.value === 'object') {
        const list = (Array.isArray((loc.value as Row).locations) ? (loc.value as Row).locations : []) as Row[];
        const main = list.find(l => l?.is_main) ?? list[0];
        const addr = (main?.address ?? {}) as Row;
        overlay.address = main ? (addr.line1 ?? null) : null;
        overlay.city = main ? (addr.city ?? null) : null;
        overlay.country = main ? (addr.country ?? null) : null;
        overlay.locations = main ? [main, ...list.filter(l => l !== main)] : [];
        sources['CORE.LOCATIONS.LIST'] = 'requirement_values';
    }
    const contact = ownerFact(snap, src, 'CORE.CONTACT.CHANNELS');
    if (contact) {
        const points = contactPoints(contact.value);
        const first = (kind: string) => { const p = points.find(x => x.kind === kind); return p ? String(p.value ?? '') || null : null; };
        overlay.phone = first('phone');
        overlay.whatsapp = first('whatsapp');
        overlay.email = first('email');
        overlay.website = first('web');
        overlay.socialLinks = Object.fromEntries(points.filter(p => p.kind === 'social' && p.value).map((p, i) => [String(p.label ?? `social_${i + 1}`), String(p.value)]));
        sources['CORE.CONTACT.CHANNELS'] = 'requirement_values';
    }
    return { overlay, sources };
}

// ─────────────────────────── proyección al almacenamiento viejo (expand) ───────────────────────────

/** Qué escribir en el almacenamiento viejo. La API lo traduce a SQL en la misma transacción que el valor. */
export type LegacyPatch =
    | { kind: 'settings.businessHours'; businessHours: Row }
    | { kind: 'tenants.name'; name: string }
    | { kind: 'companies'; fields: Row; customerTypes?: string[] }
    | { kind: 'policies'; type: string; title: string; content: string };

export interface LegacyProjection {
    requirementId: string;
    storage: string;
    patch: LegacyPatch;
    /** Huella de lo que la foto leerá del almacenamiento viejo después de escribirlo (`source_ref.projected_hash`). */
    hash: string;
}

const primaryCompany = (companies: readonly Row[]): Row | null => companies.find(c => c.is_primary) ?? companies[0] ?? null;

function patchFor(requirementId: string, value: unknown, src: FactSources): LegacyPatch | null {
    const v = value && typeof value === 'object' ? value as Row : null;
    const settings = src.tenant.settings ?? {};
    switch (requirementId) {
        case 'CORE.HOURS.REGULAR': {
            const current = settings.businessHours && typeof settings.businessHours === 'object' ? settings.businessHours as Row : {};
            const rt = hoursToRuntime(v, { timezone: current.timezone ?? src.tenant.operating_timezone ?? 'America/Bogota' });
            if (!rt) return null;
            // forma de la pantalla de hoy (isAgentAccountBusinessHours): un tramo por día, sin `windows`
            const schedule = Object.fromEntries(Object.entries(rt.schedule).map(([d, x]) => [d, { enabled: x.enabled, open: x.open, close: x.close }]));
            return {
                kind: 'settings.businessHours',
                businessHours: { is247: rt.is247, timezone: rt.timezone ?? 'America/Bogota', schedule, afterHoursMessage: typeof current.afterHoursMessage === 'string' ? current.afterHoursMessage : '' },
            };
        }
        case 'CORE.IDENTITY.NAME': {
            const name = i18nText(v?.display_name);
            return name ? { kind: 'tenants.name', name } : null;
        }
        case 'CORE.IDENTITY.DESCRIPTION': {
            const short = i18nText(v?.short);
            if (!short) return null;
            const audience = Array.isArray(v?.audience) ? (v!.audience as unknown[]).map(a => String(a).toLowerCase()) : undefined;
            return { kind: 'companies', fields: { about: short }, ...(audience ? { customerTypes: audience } : {}) };
        }
        case 'CORE.LOCATIONS.LIST': {
            const list = (Array.isArray(v?.locations) ? v!.locations : []) as Row[];
            const main = list.find(l => l?.is_main) ?? list[0];
            const addr = (main?.address ?? {}) as Row;
            return { kind: 'companies', fields: { address: main ? addr.line1 ?? null : null, city: main ? addr.city ?? null : null, country: main ? addr.country ?? null : null } };
        }
        case 'CORE.CONTACT.CHANNELS': {
            const points = contactPoints(value);
            const first = (...kinds: string[]) => { const p = points.find(x => kinds.includes(String(x.kind))); return p ? String(p.value ?? '') || null : null; };
            const social = Object.fromEntries(points.filter(p => p.kind === 'social' && p.value).map((p, i) => [String(p.label ?? `social_${i + 1}`), String(p.value)]));
            return { kind: 'companies', fields: { phone: first('phone', 'whatsapp'), email: first('email'), website: first('web'), social_links: social } };
        }
        default: {
            const type = POLICY_TYPE_OF[requirementId];
            if (!type || !v) return null;
            const content = renderPolicyText(v);
            if (!content) return null;
            return { kind: 'policies', type, title: (i18nText(v.title) ?? POLICY_TITLES[type] ?? type).slice(0, 500), content };
        }
    }
}

/** Las fuentes como quedarían después de aplicar la proyección (para calcular su huella). */
export function applyLegacyPatch(src: FactSources, patch: LegacyPatch): FactSources {
    const copy: FactSources = JSON.parse(JSON.stringify(src));
    copy.tenant.settings = copy.tenant.settings ?? {};
    switch (patch.kind) {
        case 'settings.businessHours': copy.tenant.settings.businessHours = patch.businessHours; break;
        case 'tenants.name': copy.tenant.name = patch.name; break;
        case 'companies': {
            const main = primaryCompany(copy.companies);
            if (main) Object.assign(main, patch.fields, { is_primary: true });
            else copy.companies = [{ id: 'projected', name: copy.tenant.name, is_primary: true, ...patch.fields }];
            if (patch.customerTypes) copy.tenant.settings.customerTypes = patch.customerTypes;
            break;
        }
        case 'policies':
            copy.policies = [...copy.policies.filter(p => String(p.type) !== patch.type), { id: 'projected', type: patch.type, title: patch.title, content: patch.content, is_active: true }];
            break;
    }
    return copy;
}

/**
 * Proyección de un valor nuevo al almacenamiento viejo (expand, C0 §2): qué escribir y la huella de lo que la foto leerá
 * de ahí. `null` si el requisito no tiene almacenamiento viejo (p. ej. `NOT_OFFERED`) o el valor no se puede proyectar
 * (entonces el valor manda sin proyección, como en R3).
 */
export function projectToLegacy(requirementId: string, value: unknown, src: FactSources, scopeKey = ''): LegacyProjection | null {
    if (scopeKey !== '') return null;
    const storage = projectedStorageOf(requirementId);
    if (!storage) return null;
    const patch = patchFor(requirementId, value, src);
    if (!patch) return null;
    const after = applyLegacyPatch({ ...src, requirement_values: [] }, patch);
    const rec = (factSnapshot(after).values[requirementId] ?? []).find(r => r.storage === storage && (r.scopeKey ?? '') === '');
    return { requirementId, storage, patch, hash: valueFingerprint(rec?.value ?? null) };
}

/** ¿La proyección de una fila sigue intacta en estas fuentes? (lo mismo que decide `applyRequirementValues`). */
export function projectionInSync(src: FactSources, row: Row): boolean {
    const ref = projectedRef({ value: null, status: 'confirmed', origin: 'owner_form', sourceRef: row.source_ref });
    if (!ref) return true;
    const rec = (factSnapshot({ ...src, requirement_values: [] }).values[String(row.requirement_id)] ?? [])
        .find(r => r.storage === ref.projected_to && (r.scopeKey ?? '') === String(row.scope_key ?? ''));
    return valueFingerprint(rec?.value ?? null) === ref.projected_hash;
}
