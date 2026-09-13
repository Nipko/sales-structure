import { revisionHash } from './evaluation-revision';

/**
 * Candidate input port, deliberately not installed in AgentTest or releases.
 * It proves the boundary for list_services only. Availability, readiness and
 * domain commands consume different predicates and cannot reuse its digest.
 * Do not use this partial capture to replace the full dependency manifest.
 */
export const SERVICE_CATALOG_CAPTURE_VERSION = 1 as const;
export const SERVICE_CATALOG_COLUMNS = [
    'id', 'name', 'description', 'duration_minutes', 'buffer_minutes', 'price', 'currency', 'is_active',
    'duration_type', 'duration_minutes_max', 'payment_policy', 'deposit_percent', 'deposit_amount',
    'location_type', 'location_address', 'meeting_link',
] as const;

export type CaptureQuery = (sql: string, params?: unknown[]) => Promise<any[]>;
export interface CaptureDatabase {
    /** The implementation must use one read-only REPEATABLE READ transaction. */
    readTransaction<T>(work: (query: CaptureQuery) => Promise<T>): Promise<T>;
}
/** Production-compatible leaf adapter; no service singleton or search_path mutation. */
export function serviceCatalogCaptureDatabase(prisma: {
    $transaction<T>(work: (tx: any) => Promise<T>, options: any): Promise<T>;
}): CaptureDatabase {
    return { readTransaction: work => prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return work((sql, params = []) => tx.$queryRawUnsafe(sql, ...params));
    }, { isolationLevel: 'RepeatableRead', timeout: 30_000 }) };
}
export interface ServiceCatalogCapture {
    version: 1;
    port: 'appointment_services.list';
    tenantId: string;
    sourceSchema: string;
    capturedAt: string;
    expiresAt: string;
    rows: ReadonlyArray<Record<string, unknown>>;
    structureHash: string;
    dependencyHash: string;
    integrityHash: string;
    /** An explicit guard against treating a one-port proof as a release certificate. */
    replacesGlobalManifest: false;
}

function schemaIdentifier(value: unknown): string {
    if (typeof value !== 'string' || !/^tenant_[a-z0-9_]+$/.test(value)
        || value.startsWith('tenant_eval_')) throw new Error('capture_source_schema_invalid');
    return `"${value}"`;
}
function tenantIdentifier(value: string): void {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
        throw new Error('capture_tenant_invalid');
}

async function readProjection(query: CaptureQuery, tenantId: string) {
    tenantIdentifier(tenantId);
    const owners = await query('SELECT schema_name FROM public.tenants WHERE id=$1::uuid', [tenantId]);
    if (owners.length !== 1) throw new Error('capture_tenant_unavailable');
    const schema = schemaIdentifier(owners[0].schema_name);
    const relation = await query(`SELECT c.relkind, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_expression
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname=$1 AND c.relname='services' ORDER BY a.attnum`, [owners[0].schema_name]);
    // Views/foreign relations may conceal live joins or external data. The
    // pilot accepts only the local base table used by the canonical reader.
    if (!relation.length || relation.some(row => !['r','p'].includes(row.relkind)))
        throw new Error('capture_catalog_relation_unsupported');
    for (const column of [...SERVICE_CATALOG_COLUMNS, 'is_public', 'sort_order']) {
        if (!relation.some(row => row.attname === column)) throw new Error('capture_catalog_schema_incomplete');
    }
    // Predicate membership and sort order are dependencies too: additions,
    // publication changes, deletion and reordering must invalidate the port.
    const rows = await query(`SELECT ${SERVICE_CATALOG_COLUMNS.join(', ')} FROM ${schema}.services
        WHERE is_active = true AND (is_public IS NULL OR is_public = true) ORDER BY sort_order, name`);
    const structureHash = revisionHash(relation);
    const dependencyHash = revisionHash({ structureHash, rows });
    return { sourceSchema: owners[0].schema_name as string, rows, structureHash, dependencyHash };
}

export async function captureServiceCatalog(database: CaptureDatabase, tenantId: string,
    ttlMs = 30 * 60_000): Promise<ServiceCatalogCapture> {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60_000) throw new Error('capture_ttl_invalid');
    return database.readTransaction(async query => {
        const projection = await readProjection(query, tenantId);
        const clock = await query('SELECT transaction_timestamp()::text AS captured_at');
        const capturedAt = new Date(clock[0]?.captured_at).toISOString();
        const body = { version: SERVICE_CATALOG_CAPTURE_VERSION, port: 'appointment_services.list' as const,
            tenantId, ...projection, capturedAt, expiresAt: new Date(Date.parse(capturedAt) + ttlMs).toISOString(),
            replacesGlobalManifest: false as const };
        return { ...body, integrityHash: revisionHash(body) };
    });
}

function assertCapture(capture: ServiceCatalogCapture, tenantId: string): void {
    if (!capture || capture.version !== 1 || capture.port !== 'appointment_services.list'
        || capture.replacesGlobalManifest !== false || capture.tenantId !== tenantId)
        throw new Error('capture_scope_mismatch');
    tenantIdentifier(tenantId);
    schemaIdentifier(capture.sourceSchema);
    const { integrityHash, ...body } = capture;
    if (revisionHash(body) !== integrityHash) throw new Error('capture_integrity_mismatch');
    if (!Number.isFinite(Date.parse(capture.expiresAt)) || Date.now() >= Date.parse(capture.expiresAt))
        throw new Error('capture_expired');
}

export async function assertServiceCatalogCurrent(database: CaptureDatabase, capture: ServiceCatalogCapture,
    tenantId: string): Promise<void> {
    assertCapture(capture, tenantId);
    const current = await database.readTransaction(query => readProjection(query, tenantId));
    if (current.sourceSchema !== capture.sourceSchema || current.dependencyHash !== capture.dependencyHash)
        throw new Error('capture_catalog_changed');
}

/**
 * A future session adapter can consume these rows through the real list_services
 * mapping. There is no live fallback. The fence must check source erasure,
 * tenant/release authority, plan/connection/configuration, and this dependency
 * before each use and remain held through the consumer (including a model
 * call that exposes the data). A check on another connection that ends before
 * consumption cannot provide that guarantee.
 */
export async function withCapturedServiceCatalog<T>(capture: ServiceCatalogCapture, tenantId: string,
    withLiveAuthority: <R>(consume: () => Promise<R>) => Promise<R>,
    consume: (rows: ReadonlyArray<Record<string, unknown>>) => Promise<T>): Promise<T> {
    assertCapture(capture, tenantId);
    if (typeof withLiveAuthority !== 'function' || typeof consume !== 'function') throw new Error('capture_live_guard_required');
    return withLiveAuthority(async () => {
        assertCapture(capture, tenantId);
        return consume(structuredClone(capture.rows));
    });
}
