import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
     * Create a new tenant schema from the SQL template
     */
    async createTenantSchema(schemaName: string): Promise<void> {
        this.validateSchemaName(schemaName);

        // 1. Check if schema already exists (stale data from deleted tenant)
        const existing = await this.$queryRawUnsafe(
            `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1 LIMIT 1`,
            schemaName,
        ) as any[];

        if (existing?.length > 0) {
            // Schema exists — clean stale data from previous tenant
            this.logger.warn(`[createTenantSchema] Schema "${schemaName}" already exists — cleaning stale data`);
            await this.cleanStaleSchemaData(schemaName);
        } else {
            await this.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
        }

        // 2. Read and execute the tenant schema template
        const fs = await import('fs');
        const path = await import('path');

        const possiblePaths = [
            path.join(process.cwd(), 'prisma', 'tenant-schema.sql'),
            path.join(process.cwd(), 'apps', 'api', 'prisma', 'tenant-schema.sql'),
            path.join(__dirname, '..', '..', 'prisma', 'tenant-schema.sql'),
            '/app/prisma/tenant-schema.sql', // Docker path
        ];

        let template: string | null = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                template = fs.readFileSync(p, 'utf-8');
                break;
            }
        }

        if (!template) {
            throw new Error(`tenant-schema.sql not found. Searched: ${possiblePaths.join(', ')}`);
        }

        // Replace placeholder
        template = template.replace(/\{\{SCHEMA_NAME\}\}/g, schemaName);

        // Execute each statement individually, skipping comments and empty lines.
        // Use a smarter split that handles dollar-quoted blocks (PL/pgSQL).
        const statements = this.splitSqlStatements(template);

        for (const statement of statements) {
            try {
                await this.$executeRawUnsafe(statement);
            } catch (e: any) {
                // Skip "already exists" errors (42P06, 42710, 42P07) for idempotency
                const code = e?.meta?.code || '';
                if (['42P06', '42710', '42P07'].includes(code)) continue;
                // Log but don't fail — partial schema is better than no schema
                console.warn(`[createTenantSchema] Non-fatal error in "${schemaName}": ${e.message}`);
            }
        }
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
     * Avoid deriving schema from UUID since schema names are slug-based.
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

    /**
     * Clean stale data from a reused tenant schema.
     * Called when a new tenant gets the same slug as a previously deleted one.
     * Truncates data tables but keeps the schema structure intact.
     */
    private async cleanStaleSchemaData(schemaName: string): Promise<void> {
        // Order matters: delete child tables before parent tables (FK constraints)
        const tablesToClean = [
            'property_bookings', 'ical_blocks', 'ical_feeds', 'properties',
            'campaign_recipients', 'campaign_logs',
            'messages', 'conversation_assignments',
            'conversations',
            'csat_surveys', 'analytics_events', 'daily_metrics',
            'automation_executions', 'wait_jobs',
            'notes', 'tasks', 'stage_history',
            'opportunities', 'lead_tags', 'custom_attribute_values',
            'leads', 'contacts', 'customer_profiles',
            'deals', 'stage_transitions',
            'agent_personas', 'persona_config',
            'faqs', 'knowledge_chunks', 'knowledge_resources', 'knowledge_approvals',
            'pipeline_stages', 'scoring_config',
            'services', 'service_staff', 'appointments', 'availability_slots', 'blocked_dates',
            'calendar_integrations',
            'companies',
            'tags', 'contact_segments',
            'whatsapp_channels', 'whatsapp_templates', 'whatsapp_webhook_events', 'whatsapp_message_logs',
            'consent_records', 'opt_out_records', 'deletion_requests', 'legal_text_versions',
            'orders', 'order_items', 'inventory_items', 'inventory_movements',
            'landing_pages', 'form_definitions', 'form_submissions', 'intake_sources',
            'commercial_offers', 'campaigns', 'campaign_courses', 'courses', 'products',
            'alert_rules', 'alert_history', 'scheduled_reports', 'dashboard_preferences',
        ];

        for (const table of tablesToClean) {
            try {
                await this.$executeRawUnsafe(`DELETE FROM "${schemaName}"."${table}"`);
            } catch {
                // Table may not exist in older schemas — skip silently
            }
        }

        this.logger.log(`[cleanStaleSchemaData] Cleaned ${tablesToClean.length} tables in "${schemaName}"`);
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
                lowerQuery.includes('error_message');

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

                // 1. Ensure pipelines table exists in this schema
                const hasPipelines = await (super.$queryRawUnsafe as any)(
                    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'pipelines' LIMIT 1`,
                    schemaName
                );
                
                if (!hasPipelines?.length) continue;

                // 2. Query opportunities that do NOT have open deals linked to their contact
                const opportunities = await (super.$queryRawUnsafe as any)(
                    `SELECT o.lead_id, o.stage, l.contact_id, l.first_name, l.last_name, l.phone
                     FROM "${schemaName}"."opportunities" o
                     JOIN "${schemaName}"."leads" l ON l.id = o.lead_id
                     WHERE l.contact_id IS NOT NULL 
                       AND l.contact_id NOT IN (SELECT contact_id FROM "${schemaName}"."deals" WHERE status = 'open')`
                );

                if (!opportunities?.length) continue;

                this.logger.log(`[Historical Sync] Found ${opportunities.length} opportunities needing deal sync in schema ${schemaName}`);

                // Get the primary default active pipeline ID
                const pipelines = await (super.$queryRawUnsafe as any)(
                    `SELECT id FROM "${schemaName}"."pipelines" WHERE is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1`
                );
                const pipelineId = pipelines?.[0]?.id;
                if (!pipelineId) continue;

                for (const opp of opportunities) {
                    let targetStageSlug = opp.stage;
                    if (opp.stage === 'listo_cierre') targetStageSlug = 'listo_para_cierre';
                    else if (opp.stage === 'listo_para_cierre') targetStageSlug = 'listo_cierre';

                    let stageRows = await (super.$queryRawUnsafe as any)(
                        `SELECT id, default_probability, sla_hours FROM "${schemaName}"."pipeline_stages" 
                         WHERE (slug = $1 OR slug = $2) AND tenant_id = $3::uuid LIMIT 1`,
                        opp.stage, targetStageSlug, tenantId
                    );

                    if (!stageRows?.length) {
                        stageRows = await (super.$queryRawUnsafe as any)(
                            `SELECT id, default_probability, sla_hours FROM "${schemaName}"."pipeline_stages" 
                             WHERE tenant_id = $1::uuid ORDER BY position ASC LIMIT 1`,
                            tenantId
                        );
                    }

                    const stage = stageRows?.[0];
                    if (!stage) continue;

                    const title = `${opp.first_name || ''} ${opp.last_name || ''}`.trim() || opp.phone || 'Interés Conversacional';
                    const probability = stage.default_probability || 0;
                    const slaDeadline = stage.sla_hours ? `NOW() + INTERVAL '${parseInt(stage.sla_hours)} hours'` : 'NULL';

                    // Insert retroactive deal
                    const dealRes = await (super.$queryRawUnsafe as any)(
                        `INSERT INTO "${schemaName}"."deals" 
                           (contact_id, title, value, stage_id, probability, status, sla_deadline, pipeline_id, created_at, updated_at, stage_entered_at)
                         VALUES 
                           ($1::uuid, $2, 0, $3::uuid, $4, 'open', ${slaDeadline}, $5::uuid, NOW(), NOW(), NOW())
                         RETURNING id`,
                        opp.contact_id, title, stage.id, probability, pipelineId
                    );

                    const dealId = dealRes?.[0]?.id;
                    if (dealId) {
                        await (super.$queryRawUnsafe as any)(
                            `INSERT INTO "${schemaName}"."stage_transitions" 
                               (deal_id, to_stage_id, actor, reason, created_at)
                             VALUES 
                               ($1::uuid, $2::uuid, 'system', 'Retroactive sync from opportunity', NOW())`,
                            dealId, stage.id
                        );
                    }
                }
            }
            this.logger.log('[Historical Sync] Retroactive Opportunity -> Deal synchronization completed successfully.');
        } catch (error: any) {
            this.logger.error(`[Historical Sync] Retroactive synchronization failed: ${error.message}`);
        }
    }
}
