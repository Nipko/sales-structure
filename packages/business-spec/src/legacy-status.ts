/**
 * Estado de los datos heredados (schema §7.5, reglas L1–L7): filas de las tablas de hoy → TenantSnapshot.
 *
 * Puro. La lectura la hace SnapshotReader (apps/api/src/modules/readiness) y entrega `LegacyTenantRows`.
 * Desde R3 la foto usa la procedencia real cuando existe (`provenance.ts`: columnas de §2.2 y `requirement_values`)
 * y estas reglas deciden solo lo que no la tiene. Se retiran tabla por tabla cuando la procedencia real cubra la tabla
 * y ningún editor la escriba sin ella (C0 §2.9, K4; estado por regla en docs/domain/business-readiness-runtime.md).
 */
import {
    PROVENANCE_TABLES, applyRequirementValues, realRowProvenance, toMs, type RowProvenance,
} from './provenance';
import { emptySnapshot } from './snapshot';
import type {
    CountryPackInfo, ItemRecord, LegacyRule, PriceType, StoredStatus, TenantSnapshot, TextRecord, ValueRecord,
} from './types';

type Row = Record<string, any>;

export interface LegacyTenantRows {
    schema: 'business-spec/legacy-rows@1';
    capturedAt: string;
    tenant: {
        ref: string;
        slug: string;
        name: string;
        industry: string | null;
        /** `industry/subtype` canónico (alias resueltos con canonicalSubtypeId de @parallext/shared). */
        subtype: string | null;
        language: string | null;
        created_at: string;
        settings: Row;
        operating_country: string | null;
        operating_timezone: string | null;
        operating_currency: string | null;
        default_locale: string | null;
        country_pack_id: string | null;
        country_pack_version: string | null;
        regional_provenance: Row | null;
    };
    companies: Row[];
    services: Row[];
    service_staff: Row[];
    menu_items: Row[];
    menu_categories: Row[];
    products: Row[];
    ecommerce_products: Row[];
    properties: Row[];
    tour_packages: Row[];
    tour_inventory: Row[];
    real_estate_listings: Row[];
    faqs: Row[];
    policies: Row[];
    legal_text_versions: Row[];
    knowledge_documents: Row[];
    menu_promotions: Row[];
    commercial_offers: Row[];
    availability_slots: Row[];
    staff_members: Row[];
    agent_personas: Row[];
    /** R3: filas de `requirement_values` (vacío o ausente si el tenant aún no tiene la tabla). */
    requirement_values?: Row[];
    users: { id: string; role: string; is_active: boolean; email_verified: boolean; handoff_notifications: boolean }[];
    payment_provider_configured: boolean;
    /** Pack de país resuelto por el lector (emergencias de packages/shared); null si no hay país. */
    country_pack: CountryPackInfo | null;
}

export { toMs };
const iso = (s: unknown): string | null => (Number.isFinite(toMs(s)) ? new Date(toMs(s)).toISOString() : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const jsonList = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } })() : []);

const DAY_KEYS: Record<string, string> = {
    monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun',
    mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun',
    lunes: 'mon', martes: 'tue', miercoles: 'wed', 'miércoles': 'wed', jueves: 'thu', viernes: 'fri', sabado: 'sat', 'sábado': 'sat', domingo: 'sun',
};

/** Normaliza los formatos de horario que conviven hoy (settings.businessHours y persona config.hours). */
export function normalizeHours(raw: unknown): Row | null {
    const h = raw && typeof raw === 'object' ? raw as Row : null;
    if (!h) return null;
    if (h.is247 === true || h.always_open === true) return { always_open: true, timezone: h.timezone ?? null };
    const schedule = h.schedule && typeof h.schedule === 'object' ? h.schedule as Row : null;
    if (!schedule || !Object.keys(schedule).length) return null;
    const days: Record<string, { open: string; close: string }[]> = {};
    for (const [k, v] of Object.entries(schedule)) {
        const day = DAY_KEYS[k.toLowerCase()];
        if (!day) continue;
        const spans: { open: string; close: string }[] = [];
        const push = (s: string) => { const m = s.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/); if (m) spans.push({ open: m[1].padStart(5, '0'), close: m[2].padStart(5, '0') }); };
        if (typeof v === 'string') v.split(',').forEach(push);
        else if (Array.isArray(v)) v.forEach(x => (typeof x === 'string' ? push(x) : x && typeof x === 'object' && spans.push({ open: String((x as Row).open), close: String((x as Row).close) })));
        else if (v && typeof v === 'object') { const o = v as Row; if (o.enabled !== false && o.closed !== true && o.open && o.close) spans.push({ open: String(o.open), close: String(o.close) }); }
        days[day] = spans;
    }
    return Object.keys(days).length ? { always_open: false, timezone: h.timezone ?? null, days } : null;
}

const AGENDA_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const hhmm = (v: unknown): string | null => { const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };

/**
 * Horario semanal a partir de la agenda (`availability_slots`, 0 = domingo), el tercer origen que el runtime usa para
 * contestar «¿a qué hora abren?» cuando no hay horario del negocio ni de la persona (informational-hours.ts). La agenda
 * es una grilla semanal completa: un día sin franjas activas es un día cerrado (lista vacía). Las franjas de varios
 * profesionales se unen por día.
 */
export function hoursFromAgenda(slots: readonly Row[]): Row | null {
    const active = slots.filter(s => s.is_active !== false);
    if (!active.length) return null;
    const days: Record<string, { open: string; close: string }[]> = Object.fromEntries(AGENDA_DAYS.map(d => [d, []]));
    for (const s of active) {
        const day = AGENDA_DAYS[Number(s.day_of_week)];
        const open = hhmm(s.start_time);
        const close = hhmm(s.end_time);
        if (day && open && close) days[day].push({ open, close });
    }
    for (const d of AGENDA_DAYS) {
        const merged: { open: string; close: string }[] = [];
        for (const span of days[d].sort((a, b) => a.open.localeCompare(b.open))) {
            const last = merged[merged.length - 1];
            if (last && span.open <= last.close) last.close = span.close > last.close ? span.close : last.close;
            else merged.push({ ...span });
        }
        days[d] = merged;
    }
    return { always_open: false, timezone: null, days };
}

/**
 * Temas que cubre una FAQ (R1.1 F2), inferidos de su título con reglas deterministas. Solo cuentan para requisitos con
 * `accepts_text_evidence: true`, y solo si la FAQ está publicada, confirmada y tiene dato (`textEvidenceFor`).
 */
export const FAQ_COVERS_RULES: ReadonlyArray<{ requirementId: string; pattern: RegExp }> = [
    { requirementId: 'CORE.POLICY.WARRANTY', pattern: /garant[ií]a|warrant|garantie/i },
    { requirementId: 'CORE.POLICY.REFUND_RETURNS', pattern: /devoluci[oó]n|devolver|reembols|refund|\breturns?\b|rembours|devolu[çc][ãa]o/i },
];

export function inferCovers(title: string): string[] {
    return FAQ_COVERS_RULES.filter(r => r.pattern.test(title)).map(r => r.requirementId);
}

/** `address_privacy` del listado (CORE.LOCATIONS.LIST): solo valores del enum; sin valor declarado → null. */
const ADDRESS_PRIVACY = new Set(['publica', 'solo_barrio', 'tras_confirmar']);

export interface LegacyContext { windowStart: number; windowEnd: number }

/** L3: creada en la ventana de aprovisionamiento y nunca editada → sembrada; si no, L6 confirmada. */
export function rowStatus(row: Row, ctx: LegacyContext): { status: StoredStatus; rule: LegacyRule } {
    const created = toMs(row.created_at);
    const updated = toMs(row.updated_at);
    const inWindow = Number.isFinite(created) && created >= ctx.windowStart - 2_000 && created <= ctx.windowEnd + 5_000;
    const unedited = !Number.isFinite(updated) || Math.abs(updated - created) < 1_000;
    return inWindow && unedited ? { status: 'seeded', rule: 'L3' } : { status: 'confirmed', rule: 'L6' };
}

/**
 * L1 (precio con `price_status`), L3/L6 (estado de la fila) y L7 (precio > 0 sin estado ni tipo → fijo inferido) para
 * una fila de una tabla con procedencia (§2.2). Es lo único que aplica la migración a ítems y textos, así que lectura
 * y migración no pueden divergir. El estado del contenido manda sobre la regla de precio (un ítem sembrado sigue
 * sembrado).
 */
export function legacyRowProvenance(table: string, row: Row, ctx: LegacyContext): RowProvenance {
    const st = rowStatus(row, ctx);
    const base: RowProvenance = {
        contentStatus: st.status, origin: st.status === 'seeded' ? 'platform_seed' : 'legacy', priceType: null, priceStatus: null, legacyRule: st.rule,
    };
    const cfg = PROVENANCE_TABLES[table];
    if (!cfg || cfg.kind === 'text' || !cfg.price) return base;
    const price = num(row[cfg.price]);
    // `example` manda en cualquier tabla que tenga `price_status`: un precio de ejemplo nunca es confirmado. `quote` y
    // `confirmed` solo son del estado heredado (services, membership_plans); en las demás tablas manda el precio (L7).
    const ps = str(row.price_status);
    let p: Partial<RowProvenance>;
    if (ps === 'example') p = { priceStatus: 'example', priceType: null, legacyRule: 'L1' };
    else if (cfg.legacyPriceStatus && ps === 'quote') p = { priceStatus: 'confirmed', priceType: 'a_cotizar', legacyRule: 'L1' };
    else if (cfg.legacyPriceStatus && ps === 'confirmed') p = { priceStatus: 'confirmed', priceType: null, legacyRule: 'L1' };
    else if (price !== null && price > 0) p = { priceStatus: 'confirmed', priceType: 'fijo', origin: 'legacy_inferred', legacyRule: 'L7' };
    else p = {};
    return {
        ...base, priceType: p.priceType ?? null, priceStatus: p.priceStatus ?? null,
        legacyRule: base.contentStatus === 'seeded' ? base.legacyRule : p.legacyRule ?? base.legacyRule,
        origin: base.contentStatus === 'seeded' ? base.origin : p.origin ?? base.origin,
    };
}

/** Procedencia real si la fila la tiene vigente; si no, las reglas L. */
export const rowProvenance = (table: string, row: Row, ctx: LegacyContext): RowProvenance =>
    realRowProvenance(table, row) ?? legacyRowProvenance(table, row, ctx);

const AUDIENCE: Record<string, string> = { b2c: 'B2C', b2b: 'B2B' };
const POLICY_TYPES: Record<string, string> = {
    cancellation: 'CORE.POLICY.CANCELLATION_CHANGES', cancelacion: 'CORE.POLICY.CANCELLATION_CHANGES',
    return: 'CORE.POLICY.REFUND_RETURNS', returns: 'CORE.POLICY.REFUND_RETURNS', refund: 'CORE.POLICY.REFUND_RETURNS',
    warranty: 'CORE.POLICY.WARRANTY', privacy: 'CORE.PRIVACY.NOTICE', shipping: 'CORE.DELIVERY.TERMS', delivery: 'CORE.DELIVERY.TERMS',
};

/** Ventana de aprovisionamiento del tenant (L3): de `tenants.created_at` a `settings.verticalProvisioning.completedAt`. */
export function legacyContextOf(rows: Pick<LegacyTenantRows, 'tenant'>): LegacyContext {
    const t = rows.tenant;
    const completedAt = t.settings?.verticalProvisioning?.completedAt ?? null;
    return { windowStart: toMs(t.created_at), windowEnd: Number.isFinite(toMs(completedAt)) ? toMs(completedAt) : toMs(t.created_at) + 60_000 };
}

export function fromLegacyRows(rows: LegacyTenantRows): TenantSnapshot {
    const t = rows.tenant;
    const settings = t.settings ?? {};
    const snap = emptySnapshot(t.ref, rows.capturedAt);
    snap.tenant = { ref: t.ref, slug: t.slug, name: t.name };
    const completedAt = settings.verticalProvisioning?.completedAt ?? null;
    snap.provisioningWindow = { tenantCreatedAt: iso(t.created_at), completedAt: iso(completedAt) };
    const ctx = legacyContextOf(rows);
    snap.source = { kind: 'legacy', notes: [
        'L5 aproximada: la plantilla de persona vive en código; toda configuración de persona con template_id se trata como sembrada.',
        'L4 extendida a valores por defecto de columna equivalentes (companies.country, properties.check_in/out, products.requires_prescription, real_estate_listings.financing_available = false, listas jsonb vacías).',
        'Horario: sin settings.businessHours ni config.hours de la persona se lee la agenda (availability_slots) con el estado de sus filas (R1.1).',
        'covers de las FAQs inferido del título (FAQ_COVERS_RULES, R1.1).',
    ] };
    const add = (id: string, rec: ValueRecord) => { (snap.values[id] ??= []).push(rec); };
    const legacyRec = (value: unknown, st: { status: StoredStatus; rule: LegacyRule }, storage: string, row?: Row): ValueRecord => ({
        value, status: st.status, origin: st.rule === 'L2' ? 'onboarding' : st.status === 'seeded' ? 'platform_seed' : 'legacy',
        confirmedAt: st.status === 'confirmed' ? iso(row?.updated_at ?? row?.created_at ?? t.created_at) : null,
        storage, legacyRule: st.rule,
    });
    const L2 = { status: 'confirmed' as const, rule: 'L2' as const };
    const L5 = { status: 'seeded' as const, rule: 'L5' as const };

    // identidad (L2)
    if (str(t.name)) add('CORE.IDENTITY.NAME', legacyRec({ display_name: t.name }, L2, 'tenants.name'));
    if (t.subtype) add('CORE.IDENTITY.PROFILE', legacyRec({ subtype: t.subtype }, L2, 'tenants.industry + settings.subType'));
    const company = rows.companies.find(c => c.is_primary) ?? rows.companies[0];
    const audience = jsonList(settings.customerTypes).map(x => AUDIENCE[String(x).toLowerCase()] ?? String(x));
    if (company && str(company.about)) {
        const draft = settings.businessInfoDraft ?? {};
        const fromDraft = [draft.about, draft.description].some(d => str(d) === str(company.about));
        add('CORE.IDENTITY.DESCRIPTION', legacyRec({ short: str(company.about), audience }, fromDraft ? L2 : rowStatus(company, ctx), 'companies.about (is_primary)', company));
    }
    if (str(t.language)) add('CORE.LANGUAGES.SERVED', legacyRec({ content_source_language: t.language }, L2, 'tenants.language'));

    // región: solo con origen declarado (no 'fallback', schema notes de REGION)
    const prov = t.regional_provenance ?? {};
    const provOf = (k: string) => String((prov[k] && typeof prov[k] === 'object' ? prov[k].source : prov[k]) ?? '');
    if (t.operating_country && provOf('operatingCountry') !== 'fallback' && Object.keys(prov).length) {
        const inferred = provOf('operatingCountry') === 'inferred';
        add('CORE.IDENTITY.REGION', legacyRec({
            operating_country: t.operating_country, timezone: t.operating_timezone, currency: t.operating_currency,
            default_locale: t.default_locale, country_pack: t.country_pack_id ? `${t.country_pack_id}@${t.country_pack_version ?? ''}` : null,
        }, inferred ? { status: 'seeded', rule: 'L3' } : { status: 'confirmed', rule: 'L6' }, 'tenants.operating_* + regional_provenance'));
    }

    // ubicación y contacto (fila is_primary de companies); companies.country 'CO' es el default de columna (L4)
    if (company) {
        const st = rowStatus(company, ctx);
        const country = company.country && company.country !== 'CO' ? company.country : t.operating_country;
        if (str(company.address) || str(company.city)) {
            add('CORE.LOCATIONS.LIST', legacyRec({ locations: [{ name: company.name, is_main: true, address: { line1: company.address ?? null, city: company.city ?? null, country: country ?? null } }] }, st, 'companies.address/city/country', company));
        }
        const points: Row[] = [];
        if (str(company.phone)) points.push({ kind: 'phone', value: company.phone });
        if (str(company.email)) points.push({ kind: 'email', value: company.email });
        if (str(company.website)) points.push({ kind: 'web', value: company.website });
        for (const [k, v] of Object.entries(company.social_links ?? {})) if (str(v)) points.push({ kind: 'social', label: k, value: v });
        if (points.length) add('CORE.CONTACT.CHANNELS', legacyRec({ points }, st, 'companies.phone/email/website/social_links', company));
    }

    // horario: settings.businessHours (campo del dueño) y persona config.hours (L5)
    const bh = normalizeHours(settings.businessHours);
    if (bh) add('CORE.HOURS.REGULAR', { ...legacyRec(bh, { status: 'confirmed', rule: 'L6' }, 'settings.businessHours'), confirmedAt: null });
    const persona = rows.agent_personas.find(p => p.is_active && p.is_default) ?? rows.agent_personas.find(p => p.is_active) ?? rows.agent_personas[0];
    const ph = persona ? normalizeHours((persona.config_json ?? {}).hours) : null;
    // R1.1 F1: tercer origen, la agenda (como el runtime), solo si ni el negocio ni la persona tienen horario. Su estado
    // es el de sus filas: la agenda que siembra la plantilla del alta (L3) queda sembrada, nunca confirmada (ADR 0006).
    const agendaHours = !bh && !ph ? hoursFromAgenda(rows.availability_slots) : null;
    if (agendaHours) {
        const active = rows.availability_slots.filter(s => s.is_active !== false);
        const seeded = active.every(s => rowStatus(s, ctx).status === 'seeded');
        const newest = active.reduce((a, b) => (toMs(b.created_at) > toMs(a.created_at) ? b : a));
        add('CORE.HOURS.REGULAR', legacyRec(agendaHours, seeded ? { status: 'seeded', rule: 'L3' } : { status: 'confirmed', rule: 'L6' }, 'availability_slots (agenda; horario informativo)', newest));
    }
    if (persona) {
        const cfg = persona.config_json ?? {};
        const personaStatus = persona.template_id ? L5 : rowStatus(persona, ctx);
        if (ph) add('CORE.HOURS.REGULAR', legacyRec(ph, personaStatus, 'agent_personas.config_json.hours', persona));
        const b = cfg.behavior ?? {};
        const triggers = jsonList(b.handoffTriggers).map(String);
        const forbidden = jsonList(b.forbiddenTopics).map(String);
        const rules = jsonList(b.rules).map(String);
        if (triggers.length) add('CORE.HANDOFF.ALWAYS_HUMAN', legacyRec({ business_additions: triggers }, personaStatus, 'config_json.behavior.handoffTriggers', persona));
        if (forbidden.length) add('CORE.SAFETY.FORBIDDEN_TOPICS', legacyRec(forbidden.map(topic => ({ topic, response: 'rechazo_breve' })), personaStatus, 'config_json.behavior.forbiddenTopics', persona));
        const instructions = [
            ...rules.map(text => ({ text, kind: 'rule' })), ...forbidden.map(text => ({ text, kind: 'forbidden_topic' })),
            ...triggers.map(text => ({ text, kind: 'handoff_trigger' })),
        ].map(i => ({ ...i, origin: persona.template_id ? 'plantilla' : 'dueño', status: personaStatus.status, active: true }));
        if (instructions.length) add('CORE.KNOWLEDGE.AGENT_INSTRUCTIONS', legacyRec({ instructions }, personaStatus, 'agent_personas.config_json.behavior', persona));
        if (cfg.llm?.memory) add('CORE.PRIVACY.CUSTOMER_MEMORY', legacyRec({ mode: cfg.llm.memory.longTerm ? 'siempre_no_sensibles' : 'solo_conversación' }, personaStatus, 'config_json.llm.memory', persona));
        const after = str(cfg.hours?.afterHoursMessage);
        if (after) add('CORE.HANDOFF.HOURS_SLA', legacyRec({ out_of_hours_message: after }, personaStatus, 'config_json.hours.afterHoursMessage', persona));
    }

    // políticas (texto libre: los campos estructurados quedan vacíos → parcial)
    for (const p of rows.policies.filter(x => x.is_active !== false)) {
        const id = POLICY_TYPES[String(p.type ?? '').toLowerCase()];
        if (id) add(id, legacyRec({ summary: p.content, title: p.title }, rowStatus(p, ctx), `policies.type = ${p.type}`, p));
    }
    for (const l of rows.legal_text_versions.filter(x => x.active !== false && /privacy|privacidad|general/i.test(String(x.type ?? '')))) {
        add('CORE.PRIVACY.NOTICE', legacyRec({ url_or_text: l.text, version: l.version }, rowStatus(l, ctx), 'legal_text_versions', l));
    }

    // promociones
    const promos = [...rows.menu_promotions.filter(p => p.is_active !== false), ...rows.commercial_offers.filter(p => p.active !== false)];
    if (promos.length) {
        const seeded = promos.every(p => rowStatus(p, ctx).status === 'seeded');
        add('CORE.OFFER.PROMOTIONS', legacyRec(promos.map(p => ({ title: p.title, valid_from: iso(p.valid_from), valid_to: iso(p.valid_to) })), seeded ? { status: 'seeded', rule: 'L3' } : { status: 'confirmed', rule: 'L6' }, 'menu_promotions + commercial_offers'));
    }

    // depósito por ítem: payment_policy 'none' es el default de columna (L4) → sembrado, nunca «ninguno» confirmado
    const depositRows = [...rows.services, ...rows.products, ...rows.properties, ...rows.tour_packages];
    if (depositRows.length && depositRows.every(r => (r.payment_policy ?? 'none') === 'none')) {
        add('CORE.PAYMENT.TIMING_DEPOSIT', legacyRec({ deposit: 'ninguno' }, { status: 'seeded', rule: 'L4' }, '<tabla>.payment_policy (default de columna)'));
    }
    for (const r of depositRows.filter(x => x.payment_policy && x.payment_policy !== 'none')) {
        add('CORE.PAYMENT.TIMING_DEPOSIT', { ...legacyRec({ when: r.payment_policy, deposit: { percent: num(r.deposit_percent), amount: num(r.deposit_amount) } }, rowStatus(r, ctx), 'payment_policy por ítem', r), scopeKey: `item:${r.id}` });
    }

    // ítems por objeto: procedencia real si la hay (§2.2), si no L1/L3/L6/L7 (legacyRowProvenance)
    let realRows = 0;
    const item = (table: string, row: Row, fields: Row, activeRow: Row = row): ItemRecord => {
        const p = rowProvenance(table, row, ctx);
        if (p.legacyRule === null) realRows++;
        return {
            id: String(row.id), active: activeRow.is_active !== false && activeRow.active !== false && activeRow.status !== 'archived',
            fields, contentStatus: p.contentStatus, origin: p.origin, legacyRule: p.legacyRule,
            createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
            priceStatus: p.priceStatus, priceType: p.priceType,
        };
    };
    const listStatus = (v: unknown, base: StoredStatus): StoredStatus => (jsonList(v).length ? base : 'seeded');

    const staffByService = new Map<string, string[]>();
    for (const s of rows.service_staff) staffByService.set(String(s.service_id), [...(staffByService.get(String(s.service_id)) ?? []), String(s.user_id)]);
    if (rows.services.length) snap.items.appointment = rows.services.map(r => {
        const base = item('services', r, {
            name: r.name, description: str(r.description), category: str(r.category),
            duration: num(r.duration_minutes) ? { min: num(r.duration_minutes), unit: 'min' } : null,
            price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null, currency: r.currency,
            preparation_ref: r.metadata?.preparation_ref ?? null, staff_ids: staffByService.get(String(r.id)) ?? [],
            // R1.1 F5: datos que el motor de reservas exige para este servicio (WRITE_MODE.required_fields por ítem)
            required_fields: jsonList(r.required_fields).map(String),
        });
        return {
            ...base,
            fieldStatus: { staff_ids: base.contentStatus, required_fields: listStatus(r.required_fields, base.contentStatus) },
            ...(str(r.price_status) ? { priceMarker: true } : {}),
        };
    });
    const categories = new Map(rows.menu_categories.map(c => [String(c.id), c.name]));
    if (rows.menu_items.length) snap.items.food_order = rows.menu_items.map(r => {
        const base = item('menu_items', r, {
            name: r.name, category: r.category_id ? categories.get(String(r.category_id)) ?? null : null,
            price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null, active: r.is_active !== false,
            description: str(r.description), allergens: jsonList(r.allergens), diet_tags: jsonList(r.tags), available: r.is_available !== false,
        });
        return { ...base, fieldStatus: { allergens: listStatus(r.allergens, base.contentStatus), diet_tags: listStatus(r.tags, base.contentStatus) } };
    });
    const catalog: ItemRecord[] = [
        ...rows.products.map(r => {
            const base = item('products', r, {
                name: r.name, category: str(r.category), price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null,
                active: r.is_available !== false, description: str(r.description), requires_prescription: r.requires_prescription,
                // R1.1 F4: unidades en existencia (dato de disponibilidad del ítem; resource_model = stock)
                stock: num(r.stock),
            }, { ...r, is_active: r.is_available !== false });
            return { ...base, fieldStatus: { requires_prescription: r.requires_prescription === true ? base.contentStatus : 'seeded' } };
        }),
        ...rows.ecommerce_products.map(r => ({
            id: String(r.id), active: r.status === 'active', contentStatus: 'confirmed' as const, origin: 'integration',
            fields: { name: r.title, category: str(r.product_type), price: num(r.price_cents) !== null ? num(r.price_cents)! / 100 : null, active: r.status === 'active', description: str(r.description) },
            priceStatus: 'confirmed' as const, priceType: 'fijo' as PriceType, createdAt: iso(r.created_at), updatedAt: iso(r.synced_at),
        })),
    ];
    if (catalog.length) snap.items.catalog_order = catalog;
    if (rows.properties.length) {
        snap.items.lodging_booking = rows.properties.map(r => {
            const base = item('properties', r, {
                unit_name: r.name, max_guests: num(r.max_guests), beds: num(r.bedrooms), description: str(r.description),
                price_per_night: num(r.night_price) && num(r.night_price)! > 0 ? num(r.night_price) : null, min_nights: num(r.min_nights),
                amenities: jsonList(r.amenities),
            });
            return base;
        });
        const p = rows.properties.find(x => x.is_active !== false) ?? rows.properties[0];
        const isDefault = String(p.check_in_time ?? '').startsWith('15:00') && String(p.check_out_time ?? '').startsWith('11:00');
        add('OBJ.LODGING_BOOKING.CHECKIN_RULES', legacyRec(
            { check_in_from: String(p.check_in_time ?? '').slice(0, 5) || null, check_out_until: String(p.check_out_time ?? '').slice(0, 5) || null },
            isDefault ? { status: 'seeded', rule: 'L4' } : rowStatus(p, ctx), 'properties.check_in_time/check_out_time', p));
    }
    const departuresByPackage = new Map<string, Row[]>();
    for (const d of rows.tour_inventory.filter(x => x.is_active !== false && toMs(x.departure_date) >= toMs(String(rows.capturedAt).slice(0, 10)))) {
        departuresByPackage.set(String(d.package_id), [...(departuresByPackage.get(String(d.package_id)) ?? []), d]);
    }
    if (rows.tour_packages.length) snap.items.tour_booking = rows.tour_packages.map(r => {
        const base = item('tour_packages', r, {
            name: r.name, destination: str(r.destination), description: str(r.description),
            duration: num(r.duration_value) ? { min: num(r.duration_value), unit: r.duration_type } : null,
            price_per_passenger_type: num(r.price) && num(r.price)! > 0 ? { adulto: num(r.price) } : null,
            includes: jsonList(r.includes), excludes: jsonList(r.excludes), meeting_point: str(r.departure_location),
            // R1.1 F4: idiomas del guía (campo opcional guide_languages del objeto)
            guide_languages: jsonList(r.languages).map(String),
            // R1.1 F4: salidas futuras activas del paquete (dato de disponibilidad: availability_data.departures[])
            departures: (departuresByPackage.get(String(r.id)) ?? []).map(d => ({ date: String(d.departure_date).slice(0, 10), seats_left: num(d.available_seats) })),
        });
        const deps = departuresByPackage.get(String(r.id)) ?? [];
        return {
            ...base,
            fieldStatus: {
                includes: listStatus(r.includes, base.contentStatus), excludes: listStatus(r.excludes, base.contentStatus),
                guide_languages: listStatus(r.languages, base.contentStatus),
                ...(deps.length ? { departures: deps.every(d => rowStatus(d, ctx).status === 'seeded') ? 'seeded' as const : 'confirmed' as const } : {}),
            },
        };
    });
    if (rows.real_estate_listings.length) snap.items.real_estate = rows.real_estate_listings.map(r => {
        const base = item('real_estate_listings', r, {
            operation: str(r.transaction_type), property_type: str(r.property_kind), price: num(r.price), currency: r.currency,
            zone: str(r.neighborhood), city: str(r.city), country: r.country && r.country !== 'CO' ? r.country : t.operating_country,
            bedrooms: num(r.bedrooms), bathrooms: num(r.bathrooms), area_m2: num(r.area_m2), status: str(r.status),
            // R1.1 F3: dirección del listado; la verdad QA la afirma solo si address_privacy es publica o no está declarada
            address: str(r.address),
            address_privacy: ADDRESS_PRIVACY.has(String(r.address_privacy ?? '')) ? String(r.address_privacy) : null,
            admin_fee: num(r.hoa_fee), description: str(r.description),
        });
        return base;
    });
    // R1.1 F3: financiación por listado. `false` es el valor por defecto de la columna (L4): no es un «no» confirmado.
    for (const r of rows.real_estate_listings.filter(x => typeof x.financing_available === 'boolean')) {
        const st = r.financing_available === true ? rowStatus(r, ctx) : { status: 'seeded' as const, rule: 'L4' as const };
        add('CORE.PAYMENT.FINANCING', { ...legacyRec({ installments: { enabled: r.financing_available } }, st, 'real_estate_listings.financing_available', r), scopeKey: `item:${r.id}` });
    }

    // disponibilidad (datos para cuando se declare la fuente)
    const slots = rows.availability_slots.filter(s => s.is_active !== false);
    if (slots.length) snap.availability.appointment = {
        nativeDaysLoaded: 14,
        agendaWindows: slots.map(s => ({ day: Number(s.day_of_week), open: String(s.start_time).slice(0, 5), close: String(s.end_time).slice(0, 5) })),
        agendaStatus: slots.every(s => rowStatus(s, ctx).status === 'seeded') ? 'seeded' : 'confirmed',
    };
    const departures = rows.tour_inventory.filter(d => d.is_active !== false && toMs(d.departure_date) >= toMs(rows.capturedAt));
    if (rows.tour_inventory.length) snap.availability.tour_booking = {
        nativeDaysLoaded: departures.length ? Math.floor((Math.max(...departures.map(d => toMs(d.departure_date))) - toMs(rows.capturedAt)) / 86_400_000) : 0,
    };
    if (rows.menu_items.length) snap.availability.food_order = {
        manualUpdatedAt: iso(Math.max(...rows.menu_items.map(m => toMs(m.updated_at)).filter(Number.isFinite)) || null),
    };

    // textos
    const texts: TextRecord[] = [
        ...rows.faqs.map(f => {
            const p = rowProvenance('faqs', f, ctx);
            if (p.legacyRule === null) realRows++;
            const covers = inferCovers(String(f.question ?? ''));
            return {
                id: String(f.id), kind: 'faq' as const, title: String(f.question ?? ''), body: String(f.answer ?? ''), published: f.is_published !== false,
                status: p.contentStatus, origin: p.origin, legacyRule: p.legacyRule, ...(covers.length ? { covers } : {}),
            };
        }),
        ...rows.knowledge_documents.map(d => {
            const p = rowProvenance('knowledge_documents', d, ctx);
            if (p.legacyRule === null) realRows++;
            return {
                id: String(d.id), kind: 'document' as const, title: String(d.title ?? ''), body: String(d.excerpt ?? ''), published: true,
                status: p.contentStatus, origin: p.origin, legacyRule: p.legacyRule, accessible: !/fail|error/i.test(String(d.status ?? '')), validTo: iso(d.valid_to),
            };
        }),
    ];
    snap.texts = texts;

    snap.accounts = rows.users.map(u => ({ id: u.id, role: u.role, active: u.is_active, emailVerified: u.email_verified, handoffNotifications: u.handoff_notifications }));
    const slotUsers = new Set(slots.map(s => String(s.user_id)));
    snap.staff = { activeBookable: rows.staff_members.filter(s => s.is_active !== false).length + slotUsers.size };
    snap.integrations = { paymentProvider: rows.payment_provider_configured };
    snap.platform = { countryPack: rows.country_pack, followUpRegistry: false };

    // valores con procedencia real (requirement_values): mandan sobre lo que dedujeron las reglas L (provenance.ts)
    const rv = applyRequirementValues(snap, rows.requirement_values);
    if (realRows || rv.used || rv.stale) {
        snap.source.notes?.push(`Procedencia real (R3): ${realRows} filas de ítems y textos, ${rv.used} valores de requirement_values`
            + (rv.stale ? `; ${rv.stale} valores migrados ignorados porque su almacenamiento de hoy cambió después de la migración` : '') + '.');
    }
    return snap;
}
