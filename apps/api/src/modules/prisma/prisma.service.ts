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

        // Use a transaction + SET LOCAL so search_path is guaranteed to be scoped
        // to this query lifecycle and cannot leak across pooled connections.
        return this.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
            return tx.$queryRawUnsafe(query, ...params) as Promise<T>;
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
}
