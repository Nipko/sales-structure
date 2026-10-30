/**
 * SnapshotReader (C0 §1.1): lee de SOLO LECTURA las tablas de hoy de un tenant y entrega las filas
 * que @parallext/business-spec convierte en TenantSnapshot con las reglas L1–L7 (schema §7.5).
 *
 * Desde R2 la imagen de la API empaqueta @parallext/business-spec, así que las filas usan el tipo del paquete
 * (`LegacyTenantRows`) en lugar de una copia local.
 *
 * Nunca selecciona contraseñas, secretos, tokens ni datos de pago: solo columnas de negocio.
 */
import type { CountryPackInfo, LegacyTenantRows } from '@parallext/business-spec';
import { canonicalSubtypeId, countryPackIdFor, emergencyContactsFor } from '@parallext/shared';

type Row = Record<string, any>;

/** Ejecuta UNA sentencia SELECT que devuelve un único valor JSON. */
export interface SqlJsonRunner {
    queryJson<T = unknown>(sql: string): Promise<T>;
}

/** Columnas leídas por tabla del esquema del tenant (ninguna con secretos). */
export const TENANT_TABLE_COLUMNS: Readonly<Record<string, string>> = {
    companies: 'id, name, about, address, city, country, phone, email, website, social_links, is_primary, created_at, updated_at',
    services: 'id, name, description, category, duration_minutes, price, currency, price_status, is_active, metadata, location_type, required_fields, payment_policy, deposit_percent, deposit_amount, created_at, updated_at',
    service_staff: 'id, service_id, user_id, created_at',
    menu_items: 'id, category_id, name, description, price, currency, allergens, tags, is_available, is_active, created_at, updated_at',
    menu_categories: 'id, name, is_active, created_at, updated_at',
    products: 'id, name, description, category, price, currency, is_available, stock, requires_prescription, payment_policy, deposit_percent, deposit_amount, created_at, updated_at',
    ecommerce_products: 'id, provider, title, description, product_type, price_cents, currency, status, created_at, synced_at',
    properties: 'id, name, description, city, max_guests, bedrooms, bathrooms, night_price, cleaning_fee, currency, min_nights, check_in_time, check_out_time, amenities, house_rules, is_active, payment_policy, deposit_percent, deposit_amount, created_at, updated_at',
    tour_packages: 'id, name, description, duration_type, duration_value, price, currency, departure_location, destination, languages, includes, excludes, cancellation_policy, is_active, payment_policy, deposit_percent, deposit_amount, created_at, updated_at',
    tour_inventory: 'id, package_id, departure_date, available_seats, total_seats, is_active, created_at, updated_at',
    // R1.1 F3: dirección, privacidad declarada (metadata.address_privacy) y financiación del listado
    real_estate_listings: "id, name, transaction_type, property_kind, price, currency, hoa_fee, deposit, bedrooms, bathrooms, area_m2, address, metadata->>'address_privacy' AS address_privacy, financing_available, neighborhood, city, country, description, status, is_active, created_at, updated_at",
    faqs: 'id, question, answer, category, is_published, created_at, updated_at',
    policies: 'id, type, title, content, version, is_active, created_at, updated_at',
    legal_text_versions: 'id, type, name, version, text, active, created_at, updated_at',
    knowledge_documents: 'id, title, excerpt, status, source_type, language, valid_to, created_at, updated_at',
    menu_promotions: 'id, title, valid_from, valid_to, is_active, created_at, updated_at',
    commercial_offers: 'id, title, offer_type, valid_from, valid_to, active, created_at',
    availability_slots: 'id, user_id, day_of_week, start_time, end_time, is_active, created_at',
    staff_members: 'id, is_active, created_at, updated_at',
    agent_personas: "id, template_id, is_active, is_default, schedule_mode, created_at, updated_at, jsonb_build_object('hours', config_json::jsonb->'hours', 'behavior', config_json::jsonb->'behavior', 'llm', jsonb_build_object('memory', config_json::jsonb->'llm'->'memory')) AS config_json",
};

const SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** El pack de país tal como lo resuelve la plataforma (packages/shared/src/tenant-regional-profile.ts). */
export function resolveCountryPack(country: string | null | undefined): CountryPackInfo | null {
    if (!country) return null;
    const em = emergencyContactsFor(country);
    return {
        id: countryPackIdFor(country),
        country,
        emergency: em ? { medical: em.medical ?? null, crisisLine: em.crisisLine ?? null, reviewStatus: String(em.reviewStatus) } : null,
        // El pack no tiene derechos del consumidor (verificado en B2 §4): hueco de plataforma.
        consumerRights: null,
    };
}

export class SnapshotReader {
    constructor(private readonly runner: SqlJsonRunner, private readonly clock: () => Date = () => new Date()) {}

    /** SQL de solo lectura que arma las filas de un tenant en un único JSON. */
    static buildSql(schemaName: string, existingTables: readonly string[]): string {
        if (!SCHEMA_NAME.test(schemaName)) throw new Error(`nombre de esquema inválido: ${schemaName}`);
        const tenantFilter = `(SELECT id FROM public.tenants WHERE schema_name = ${quoteLiteral(schemaName)})`;
        const parts = Object.entries(TENANT_TABLE_COLUMNS).map(([table, columns]) => existingTables.includes(table)
            ? `'${table}', (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT ${columns} FROM "${schemaName}"."${table}") x)`
            : `'${table}', '[]'::json`);
        return `SELECT json_build_object(
  'tenant', (SELECT row_to_json(x) FROM (SELECT id::text AS ref, slug, name, industry, language, created_at, settings,
      operating_country, operating_timezone, operating_currency, default_locale, country_pack_id, country_pack_version, regional_provenance
      FROM public.tenants WHERE schema_name = ${quoteLiteral(schemaName)}) x),
  ${parts.join(',\n  ')},
  'users', (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT id::text AS id, role, coalesce(is_active, false) AS is_active,
      coalesce(email_verified, false) AS email_verified,
      coalesce((notification_preferences->'categories'->>'handoff')::boolean, false) AS handoff_notifications
      FROM public.users WHERE tenant_id = ${tenantFilter}) x),
  'payment_provider_configured', EXISTS (SELECT 1 FROM public.tenant_payment_provider_configs WHERE tenant_id = ${tenantFilter})
)`;
    }

    async readRows(schemaName: string): Promise<LegacyTenantRows> {
        if (!SCHEMA_NAME.test(schemaName)) throw new Error(`nombre de esquema inválido: ${schemaName}`);
        const tables = await this.runner.queryJson<string[] | null>(
            `SELECT coalesce(json_agg(table_name), '[]'::json) FROM information_schema.tables WHERE table_schema = ${quoteLiteral(schemaName)}`);
        const raw = await this.runner.queryJson<Row>(SnapshotReader.buildSql(schemaName, tables ?? []));
        if (!raw?.tenant) throw new Error(`tenant no encontrado para el esquema ${schemaName}`);
        const t = raw.tenant;
        const settings = t.settings ?? {};
        const canon = canonicalSubtypeId(t.industry, settings.subType);
        const subtype = canon ? `${canon.industry}/${canon.subtype || '__none__'}` : null;
        const rows = {
            schema: 'business-spec/legacy-rows@1' as const,
            capturedAt: this.clock().toISOString(),
            tenant: { ...t, subtype, settings },
            users: raw.users ?? [],
            payment_provider_configured: raw.payment_provider_configured === true,
            country_pack: resolveCountryPack(t.operating_country),
        } as LegacyTenantRows;
        for (const table of Object.keys(TENANT_TABLE_COLUMNS)) (rows as unknown as Row)[table] = raw[table] ?? [];
        return rows;
    }
}
