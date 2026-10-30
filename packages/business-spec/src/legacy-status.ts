/**
 * Estado de los datos heredados (schema §7.5, reglas L1–L7): filas de las tablas de hoy → TenantSnapshot.
 *
 * Puro. La lectura la hace SnapshotReader (apps/api/src/modules/readiness) y entrega `LegacyTenantRows`.
 * Las reglas se retiran tabla por tabla cuando exista la procedencia real (C0 §2.9, K4).
 */
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
    users: { id: string; role: string; is_active: boolean; email_verified: boolean; handoff_notifications: boolean }[];
    payment_provider_configured: boolean;
    /** Pack de país resuelto por el lector (emergencias de packages/shared); null si no hay país. */
    country_pack: CountryPackInfo | null;
}

/** Marca de tiempo de Postgres; sin zona = UTC (la base corre en UTC). */
export function toMs(s: unknown): number {
    if (s === null || s === undefined || s === '') return NaN;
    const t = String(s).replace(' ', 'T');
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}
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

export interface LegacyContext { windowStart: number; windowEnd: number }

/** L3: creada en la ventana de aprovisionamiento y nunca editada → sembrada; si no, L6 confirmada. */
export function rowStatus(row: Row, ctx: LegacyContext): { status: StoredStatus; rule: LegacyRule } {
    const created = toMs(row.created_at);
    const updated = toMs(row.updated_at);
    const inWindow = Number.isFinite(created) && created >= ctx.windowStart - 2_000 && created <= ctx.windowEnd + 5_000;
    const unedited = !Number.isFinite(updated) || Math.abs(updated - created) < 1_000;
    return inWindow && unedited ? { status: 'seeded', rule: 'L3' } : { status: 'confirmed', rule: 'L6' };
}

const AUDIENCE: Record<string, string> = { b2c: 'B2C', b2b: 'B2B' };
const POLICY_TYPES: Record<string, string> = {
    cancellation: 'CORE.POLICY.CANCELLATION_CHANGES', cancelacion: 'CORE.POLICY.CANCELLATION_CHANGES',
    return: 'CORE.POLICY.REFUND_RETURNS', returns: 'CORE.POLICY.REFUND_RETURNS', refund: 'CORE.POLICY.REFUND_RETURNS',
    warranty: 'CORE.POLICY.WARRANTY', privacy: 'CORE.PRIVACY.NOTICE', shipping: 'CORE.DELIVERY.TERMS', delivery: 'CORE.DELIVERY.TERMS',
};

export function fromLegacyRows(rows: LegacyTenantRows): TenantSnapshot {
    const t = rows.tenant;
    const settings = t.settings ?? {};
    const snap = emptySnapshot(t.ref, rows.capturedAt);
    snap.tenant = { ref: t.ref, slug: t.slug, name: t.name };
    const completedAt = settings.verticalProvisioning?.completedAt ?? null;
    snap.provisioningWindow = { tenantCreatedAt: iso(t.created_at), completedAt: iso(completedAt) };
    const ctx: LegacyContext = { windowStart: toMs(t.created_at), windowEnd: Number.isFinite(toMs(completedAt)) ? toMs(completedAt) : toMs(t.created_at) + 60_000 };
    snap.source = { kind: 'legacy', notes: [
        'L5 aproximada: la plantilla de persona vive en código; toda configuración de persona con template_id se trata como sembrada.',
        'L4 extendida a valores por defecto de columna equivalentes (companies.country, properties.check_in/out, products.requires_prescription, listas jsonb vacías).',
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
    if (persona) {
        const cfg = persona.config_json ?? {};
        const personaStatus = persona.template_id ? L5 : rowStatus(persona, ctx);
        const ph = normalizeHours(cfg.hours);
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

    // ítems por objeto
    const item = (row: Row, fields: Row, extra: Partial<ItemRecord> = {}): ItemRecord => {
        const st = rowStatus(row, ctx);
        return {
            id: String(row.id), active: row.is_active !== false && row.active !== false && row.status !== 'archived',
            fields, contentStatus: st.status, origin: st.status === 'seeded' ? 'platform_seed' : 'legacy', legacyRule: st.rule,
            createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...extra,
        };
    };
    /** L1 (price_status) y L7 (precio > 0 sin price_status ni price_type → fijo inferido). */
    const priceOf = (row: Row, price: number | null, hasPriceStatus: boolean): Partial<ItemRecord> => {
        const ps = hasPriceStatus ? str(row.price_status) : null;
        if (ps === 'example') return { priceStatus: 'example', priceType: null, legacyRule: 'L1' };
        if (ps === 'quote') return { priceStatus: 'confirmed', priceType: 'a_cotizar' as PriceType, legacyRule: 'L1' };
        if (ps === 'confirmed') return { priceStatus: 'confirmed', priceType: null, legacyRule: 'L1' };
        if (price !== null && price > 0) return { priceStatus: 'confirmed', priceType: 'fijo', origin: 'legacy_inferred', legacyRule: 'L7' };
        return { priceStatus: null, priceType: null };
    };
    const keepRule = (base: ItemRecord, price: Partial<ItemRecord>): ItemRecord => ({
        ...base, ...price,
        // el estado del contenido manda sobre la regla de precio (un ítem sembrado sigue sembrado)
        legacyRule: base.contentStatus === 'seeded' ? base.legacyRule : price.legacyRule ?? base.legacyRule,
        origin: base.contentStatus === 'seeded' ? base.origin : price.origin ?? base.origin,
    });
    const listStatus = (v: unknown, base: StoredStatus): StoredStatus => (jsonList(v).length ? base : 'seeded');

    const staffByService = new Map<string, string[]>();
    for (const s of rows.service_staff) staffByService.set(String(s.service_id), [...(staffByService.get(String(s.service_id)) ?? []), String(s.user_id)]);
    if (rows.services.length) snap.items.appointment = rows.services.map(r => {
        const base = item(r, {
            name: r.name, description: str(r.description), category: str(r.category),
            duration: num(r.duration_minutes) ? { min: num(r.duration_minutes), unit: 'min' } : null,
            price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null, currency: r.currency,
            preparation_ref: r.metadata?.preparation_ref ?? null, staff_ids: staffByService.get(String(r.id)) ?? [],
        });
        return keepRule({ ...base, fieldStatus: { staff_ids: base.contentStatus } }, priceOf(r, num(r.price), true));
    });
    const categories = new Map(rows.menu_categories.map(c => [String(c.id), c.name]));
    if (rows.menu_items.length) snap.items.food_order = rows.menu_items.map(r => {
        const base = item(r, {
            name: r.name, category: r.category_id ? categories.get(String(r.category_id)) ?? null : null,
            price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null, active: r.is_active !== false,
            description: str(r.description), allergens: jsonList(r.allergens), diet_tags: jsonList(r.tags), available: r.is_available !== false,
        });
        return keepRule({ ...base, fieldStatus: { allergens: listStatus(r.allergens, base.contentStatus), diet_tags: listStatus(r.tags, base.contentStatus) } }, priceOf(r, num(r.price), false));
    });
    const catalog: ItemRecord[] = [
        ...rows.products.map(r => {
            const base = item({ ...r, is_active: r.is_available !== false }, {
                name: r.name, category: str(r.category), price: num(r.price) && num(r.price)! > 0 ? num(r.price) : null,
                active: r.is_available !== false, description: str(r.description), requires_prescription: r.requires_prescription,
            });
            return keepRule({ ...base, fieldStatus: { requires_prescription: r.requires_prescription === true ? base.contentStatus : 'seeded' } }, priceOf(r, num(r.price), false));
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
            const base = item(r, {
                unit_name: r.name, max_guests: num(r.max_guests), beds: num(r.bedrooms), description: str(r.description),
                price_per_night: num(r.night_price) && num(r.night_price)! > 0 ? num(r.night_price) : null, min_nights: num(r.min_nights),
                amenities: jsonList(r.amenities),
            });
            return keepRule(base, priceOf(r, num(r.night_price), false));
        });
        const p = rows.properties.find(x => x.is_active !== false) ?? rows.properties[0];
        const isDefault = String(p.check_in_time ?? '').startsWith('15:00') && String(p.check_out_time ?? '').startsWith('11:00');
        add('OBJ.LODGING_BOOKING.CHECKIN_RULES', legacyRec(
            { check_in_from: String(p.check_in_time ?? '').slice(0, 5) || null, check_out_until: String(p.check_out_time ?? '').slice(0, 5) || null },
            isDefault ? { status: 'seeded', rule: 'L4' } : rowStatus(p, ctx), 'properties.check_in_time/check_out_time', p));
    }
    if (rows.tour_packages.length) snap.items.tour_booking = rows.tour_packages.map(r => {
        const base = item(r, {
            name: r.name, destination: str(r.destination), description: str(r.description),
            duration: num(r.duration_value) ? { min: num(r.duration_value), unit: r.duration_type } : null,
            price_per_passenger_type: num(r.price) && num(r.price)! > 0 ? { adulto: num(r.price) } : null,
            includes: jsonList(r.includes), excludes: jsonList(r.excludes), meeting_point: str(r.departure_location),
        });
        return keepRule({ ...base, fieldStatus: { includes: listStatus(r.includes, base.contentStatus), excludes: listStatus(r.excludes, base.contentStatus) } }, priceOf(r, num(r.price), false));
    });
    if (rows.real_estate_listings.length) snap.items.real_estate = rows.real_estate_listings.map(r => {
        const base = item(r, {
            operation: str(r.transaction_type), property_type: str(r.property_kind), price: num(r.price), currency: r.currency,
            zone: str(r.neighborhood), city: str(r.city), country: r.country && r.country !== 'CO' ? r.country : t.operating_country,
            bedrooms: num(r.bedrooms), bathrooms: num(r.bathrooms), area_m2: num(r.area_m2), status: str(r.status),
            address_privacy: null, admin_fee: num(r.hoa_fee), description: str(r.description),
        });
        return keepRule(base, priceOf(r, num(r.price), false));
    });

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
            const st = rowStatus(f, ctx);
            return { id: String(f.id), kind: 'faq' as const, title: String(f.question ?? ''), body: String(f.answer ?? ''), published: f.is_published !== false, status: st.status, origin: st.status === 'seeded' ? 'platform_seed' : 'legacy', legacyRule: st.rule };
        }),
        ...rows.knowledge_documents.map(d => {
            const st = rowStatus(d, ctx);
            return {
                id: String(d.id), kind: 'document' as const, title: String(d.title ?? ''), body: String(d.excerpt ?? ''), published: true,
                status: st.status, origin: 'legacy', legacyRule: st.rule, accessible: !/fail|error/i.test(String(d.status ?? '')), validTo: iso(d.valid_to),
            };
        }),
    ];
    snap.texts = texts;

    snap.accounts = rows.users.map(u => ({ id: u.id, role: u.role, active: u.is_active, emailVerified: u.email_verified, handoffNotifications: u.handoff_notifications }));
    const slotUsers = new Set(slots.map(s => String(s.user_id)));
    snap.staff = { activeBookable: rows.staff_members.filter(s => s.is_active !== false).length + slotUsers.size };
    snap.integrations = { paymentProvider: rows.payment_provider_configured };
    snap.platform = { countryPack: rows.country_pack, followUpRegistry: false };
    return snap;
}
