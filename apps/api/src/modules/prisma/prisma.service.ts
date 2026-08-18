import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolveMirroredDealStatus } from '../pipeline/pipeline-outcome.util';
import { ensurePrimaryPipeline } from '../../common/utils/primary-pipeline.util';

const TENANT_PUBLIC_PURGE_ORDER = [
    'push_subscriptions', 'feature_request_subscribers', 'feature_request_comments',
    'feature_request_votes', 'feature_requests', 'webhook_subscriptions',
    'email_channel_configs', 'widget_sessions', 'widget_configs', 'billing_events',
    'billing_payments', 'billing_coupon_redemptions',
    // Recurring engine. Attempts and ledger hang off billing_subscriptions, so
    // they are deleted before it; payment sources only reference the tenant.
    'billing_charge_attempts', 'billing_credit_ledger', 'billing_payment_sources',
    'billing_subscriptions',
    // Tenant-owned customer payment credentials. These are encrypted provider
    // secrets (Wompi private/events keys, MercadoPago access tokens): the purge
    // must remove them, never retain them like fiscal records.
    'tenant_payment_provider_configs',
    'tenant_invitations', 'channel_accounts', 'whatsapp_onboardings',
    'whatsapp_credentials', 'tenant_financial_snapshots', 'storage_snapshots',
    'sms_package_orders', 'sms_credit_ledger', 'sms_credit_balances',
    'crm_connections', 'api_keys', 'audit_logs', 'users',
] as const;

const TENANT_PUBLIC_PURGE_CLASSIFIED = new Set<string>([
    ...TENANT_PUBLIC_PURGE_ORDER.filter((table) => table !== 'feature_request_subscribers'),
    'fiscal_invoices',
]);

const NATIVE_EVIDENCE_TABLES = [
    'appointments',
    'tour_bookings',
    'property_bookings',
    'service_requests',
    'food_orders',
    'photo_sessions',
    'resource_rentals',
    'orders',
] as const;

type NativeEvidenceTable = (typeof NATIVE_EVIDENCE_TABLES)[number];
type TenantQueryExecutor = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        super({
            log: process.env.NODE_ENV === 'development'
                ? ['query', 'info', 'warn', 'error']
                : ['error'],
        });
    }

    async onModuleInit() {
        const maxRetries = 5;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.$connect();
                this.logger.log('Database connection established');
                
                // Widen critical columns system-wide at startup
                await this.ensureVarcharColumnsWiden().catch((err) => {
                    this.logger.error(`Column widening failed (non-blocking): ${err.message}`);
                });

                // Existing tenant schemas predate exact native-evidence
                // ownership. Migrate them without inventing contact-only
                // backfills; unresolved historical rows deliberately stay NULL.
                //
                // No-bloqueante a propósito: el DDL toma ACCESS EXCLUSIVE sobre 8
                // tablas calientes por schema y corre en CADA arranque. Durante el
                // restart rolling el worker sigue escribiendo, así que un
                // lock_timeout (55P03) en UN solo tenant es plausible — y sin este
                // catch ese fallo cae en el retry de conexión, agota los 5 intentos
                // y deja al contenedor del API en crash-loop para TODOS los tenants.
                // El resolver de aplicación ya es fail-closed, el trigger es defensa
                // en profundidad: se reintenta en el próximo arranque.
                await this.ensureNativeEvidenceOpportunityOwnership().catch((err) => {
                    this.logger.error(`Native evidence ownership migration failed (non-blocking): ${err.message}`);
                });

                // Retroactively sync historical opportunities to deals
                await this.syncHistoricalOpportunitiesToDeals().catch((err) => {
                    this.logger.error(`Historical opportunity sync failed (non-blocking): ${err.message}`);
                });
                return;
            } catch (err: any) {
                this.logger.warn(`Database connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
                if (attempt === maxRetries) throw err;
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    /**
     * Validate that a schema name is safe for use in SQL.
     * Prevents SQL injection via malicious schema names.
     */
    private validateSchemaName(schemaName: string): void {
        if (!schemaName || schemaName.length > 63) {
            throw new BadRequestException(
                `Invalid schema name: must be between 1 and 63 characters (PostgreSQL identifier limit)`,
            );
        }
        if (!/^tenant_[a-z0-9_]+$/.test(schemaName)) {
            throw new BadRequestException(
                `Invalid schema name "${schemaName}": must match pattern tenant_[a-z0-9_]+`,
            );
        }
    }

    /**
     * Execute a query in a specific tenant schema
     */
    async executeInTenantSchema<T>(schemaName: string, query: string, params: any[] = [], options?: { timeout?: number }): Promise<T> {
        this.validateSchemaName(schemaName);

        const sanitizedParams = this.sanitizeParams(query, params);

        // Use a transaction + SET LOCAL so search_path is guaranteed to be scoped
        // to this query lifecycle and cannot leak across pooled connections.
        return this.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
            return tx.$queryRawUnsafe(query, ...sanitizedParams) as Promise<T>;
        }, { timeout: options?.timeout ?? 15000 });
    }

    /**
     * Execute a multi-statement business mutation on one tenant connection/transaction.
     * The callback receives the same parameter-sanitized query primitive used by
     * executeInTenantSchema, but every call shares one SET LOCAL search_path and commit.
     */
    async transactionInTenantSchema<T>(
        schemaName: string,
        callback: (query: <R = any[]>(sql: string, params?: any[]) => Promise<R>) => Promise<T>,
        options?: { timeout?: number },
    ): Promise<T> {
        this.validateSchemaName(schemaName);
        return this.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
            const query = async <R = any[]>(sql: string, params: any[] = []): Promise<R> => {
                const sanitizedParams = this.sanitizeParams(sql, params);
                return tx.$queryRawUnsafe(sql, ...sanitizedParams) as Promise<R>;
            };
            return callback(query);
        }, { timeout: options?.timeout ?? 15000 });
    }

    /**
     * Create a new tenant schema from the SQL template.
     *
     * Callers initially persist a readable slug-based placeholder (tenant_acme).
     * Before any DDL runs, this method replaces it with a physical schema name
     * suffixed by the tenant UUID. A future tenant may reuse the human slug, but
     * can never be pointed at the previous tenant's physical schema.
     */
    async createTenantSchema(requestedSchemaName: string): Promise<string> {
        this.validateSchemaName(requestedSchemaName);

        const tenant = await this.tenant.findUnique({
            where: { schemaName: requestedSchemaName },
            select: { id: true, schemaName: true },
        });
        if (!tenant) {
            throw new NotFoundException(
                `Cannot provision schema "${requestedSchemaName}": no tenant owns that schema name`,
            );
        }

        const schemaName = this.buildUniqueTenantSchemaName(requestedSchemaName, tenant.id);
        this.validateSchemaName(schemaName);
        const schemaAlreadyExists = await this.schemaExists(schemaName);

        // Existing physical schemas are safe only for an idempotent retry by the
        // same tenant. Never bind a newly-created placeholder to an orphan schema.
        if (schemaAlreadyExists && tenant.schemaName !== schemaName) {
            throw new ConflictException(
                `Refusing to reuse existing tenant schema "${schemaName}"`,
            );
        }

        if (tenant.schemaName !== schemaName) {
            await this.tenant.update({
                where: { id: tenant.id },
                data: { schemaName },
            });
        }

        if (!schemaAlreadyExists) {
            await this.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}";`);
        }

        const template = await this.loadTenantSchemaTemplate();

        // Replace placeholder
        const renderedTemplate = template.replace(/\{\{SCHEMA_NAME\}\}/g, schemaName);

        // Execute each statement individually, skipping comments and empty lines.
        // Use a smarter split that handles dollar-quoted blocks (PL/pgSQL).
        const statements = this.splitSqlStatements(renderedTemplate);

        const unexpectedErrors: Array<{ statement: string; error: unknown }> = [];
        for (const statement of statements) {
            try {
                await this.$executeRawUnsafe(statement);
            } catch (e: any) {
                // Skip "already exists" errors (42P06, 42710, 42P07) for idempotency
                const code = e?.meta?.code || '';
                if (['42P06', '42710', '42P07'].includes(code)) continue;
                // Keep running the remaining independent statements so a retry has
                // less work to repair, but never report a partial schema as ready.
                // The caller persists provisioning=failed and a subsequent retry
                // replays this idempotent template against the same physical schema.
                unexpectedErrors.push({ statement, error: e });
                console.error(`[createTenantSchema] Statement failed in "${schemaName}": ${e?.message || e}`);
            }
        }

        if (unexpectedErrors.length > 0) {
            const first = unexpectedErrors[0];
            const firstMessage = first.error instanceof Error
                ? first.error.message
                : String(first.error);
            throw new Error(
                `Tenant schema "${schemaName}" is incomplete: ${unexpectedErrors.length} statement(s) failed. First error: ${firstMessage}`,
            );
        }

        return schemaName;
    }

    private buildUniqueTenantSchemaName(requestedSchemaName: string, tenantId: string): string {
        const tenantSuffix = tenantId.replace(/-/g, '').toLowerCase();
        if (!/^[a-f0-9]{32}$/.test(tenantSuffix)) {
            throw new BadRequestException(`Invalid tenant ID for schema allocation`);
        }
        if (requestedSchemaName.endsWith(`_${tenantSuffix}`)) return requestedSchemaName;

        const maxBaseLength = 63 - tenantSuffix.length - 1;
        const base = requestedSchemaName.slice(0, maxBaseLength).replace(/_+$/, '');
        return `${base}_${tenantSuffix}`;
    }

    private async schemaExists(schemaName: string): Promise<boolean> {
        const rows = await this.$queryRawUnsafe(
            `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1 LIMIT 1`,
            schemaName,
        ) as any[];
        return rows?.length > 0;
    }

    private async loadTenantSchemaTemplate(): Promise<string> {
        const fs = await import('fs');
        const path = await import('path');
        const possiblePaths = [
            path.join(process.cwd(), 'prisma', 'tenant-schema.sql'),
            path.join(process.cwd(), 'apps', 'api', 'prisma', 'tenant-schema.sql'),
            path.join(__dirname, '..', '..', 'prisma', 'tenant-schema.sql'),
            '/app/prisma/tenant-schema.sql', // Docker path
        ];

        for (const candidate of possiblePaths) {
            if (fs.existsSync(candidate)) {
                return fs.readFileSync(candidate, 'utf-8');
            }
        }

        throw new Error(`tenant-schema.sql not found. Searched: ${possiblePaths.join(', ')}`);
    }

    /**
     * Split SQL into individual statements, respecting dollar-quoted blocks
     * and skipping comments. Returns statements WITH trailing semicolons.
     */
    private splitSqlStatements(sql: string): string[] {
        const results: string[] = [];
        let current = '';
        let inDollarQuote = false;
        let dollarTag = '';

        const lines = sql.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('--')) continue;

            // Check for dollar quoting ($$, $tag$)
            const dollarMatches = line.match(/\$[^$]*\$/g) || [];
            for (const dm of dollarMatches) {
                if (!inDollarQuote) {
                    inDollarQuote = true;
                    dollarTag = dm;
                } else if (dm === dollarTag) {
                    inDollarQuote = false;
                    dollarTag = '';
                }
            }

            current += line + '\n';

            // Only split on semicolons outside dollar-quoted blocks
            if (!inDollarQuote && trimmed.endsWith(';')) {
                const stmt = current.trim();
                if (stmt.length > 1) results.push(stmt);
                current = '';
            }
        }

        // Catch any remaining
        const remaining = current.trim();
        if (remaining.length > 1) {
            results.push(remaining.endsWith(';') ? remaining : remaining + ';');
        }

        return results;
    }

    /**
     * Drop a tenant schema (use with extreme caution!)
     */
    async dropTenantSchema(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);
        await this.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
        if (await this.schemaExists(schemaName)) {
            throw new Error(`Tenant schema "${schemaName}" still exists after DROP SCHEMA`);
        }
    }

    /**
     * Read-only purge preflight. It intentionally repeats inside the later
     * transaction: this early pass prevents DROP/provider effects when a new
     * tenant-owned public table has not yet been assigned a purge policy.
     */
    async preflightTenantPublicPurge(): Promise<void> {
        const rows = await this.$queryRawUnsafe(
            `SELECT table_name
               FROM information_schema.columns
              WHERE table_schema = 'public'
                AND column_name = 'tenant_id'
              ORDER BY table_name`,
        ) as Array<{ table_name: string }>;
        const unclassified = rows
            .map((row) => row.table_name)
            .filter((table) => !TENANT_PUBLIC_PURGE_CLASSIFIED.has(table));
        if (unclassified.length > 0) {
            throw new ConflictException({
                error: 'tenant_purge_unclassified_public_data',
                tables: unclassified,
            });
        }

        const featureTables = await this.$queryRawUnsafe(
            `SELECT
                to_regclass('public.feature_request_subscribers')::text AS subscribers,
                to_regclass('public.feature_requests')::text AS requests`,
        ) as Array<{ subscribers: string | null; requests: string | null }>;
        if (Boolean(featureTables[0]?.subscribers) !== Boolean(featureTables[0]?.requests)) {
            throw new ConflictException({ error: 'tenant_purge_incomplete_feature_request_schema' });
        }
    }

    /**
     * Delete every public-schema row owned by a tenant in one transaction.
     *
     * The tenant row is deliberately deleted last: its unique slug and
     * schema_name remain the identity barrier until every classified global
     * table has been purged.  Any statement failure (including the final tenant
     * delete) rolls the complete public purge back, making the operation safe
     * to retry after the tenant schema has already been dropped.
     *
     * Fiscal invoices are the sole classified retention exception.  Colombian
     * fiscal records remain in place and receive an immutable tenant snapshot
     * before payment rows are removed.
     */
    async purgeTenantPublicDataAtomic(
        tenantId: string,
        tenantSnapshot: { name: string; schemaName: string },
    ): Promise<Record<string, number>> {
        const purgeOrder = TENANT_PUBLIC_PURGE_ORDER;

        return this.$transaction(async (tx: any) => {
            // Serializes the final retention stamp/delete with fiscal document
            // creation, whose transaction takes a shared lock on this row.
            await tx.$queryRawUnsafe(
                `SELECT id FROM public.tenants WHERE id = $1::uuid FOR UPDATE`,
                tenantId,
            );
            const rows = await tx.$queryRawUnsafe(
                `SELECT table_name
                   FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND column_name = 'tenant_id'
                  ORDER BY table_name`,
            ) as Array<{ table_name: string }>;
            const observed = new Set(rows.map((row) => row.table_name));
            const unclassified = [...observed].filter((table) => !TENANT_PUBLIC_PURGE_CLASSIFIED.has(table));
            if (unclassified.length > 0) {
                throw new ConflictException({
                    error: 'tenant_purge_unclassified_public_data',
                    tables: unclassified,
                });
            }

            const deleted: Record<string, number> = {};
            const deleteByTenantId = async (table: string): Promise<void> => {
                if (!observed.has(table)) {
                    deleted[table] = 0;
                    return;
                }
                // `table` only comes from the constant allowlist above.  The
                // tenant value remains parameterized and UUID validated by PG.
                deleted[table] = await tx.$executeRawUnsafe(
                    `DELETE FROM public."${table}" WHERE tenant_id::text = $1::uuid::text`,
                    tenantId,
                );
            };

            // Retention barrier: if this stamp fails, no public row is deleted.
            if (observed.has('fiscal_invoices')) {
                deleted.fiscal_invoices_retained = await tx.$executeRawUnsafe(
                    `UPDATE public.fiscal_invoices
                        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                            'tenantPurgedAt', NOW()::text,
                            'tenantNameSnapshot', $2::text,
                            'tenantSchemaSnapshot', $3::text
                        )
                      WHERE tenant_id::text = $1::uuid::text`,
                    tenantId,
                    tenantSnapshot.name,
                    tenantSnapshot.schemaName,
                );
            } else {
                deleted.fiscal_invoices_retained = 0;
            }

            // This table has no tenant_id column.  Remove subscriptions owned by
            // tenant users and subscriptions to requests authored by the tenant.
            const featureTables = await tx.$queryRawUnsafe(
                `SELECT
                    to_regclass('public.feature_request_subscribers')::text AS subscribers,
                    to_regclass('public.feature_requests')::text AS requests`,
            ) as Array<{ subscribers: string | null; requests: string | null }>;
            const hasFeatureSubscribers = Boolean(featureTables[0]?.subscribers);
            const hasFeatureRequests = Boolean(featureTables[0]?.requests);
            if (hasFeatureSubscribers !== hasFeatureRequests) {
                throw new ConflictException({
                    error: 'tenant_purge_incomplete_feature_request_schema',
                });
            }
            if (hasFeatureSubscribers && hasFeatureRequests) {
                deleted.feature_request_subscribers = await tx.$executeRawUnsafe(
                    `DELETE FROM public.feature_request_subscribers
                      WHERE user_id IN (
                                SELECT id FROM public.users
                                 WHERE tenant_id::text = $1::uuid::text
                            )
                         OR request_id IN (
                                SELECT id FROM public.feature_requests
                                 WHERE author_tenant_id::text = $1::uuid::text
                            )`,
                    tenantId,
                );
            } else {
                deleted.feature_request_subscribers = 0;
            }

            for (const table of purgeOrder) {
                if (table === 'feature_request_subscribers') continue;
                if (table === 'billing_events' && observed.has(table)) {
                    deleted.billing_events = await tx.$executeRawUnsafe(
                        `DELETE FROM public.billing_events
                          WHERE tenant_id::text = $1::uuid::text
                             OR subscription_id IN (
                                    SELECT id FROM public.billing_subscriptions
                                     WHERE tenant_id::text = $1::uuid::text
                                )`,
                        tenantId,
                    );
                    continue;
                }
                if (table === 'feature_request_comments' && observed.has(table)) {
                    deleted.feature_request_comments = await tx.$executeRawUnsafe(
                        `DELETE FROM public.feature_request_comments
                          WHERE tenant_id::text = $1::uuid::text
                             OR user_id IN (
                                    SELECT id FROM public.users
                                     WHERE tenant_id::text = $1::uuid::text
                                )`,
                        tenantId,
                    );
                    continue;
                }
                if (table === 'feature_request_votes' && observed.has(table)) {
                    deleted.feature_request_votes = await tx.$executeRawUnsafe(
                        `DELETE FROM public.feature_request_votes
                          WHERE tenant_id::text = $1::uuid::text
                             OR user_id IN (
                                    SELECT id FROM public.users
                                     WHERE tenant_id::text = $1::uuid::text
                                )`,
                        tenantId,
                    );
                    continue;
                }
                if (table === 'feature_requests' && hasFeatureRequests) {
                    deleted.feature_requests = await tx.$executeRawUnsafe(
                        `DELETE FROM public.feature_requests
                          WHERE author_tenant_id::text = $1::uuid::text
                             OR author_user_id IN (
                                    SELECT id FROM public.users
                                     WHERE tenant_id::text = $1::uuid::text
                                )`,
                        tenantId,
                    );
                    continue;
                }
                if (table === 'audit_logs' && observed.has(table)) {
                    // audit_logs.user_id is TEXT while users.id is UUID, so the
                    // subquery is cast, not the column: user_id is free text and
                    // may hold a non-UUID actor, which ::uuid would blow up on.
                    deleted.audit_logs = await tx.$executeRawUnsafe(
                        `DELETE FROM public.audit_logs
                          WHERE tenant_id::text = $1::uuid::text
                             OR user_id IN (
                                    SELECT id::text FROM public.users
                                     WHERE tenant_id::text = $1::uuid::text
                                )`,
                        tenantId,
                    );
                    continue;
                }
                await deleteByTenantId(table);
            }

            await tx.tenant.delete({ where: { id: tenantId } });
            deleted.tenants = 1;
            return deleted;
        }, { maxWait: 10_000, timeout: 30_000 });
    }

    /**
     * Backup a tenant schema using pg_dump format
     */
    async getTenantTableList(schemaName: string): Promise<string[]> {
        const tables = await this.$queryRawUnsafe(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
            schemaName,
        ) as Array<{ table_name: string }>;
        return tables.map((t: any) => t.table_name);
    }

    /**
     * Resolve canonical tenant schema name from the public tenants table.
     * Never derive it at request time: new physical names include the tenant
     * UUID and legacy tenants may still use the older slug-only convention.
     */
    async getTenantSchemaName(tenantId: string): Promise<string> {
        const tenant = await this.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });

        if (!tenant) {
            throw new NotFoundException(`Tenant ${tenantId} not found`);
        }

        return tenant.schemaName;
    }

    $queryRawUnsafe<T = any>(query: string, ...values: any[]): any {
        const sanitized = this.sanitizeParams(query, values);
        return (super.$queryRawUnsafe as any)(query, ...sanitized);
    }

    $executeRawUnsafe(query: string, ...values: any[]): any {
        const sanitized = this.sanitizeParams(query, values);
        return (super.$executeRawUnsafe as any)(query, ...sanitized);
    }

    /**
     * Widen URL and tracking columns to TEXT for all existing tenant schemas.
     * Runs once at startup, completely non-blocking and idempotent.
     */
    private async ensureVarcharColumnsWiden(): Promise<void> {
        try {
            const schemas = await (super.$queryRawUnsafe as any)(
                `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'`
            );

            if (!schemas || schemas.length === 0) {
                this.logger.log('[Schema Migration] No tenant schemas found to migrate.');
                return;
            }

            this.logger.log(`[Schema Migration] Checking/migrating ${schemas.length} tenant schemas for column widening...`);

            for (const schema of schemas) {
                const schemaName = schema.schema_name;
                
                const alterStatements = [
                    `ALTER TABLE "${schemaName}"."contacts" ALTER COLUMN "avatar_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."messages" ALTER COLUMN "media_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."knowledge_documents" ALTER COLUMN "file_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."knowledge_resources" ALTER COLUMN "source_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."courses" ALTER COLUMN "brochure_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."companies" ALTER COLUMN "website" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."leads" ALTER COLUMN "referrer_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."leads" ALTER COLUMN "gclid" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."leads" ALTER COLUMN "fbclid" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."consent_records" ALTER COLUMN "origin_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."whatsapp_channels" ALTER COLUMN "webhook_callback_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."form_submissions" ALTER COLUMN "source_url" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."form_submissions" ALTER COLUMN "referrer" TYPE TEXT;`,
                    `ALTER TABLE "${schemaName}"."pipeline_stages" ADD COLUMN IF NOT EXISTS "transition_rules" JSONB DEFAULT '[]'::jsonb;`
                ];

                for (const sql of alterStatements) {
                    try {
                        await (super.$executeRawUnsafe as any)(sql);
                    } catch (e: any) {
                        // Suppress error for tables or columns that don't exist in older or custom tenant schemas
                    }
                }
            }
            this.logger.log('[Schema Migration] Completed column widening migration for all schemas successfully.');
        } catch (error: any) {
            this.logger.error(`[Schema Migration] Column widening failed: ${error.message}`);
        }
    }

    /**
     * Add exact opportunity ownership to all native operational evidence tables.
     * Each tenant is migrated atomically under an advisory lock. A tenant with a
     * custom/missing optional table simply migrates the tables it actually has.
     */
    private async ensureNativeEvidenceOwnershipWithQuery(
        query: TenantQueryExecutor,
        schemaName: string,
        tables: readonly NativeEvidenceTable[],
    ): Promise<void> {
        for (const table of tables) {
            await query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS opportunity_id UUID`);
            const fkName = `${table}_opportunity_id_fkey`;
            const constraint = await query<Array<{ exists: boolean }>>(
                `SELECT EXISTS (
                    SELECT 1
                      FROM pg_constraint constraint_ref
                      JOIN pg_class table_ref ON table_ref.oid = constraint_ref.conrelid
                      JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
                     WHERE schema_ref.nspname = $1
                       AND table_ref.relname = $2
                       AND constraint_ref.conname = $3
                       AND constraint_ref.contype = 'f'
                ) AS exists`,
                [schemaName, table, fkName],
            );
            if (!constraint?.[0]?.exists) {
                await query(
                    `ALTER TABLE "${table}"
                     ADD CONSTRAINT "${fkName}"
                     FOREIGN KEY (opportunity_id)
                     REFERENCES opportunities(id) ON DELETE RESTRICT NOT VALID`,
                );
            }
            await query(
                `CREATE INDEX IF NOT EXISTS "idx_${table}_opportunity_id"
                 ON "${table}" (opportunity_id)
                 WHERE opportunity_id IS NOT NULL`,
            );
        }

        await query(`
            CREATE OR REPLACE FUNCTION "${schemaName}"."validate_native_evidence_opportunity"()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            SET search_path = "${schemaName}", public
            AS $native_evidence_opportunity_guard$
            BEGIN
                IF TG_OP = 'UPDATE'
                   AND OLD.opportunity_id IS NOT NULL
                   AND NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
                    RAISE EXCEPTION 'native evidence opportunity ownership is immutable'
                        USING ERRCODE = '23514',
                              CONSTRAINT = 'native_evidence_opportunity_immutable';
                END IF;
                IF NEW.opportunity_id IS NULL THEN
                    RETURN NEW;
                END IF;
                -- contact_id es FK ON DELETE SET NULL: borrar un contacto dispara
                -- un UPDATE real sobre esta tabla y por lo tanto este trigger. Sin
                -- esta excepción se rompen el borrado de contacto, la purga de
                -- tenant y el borrado GDPR. Solo se permite ese desprendimiento.
                IF TG_OP = 'UPDATE'
                   AND NEW.contact_id IS NULL
                   AND OLD.contact_id IS NOT NULL
                   AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
                    RETURN NEW;
                END IF;
                IF NEW.contact_id IS NULL OR NOT EXISTS (
                    SELECT 1
                     FROM "${schemaName}"."opportunities" opportunity_ref
                      JOIN "${schemaName}"."leads" lead_ref
                        ON lead_ref.id = opportunity_ref.lead_id
                     WHERE opportunity_ref.id = NEW.opportunity_id
                       AND (
                            lead_ref.contact_id = NEW.contact_id
                            OR EXISTS (
                                SELECT 1
                                  FROM "${schemaName}"."contact_identities" evidence_identity
                                  JOIN "${schemaName}"."contact_identities" lead_identity
                                    ON lead_identity.customer_profile_id = evidence_identity.customer_profile_id
                                 WHERE evidence_identity.contact_id = NEW.contact_id
                                   AND lead_identity.contact_id = lead_ref.contact_id
                            )
                       )
                ) THEN
                    RAISE EXCEPTION 'native evidence opportunity does not belong to contact'
                        USING ERRCODE = '23514',
                              CONSTRAINT = 'native_evidence_opportunity_contact_check';
                END IF;
                RETURN NEW;
            END
            $native_evidence_opportunity_guard$`);

        for (const table of tables) {
            const triggerName = `${table}_opportunity_owner_guard`;
            const trigger = await query<Array<{ exists: boolean }>>(
                `SELECT EXISTS (
                    SELECT 1
                      FROM pg_trigger trigger_ref
                      JOIN pg_class table_ref ON table_ref.oid = trigger_ref.tgrelid
                      JOIN pg_namespace schema_ref ON schema_ref.oid = table_ref.relnamespace
                     WHERE schema_ref.nspname = $1
                       AND table_ref.relname = $2
                       AND trigger_ref.tgname = $3
                       AND NOT trigger_ref.tgisinternal
                ) AS exists`,
                [schemaName, table, triggerName],
            );
            if (!trigger?.[0]?.exists) {
                await query(
                    `CREATE TRIGGER "${triggerName}"
                     BEFORE INSERT OR UPDATE OF opportunity_id, contact_id ON "${table}"
                     FOR EACH ROW EXECUTE FUNCTION "${schemaName}"."validate_native_evidence_opportunity"()`,
                );
            }
        }
    }

    /**
     * Install exact native-evidence ownership for a table created lazily after
     * startup. The cache owner must only mark itself ready after this resolves.
     */
    async ensureNativeEvidenceOpportunityOwnershipForTable(
        schemaName: string,
        table: NativeEvidenceTable,
    ): Promise<void> {
        this.validateSchemaName(schemaName);
        if (!(NATIVE_EVIDENCE_TABLES as readonly string[]).includes(table)) {
            throw new BadRequestException(`Unsupported native evidence table: ${table}`);
        }
        await this.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`,
                [`native-evidence-opportunity:${schemaName}`],
            );
            await query(`SELECT set_config('lock_timeout', '5s', true) AS lock_timeout`);
            const tableRows = await query<Array<{ exists: boolean }>>(
                `SELECT EXISTS (
                    SELECT 1
                      FROM information_schema.tables
                     WHERE table_schema = $1
                       AND table_name = $2
                ) AS exists`,
                [schemaName, table],
            );
            if (!tableRows?.[0]?.exists) {
                throw new Error(`Native evidence table ${schemaName}.${table} does not exist`);
            }
            await this.ensureNativeEvidenceOwnershipWithQuery(query, schemaName, [table]);
        }, { timeout: 60_000 });
    }

    private async ensureNativeEvidenceOpportunityOwnership(): Promise<void> {
        const schemas = await (super.$queryRawUnsafe as any)(
            `SELECT schema_name
               FROM information_schema.schemata
              WHERE schema_name LIKE 'tenant_%'
              ORDER BY schema_name`,
        ) as Array<{ schema_name: string }>;

        const failures: string[] = [];
        for (const schemaRow of schemas || []) {
            const schemaName = schemaRow.schema_name;
            try {
                this.validateSchemaName(schemaName);
                await this.transactionInTenantSchema(schemaName, async (query) => {
                    await query(
                        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`,
                        [`native-evidence-opportunity:${schemaName}`],
                    );
                    await query(`SELECT set_config('lock_timeout', '5s', true) AS lock_timeout`);

                    const presentRows = await query<Array<{ table_name: string }>>(
                        `SELECT table_name
                           FROM information_schema.tables
                          WHERE table_schema = $1
                            AND table_name = ANY($2::text[])`,
                        [schemaName, [...NATIVE_EVIDENCE_TABLES]],
                    );
                    const present = new Set((presentRows || []).map((row) => row.table_name));

                    await this.ensureNativeEvidenceOwnershipWithQuery(
                        query,
                        schemaName,
                        NATIVE_EVIDENCE_TABLES.filter((table) => present.has(table)),
                    );
                }, { timeout: 60_000 });
            } catch (error: any) {
                this.logger.error(
                    `[Schema Migration] Native evidence ownership failed for ${schemaName}: ${error.message}`,
                );
                failures.push(`${schemaName}: ${error.message}`);
            }
        }
        if (failures.length > 0) {
            throw new Error(
                `Native evidence ownership migration failed for ${failures.length} tenant schema(s): ${failures.join('; ')}`,
            );
        }
    }

    /**
     * Defensive raw SQL parameter sanitization. Prevents Postgres VARCHAR length errors (22001)
     * by safely truncating strings that would exceed column bounds, while preserving TEXT and JSONB fields.
     */
    private sanitizeParams(query: string, params: any[]): any[] {
        if (!params || params.length === 0) return params;

        return params.map((p) => {
            if (typeof p !== 'string') return p;

            if (p.length <= 255) return p;

            const lowerQuery = query.toLowerCase();
            const isKnownLongField = 
                lowerQuery.includes('content_text') ||
                lowerQuery.includes('description') ||
                lowerQuery.includes('summary') ||
                lowerQuery.includes('metadata') ||
                lowerQuery.includes('config_json') ||
                lowerQuery.includes('config_yaml') ||
                lowerQuery.includes('content') ||
                lowerQuery.includes('key_facts') ||
                lowerQuery.includes('request_payload_json') ||
                lowerQuery.includes('response_payload_json') ||
                lowerQuery.includes('payload_json') ||
                lowerQuery.includes('error_message') ||
                lowerQuery.includes('results') ||
                lowerQuery.includes('json') ||
                // pgvector literals ('[0.1,0.2,...]') are ~20-25k chars; never truncate
                // them or the `::vector` cast throws "invalid input syntax".
                lowerQuery.includes('embedding') ||
                lowerQuery.includes('vector');

            if (isKnownLongField) {
                return p;
            }

            if (p.startsWith('http://') || p.startsWith('https://')) {
                if (p.length > 2048) {
                    this.logger.warn(`[Param Sanitizer] Truncating extremely long URL parameter from ${p.length} to 2048 chars`);
                    return p.substring(0, 2048);
                }
                return p;
            }

            if (p.length > 500) {
                this.logger.warn(`[Param Sanitizer] Truncating long string parameter from ${p.length} to 500 chars to prevent SQL error 22001`);
                return p.substring(0, 500);
            }

            return p;
        });
    }

    /**
     * Retroactively synchronize all historical opportunities to deals for active schemas
     */
    private async syncHistoricalOpportunitiesToDeals(): Promise<void> {
        try {
            const schemas = await (super.$queryRawUnsafe as any)(
                `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'`
            );

            if (!schemas || schemas.length === 0) return;

            this.logger.log(`[Historical Sync] Checking ${schemas.length} tenant schemas for retroactive Opportunity -> Deal sync...`);

            for (const schema of schemas) {
                const schemaName = schema.schema_name;
                const tenantIdRows = await (super.$queryRawUnsafe as any)(
                    `SELECT id FROM tenants WHERE schema_name = $1 LIMIT 1`,
                    schemaName
                );
                const tenantId = tenantIdRows?.[0]?.id;
                if (!tenantId) continue;
                try {

                // 1. Ensure the multi-pipeline contract exists. Older schemas used
                // to be skipped entirely here, so they never received outcome/link
                // hardening or historical synchronization.
                const hasPipelines = await (super.$queryRawUnsafe as any)(
                    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'pipelines' LIMIT 1`,
                    schemaName
                );
                if (!hasPipelines?.length) {
                    await this.transactionInTenantSchema(schemaName, async (query) => {
                        await query(`CREATE TABLE IF NOT EXISTS pipelines (
                            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                            tenant_id UUID NOT NULL,
                            name VARCHAR(255) NOT NULL,
                            description TEXT,
                            is_default BOOLEAN DEFAULT false,
                            is_active BOOLEAN DEFAULT true,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            updated_at TIMESTAMPTZ DEFAULT NOW()
                        )`);
                        await query(`CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON pipelines(tenant_id, is_active)`);
                        await query(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipelines_default_per_tenant
                                     ON pipelines(tenant_id) WHERE is_default = true`);
                        await query(`ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID`);
                        await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id UUID`);
                    });
                }
                // CREATE TABLE IF NOT EXISTS does not repair a pre-existing
                // pipelines table that missed this constraint. Multiple
                // defaults are ambiguous tenant data, so index creation is
                // intentionally fail-closed for that schema.
                await (super.$executeRawUnsafe as any)(
                    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipelines_default_per_tenant
                     ON "${schemaName}"."pipelines" (tenant_id) WHERE is_default = true`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."pipeline_stages" ADD COLUMN IF NOT EXISTS pipeline_id UUID`
                );
                // Ownership reconciliation compares these fields.  Historical
                // schemas may predate the explicit outcome/rules columns, so
                // establish that contract before invoking the reconciler or a
                // missing column would make this schema permanently skip the
                // later ALTER statements on every startup.
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."pipeline_stages"
                     ADD COLUMN IF NOT EXISTS terminal_outcome VARCHAR(10)`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."pipeline_stages"
                     ADD COLUMN IF NOT EXISTS transition_rules JSONB DEFAULT '[]'::jsonb`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."deals" ADD COLUMN IF NOT EXISTS pipeline_id UUID`
                );
                const pipelineResolution = await this.transactionInTenantSchema(
                    schemaName,
                    (query) => ensurePrimaryPipeline(query, tenantId),
                );
                const pipelineId = pipelineResolution.pipelineId;
                if (pipelineResolution.repairedDuplicateStages > 0) {
                    this.logger.warn(
                        `[Historical Sync] Repaired ${pipelineResolution.repairedDuplicateStages} ` +
                        `duplicate pipeline stage(s) in ${schemaName}`,
                    );
                }
                // Bootstrap and the legacy CRM use ON CONFLICT(pipeline_id,
                // slug).  Historical schemas that never received the full
                // template must gain the same conflict target after ownership
                // reconciliation has removed safe duplicates.
                await (super.$executeRawUnsafe as any)(
                    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipeline_stages_pipeline_slug
                     ON "${schemaName}"."pipeline_stages" (pipeline_id, slug) NULLS NOT DISTINCT`
                );

                // Older tenant schemas predate the explicit outcome/link columns. Add
                // the contract, but never manufacture a terminal outcome from probability.
                await (super.$executeRawUnsafe as any)(
                    `UPDATE "${schemaName}"."pipeline_stages"
                        SET terminal_outcome = NULL
                      WHERE COALESCE(is_terminal, false) = false
                        AND terminal_outcome IS NOT NULL`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."pipeline_stages"
                     DROP CONSTRAINT IF EXISTS pipeline_stages_terminal_outcome_check`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."pipeline_stages"
                     ADD CONSTRAINT pipeline_stages_terminal_outcome_check CHECK (
                         (COALESCE(is_terminal, false) = false AND terminal_outcome IS NULL)
                         OR (is_terminal = true AND terminal_outcome IN ('won', 'lost'))
                     ) NOT VALID`
                );
                await (super.$executeRawUnsafe as any)(
                    `ALTER TABLE "${schemaName}"."opportunities"
                     ADD COLUMN IF NOT EXISTS deal_id UUID
                     REFERENCES "${schemaName}"."deals"(id) ON DELETE SET NULL`
                );
                await (super.$executeRawUnsafe as any)(
                    `CREATE INDEX IF NOT EXISTS idx_opportunities_deal_id
                     ON "${schemaName}"."opportunities"(deal_id)`
                );
                const duplicateDealLinks = await (super.$queryRawUnsafe as any)(
                    `SELECT deal_id, COUNT(*)::int AS opportunity_count
                       FROM "${schemaName}"."opportunities"
                      WHERE deal_id IS NOT NULL
                      GROUP BY deal_id
                     HAVING COUNT(*) > 1
                      LIMIT 1`
                );
                if (duplicateDealLinks?.length) {
                    this.logger.error(
                        `[Historical Sync] ${schemaName} has ${duplicateDealLinks[0].opportunity_count} ` +
                        `opportunities linked to deal ${duplicateDealLinks[0].deal_id}; manual repair required`,
                    );
                } else {
                    await (super.$executeRawUnsafe as any)(
                        `CREATE UNIQUE INDEX IF NOT EXISTS uidx_opportunities_deal_id
                         ON "${schemaName}"."opportunities"(deal_id)
                         WHERE deal_id IS NOT NULL`
                    );
                }

                // 2. Repair the historical Deal mirror from the canonical stage outcome.
                // Opportunities and Deals feed different dashboards; allowing an explicit
                // terminal stage to keep status='open' makes those dashboards disagree.
                await (super.$queryRawUnsafe as any)(
                    `UPDATE "${schemaName}"."deals" d
                        SET status = CASE
                            WHEN ps.terminal_outcome = 'won' THEN 'won'
                            WHEN ps.terminal_outcome = 'lost' THEN 'lost'
                            ELSE 'open'
                        END,
                            updated_at = NOW()
                       FROM "${schemaName}"."pipeline_stages" ps
                      WHERE d.stage_id = ps.id
                        AND (COALESCE(ps.is_terminal, false) = false
                             OR ps.terminal_outcome IN ('won', 'lost'))
                        AND d.status IS DISTINCT FROM CASE
                            WHEN ps.terminal_outcome = 'won' THEN 'won'
                            WHEN ps.terminal_outcome = 'lost' THEN 'lost'
                            ELSE 'open'
                        END`
                );

                // 3. Every Opportunity owns its exact Deal mirror through deal_id. A
                // contact may have multiple opportunities, so contact-level de-duplication
                // is deliberately forbidden here.
                const opportunities = await (super.$queryRawUnsafe as any)(
                    `SELECT o.id AS opportunity_id
                     FROM "${schemaName}"."opportunities" o
                     JOIN "${schemaName}"."leads" l ON l.id = o.lead_id
                     WHERE l.contact_id IS NOT NULL
                       AND o.deal_id IS NULL
                     ORDER BY o.updated_at ASC`
                );

                if (!opportunities?.length) continue;

                this.logger.log(`[Historical Sync] Found ${opportunities.length} opportunities needing deal sync in schema ${schemaName}`);

                for (const opp of opportunities) {
                    try {
                        await this.transactionInTenantSchema(schemaName, async (query) => {
                            const locked = await query<any[]>(
                                `SELECT o.id, o.lead_id, o.stage, o.won_at, o.lost_at,
                                        l.contact_id, l.first_name, l.last_name, l.phone
                                   FROM opportunities o
                                   JOIN leads l ON l.id = o.lead_id
                                  WHERE o.id = $1::uuid AND o.deal_id IS NULL
                                  FOR UPDATE OF o`,
                                [opp.opportunity_id],
                            );
                            const exact = locked?.[0];
                            if (!exact) return;

                            // One-way compatibility only: persisted writes use the
                            // canonical listo_para_cierre slug, never listo_cierre.
                            const targetStageSlug = exact.stage === 'listo_cierre'
                                ? 'listo_para_cierre'
                                : exact.stage;
                            const stageRows = await query<any[]>(
                                `SELECT id, slug, default_probability, sla_hours,
                                        is_terminal, terminal_outcome
                                   FROM pipeline_stages
                                  WHERE slug = $1 AND tenant_id = $2::uuid
                                    AND (pipeline_id = $3::uuid OR pipeline_id IS NULL)
                                  ORDER BY (pipeline_id = $3::uuid) DESC, position ASC
                                  LIMIT 1`,
                                [targetStageSlug, tenantId, pipelineId],
                            );
                            const stage = stageRows?.[0];
                            if (!stage) {
                                throw new Error(`No canonical stage "${targetStageSlug}" for opportunity ${exact.id}`);
                            }
                            const status = resolveMirroredDealStatus(stage, exact);
                            const title = `${exact.first_name || ''} ${exact.last_name || ''}`.trim()
                                || exact.phone
                                || 'Interés Conversacional';
                            const dealRes = await query<any[]>(
                                `INSERT INTO deals
                                    (contact_id, title, value, stage_id, probability, status,
                                     sla_deadline, pipeline_id, created_at, updated_at, stage_entered_at)
                                 VALUES
                                    ($1::uuid, $2, 0, $3::uuid, $4, $5,
                                     CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + ($6::int * INTERVAL '1 hour') END,
                                     $7::uuid, NOW(), NOW(), NOW())
                                 RETURNING id`,
                                [
                                    exact.contact_id,
                                    title,
                                    stage.id,
                                    Number(stage.default_probability || 0),
                                    status,
                                    stage.sla_hours ?? null,
                                    pipelineId,
                                ],
                            );
                            const dealId = dealRes?.[0]?.id;
                            if (!dealId) throw new Error(`Deal mirror creation failed for opportunity ${exact.id}`);
                            const linked = await query<any[]>(
                                `UPDATE opportunities
                                    SET deal_id = $1::uuid, stage = $2, updated_at = NOW()
                                  WHERE id = $3::uuid AND deal_id IS NULL
                                  RETURNING id`,
                                [dealId, stage.slug, exact.id],
                            );
                            if (!linked?.length) throw new Error(`Opportunity ${exact.id} was linked concurrently`);
                            if (exact.stage !== stage.slug) {
                                await query(
                                    `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
                                    [stage.slug, exact.lead_id],
                                );
                                await query(
                                    `INSERT INTO stage_history
                                        (lead_id, opportunity_id, from_stage, to_stage, reason, triggered_by)
                                     VALUES ($1::uuid, $2::uuid, $3, $4,
                                             'Canonicalized during retroactive deal sync', 'historical_sync')`,
                                    [exact.lead_id, exact.id, exact.stage, stage.slug],
                                );
                            }
                            await query(
                                `INSERT INTO stage_transitions
                                    (deal_id, from_stage, to_stage, changed_by, reason, created_at)
                                 VALUES ($1::uuid, NULL, $2, 'system',
                                         'Retroactive sync from exact opportunity', NOW())`,
                                [dealId, stage.id],
                            );
                        });
                    } catch (error: any) {
                        this.logger.warn(`[Historical Sync] Skipped opportunity ${opp.opportunity_id}: ${error.message}`);
                    }
                }
                } catch (schemaError: any) {
                    // One damaged tenant must not prevent startup repair for every
                    // schema that follows it. Ownership conflicts are fail-closed
                    // inside their transaction and are reported for manual review.
                    this.logger.error(
                        `[Historical Sync] Skipped schema ${schemaName}: ${schemaError.message}`,
                    );
                }
            }
            this.logger.log('[Historical Sync] Retroactive Opportunity -> Deal synchronization completed successfully.');
        } catch (error: any) {
            this.logger.error(`[Historical Sync] Retroactive synchronization failed: ${error.message}`);
        }
    }
}
