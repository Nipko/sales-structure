/**
 * Procedencia real (C0 §2.1, §2.2 y §2.9, rebanada R3): cómo se lee lo que ya está escrito con `{status, origin, …}`.
 *
 * Puro. Dos mecanismos, ninguno más (C0 §0.4):
 * - valores del negocio: filas de `requirement_values` (una por requisito y alcance);
 * - ítems y textos: el juego estándar de columnas en su propia tabla (`content_status`, `origin`, `confirmed_by`,
 *   `confirmed_at`, `source_ref`, y `price_type`/`price_status` en las tablas con precio).
 *
 * Las reglas L1–L7 (`legacy-status.ts`) solo deciden lo que NO tiene procedencia real vigente. Mientras los editores
 * de hoy (las pantallas que no conocen estas columnas) sigan vivos, la procedencia de una fila vale solo mientras la
 * fila no cambió desde que se escribió: cada escritura con procedencia estampa `source_ref.row_updated_at`, y si un
 * editor viejo toca la fila después, su `updated_at` ya no coincide y la fila vuelve a las reglas L.
 */
import { canonicalJson, sha256 } from './hash';
import type { PriceType, StoredStatus, TenantSnapshot, ValueRecord } from './types';

type Row = Record<string, any>;

/** Orígenes de un valor (C0 §2.1). Los cuatro últimos solo los escribe la migración. */
export const PROVENANCE_ORIGINS = [
    'owner_form', 'copilot', 'import', 'integration', 'country_pack', 'default_accepted', 'pending_answer',
    'onboarding', 'platform_seed', 'legacy', 'legacy_inferred',
] as const;
export type ProvenanceOrigin = typeof PROVENANCE_ORIGINS[number];
/** Orígenes que solo escribe `backfill-provenance` (datos heredados, schema §7.5). */
export const MIGRATION_ORIGINS: ReadonlySet<string> = new Set(['onboarding', 'platform_seed', 'legacy', 'legacy_inferred']);

export const STORED_STATUSES: readonly StoredStatus[] = ['confirmed', 'example', 'seeded'];
export const PRICE_TYPES: readonly PriceType[] = ['fijo', 'desde', 'a_cotizar', 'gratis'];

/** Marca de la migración en `source_ref.backfill` (C0 §2.9). */
export const BACKFILL_MARK = 'backfill-provenance@1';

export interface ProvenanceTable {
    /** Columna de precio (null en textos). */
    price: string | null;
    /** La tabla ya tenía `price_status` (`confirmed|example|quote`) antes de R3: sus escritores de hoy la mantienen. */
    legacyPriceStatus: boolean;
    kind: 'item' | 'text';
}

/**
 * Tablas con el juego estándar de columnas (C0 §2.2), con los nombres verificados en `tenant-schema.sql`. Los paquetes
 * de fotografía y el catálogo de servicios del hogar no tienen tabla propia: viven en `services` (`photo_sessions` y
 * `service_requests` son registros, no catálogo).
 */
export const PROVENANCE_TABLES: Readonly<Record<string, ProvenanceTable>> = {
    services: { price: 'price', legacyPriceStatus: true, kind: 'item' },
    menu_items: { price: 'price', legacyPriceStatus: false, kind: 'item' },
    products: { price: 'price', legacyPriceStatus: false, kind: 'item' },
    tour_packages: { price: 'price', legacyPriceStatus: false, kind: 'item' },
    properties: { price: 'night_price', legacyPriceStatus: false, kind: 'item' },
    real_estate_listings: { price: 'price', legacyPriceStatus: false, kind: 'item' },
    courses: { price: 'price', legacyPriceStatus: false, kind: 'item' },
    membership_plans: { price: 'price', legacyPriceStatus: true, kind: 'item' },
    insurance_plans: { price: 'monthly_premium_min', legacyPriceStatus: false, kind: 'item' },
    vehicles: { price: 'price_cents', legacyPriceStatus: false, kind: 'item' },
    faqs: { price: null, legacyPriceStatus: false, kind: 'text' },
    knowledge_documents: { price: null, legacyPriceStatus: false, kind: 'text' },
};

/** Procedencia efectiva de una fila de ítem o texto. `legacyRule` = null cuando es procedencia real. */
export interface RowProvenance {
    contentStatus: StoredStatus;
    origin: string;
    priceType: PriceType | null;
    priceStatus: 'confirmed' | 'example' | null;
    legacyRule: import('./types').LegacyRule | null;
}

/** Marca de tiempo de Postgres; sin zona = UTC (la base corre en UTC). */
export function toMs(s: unknown): number {
    if (s === null || s === undefined || s === '') return NaN;
    const t = String(s).replace(' ', 'T');
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
}

const sameInstant = (a: unknown, b: unknown): boolean => {
    const x = toMs(a);
    const y = toMs(b);
    return Number.isFinite(x) ? Number.isFinite(y) && Math.abs(x - y) < 1 : !Number.isFinite(y);
};

const asObject = (v: unknown): Row | null => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Row;
    if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } }
    return null;
};

const isStored = (v: unknown): v is StoredStatus => STORED_STATUSES.includes(v as StoredStatus);

/**
 * Procedencia real de una fila, o null si no la tiene o ya no vale (la fila cambió después de escribirse: la tocó un
 * editor que no conoce las columnas). El `content_status` solo no cuenta: su default de columna es `confirmed` y
 * lo tienen todas las filas viejas; lo que prueba la procedencia es `origin` + la estampa `row_updated_at`.
 */
export function realRowProvenance(table: string, row: Row): RowProvenance | null {
    const origin = typeof row.origin === 'string' && row.origin.trim() ? row.origin.trim() : null;
    if (!origin || !isStored(row.content_status)) return null;
    const ref = asObject(row.source_ref);
    if (!ref || !('row_updated_at' in ref) || !sameInstant(ref.row_updated_at, row.updated_at)) return null;
    const cfg = PROVENANCE_TABLES[table];
    if (!cfg || cfg.kind === 'text') return { contentStatus: row.content_status, origin, priceType: null, priceStatus: null, legacyRule: null };
    // `price_status = quote` (escrito por las pantallas de hoy en services y membership_plans) es «a cotizar, confirmado» (§2.2).
    const ps = typeof row.price_status === 'string' ? row.price_status : null;
    const priceType = PRICE_TYPES.includes(row.price_type) ? row.price_type as PriceType : ps === 'quote' ? 'a_cotizar' : null;
    const priceStatus = ps === 'example' ? 'example' : ps === 'confirmed' || ps === 'quote' || priceType ? 'confirmed' : null;
    return { contentStatus: row.content_status, origin, priceType, priceStatus, legacyRule: null };
}

// ─────────────────────────── requirement_values ───────────────────────────

/** `source_ref` de un valor que escribió la migración desde un almacenamiento de hoy (C0 §2.9). */
export interface MigratedSourceRef {
    backfill: string;
    migrated_from: string;
    migrated_hash: string;
    legacy_rule?: string | null;
    contradiction_with?: string[];
}

export const valueFingerprint = (value: unknown): string => sha256(canonicalJson(value ?? null));

export function migratedRef(v: ValueRecord): MigratedSourceRef | null {
    const ref = asObject(v.sourceRef);
    return ref && typeof ref.migrated_from === 'string' && typeof ref.migrated_hash === 'string' ? ref as MigratedSourceRef : null;
}

const iso = (s: unknown): string | null => (Number.isFinite(toMs(s)) ? new Date(toMs(s)).toISOString() : null);

/** Fila de `requirement_values` → ValueRecord (o null si la fila no es válida). */
export function valueRecordFromRow(row: Row): ValueRecord | null {
    if (!row || typeof row.requirement_id !== 'string' || !isStored(row.status) || typeof row.origin !== 'string') return null;
    return {
        value: row.value ?? null, status: row.status, origin: row.origin,
        confirmedBy: row.confirmed_by ?? null, confirmedAt: iso(row.confirmed_at), sourceRef: asObject(row.source_ref) ?? row.source_ref ?? null,
        validUntil: iso(row.valid_until), specVersion: row.spec_version ?? null,
        storage: 'requirement_values', scopeKey: String(row.scope_key ?? ''), legacyRule: null,
    };
}

/**
 * Mezcla las filas de `requirement_values` con los valores que dedujeron las reglas L (por requisito y alcance):
 * - fila escrita por `BusinessFactsService` (sin `migrated_from`): manda; los valores heredados de ese requisito y
 *   alcance dejan de leerse;
 * - fila migrada: reemplaza al valor heredado del que salió MIENTRAS ese almacenamiento conserve el valor migrado
 *   (misma huella). Si el almacenamiento de hoy cambió después de la migración (sus pantallas siguen vivas hasta R3b),
 *   la copia migrada quedó vieja: se ignora y manda la lectura con reglas L. Los demás valores heredados del mismo
 *   requisito siguen leyéndose, así que una contradicción entre dos almacenamientos sigue a la vista.
 */
export function applyRequirementValues(snap: TenantSnapshot, rows: readonly Row[] | undefined): { used: number; stale: number } {
    let used = 0;
    let stale = 0;
    const real = new Set<ValueRecord>();
    for (const row of rows ?? []) {
        const rec = valueRecordFromRow(row);
        if (!rec) continue;
        const id = String(row.requirement_id);
        const scope = rec.scopeKey ?? '';
        const current = snap.values[id] ?? [];
        const inScope = (r: ValueRecord) => (r.scopeKey ?? '') === scope && !real.has(r);
        const ref = migratedRef(rec);
        real.add(rec);
        if (!ref) {
            snap.values[id] = [...current.filter(r => !inScope(r)), rec];
            used++;
            continue;
        }
        const source = current.find(r => inScope(r) && r.storage === ref.migrated_from && valueFingerprint(r.value) === ref.migrated_hash);
        if (!source) { stale++; continue; }
        // el mensaje de una contradicción sigue nombrando el almacenamiento del que salió el valor
        rec.storage = ref.migrated_from;
        snap.values[id] = [...current.filter(r => r !== source), rec];
        used++;
    }
    return { used, stale };
}
