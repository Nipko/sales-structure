import { Injectable, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        super({
            log: process.env.NODE_ENV === 'development'
                ? ['query', 'info', 'warn', 'error']
                : ['error'],
        });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    /**
     * Execute a query in a specific tenant schema
     */
    async executeInTenantSchema<T>(schemaName: string, query: string, params: any[] = []): Promise<T> {
        if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
            throw new Error(`Invalid schema name: ${schemaName}`);
        }

        // Use a transaction + SET LOCAL so search_path is guaranteed to be scoped
        // to this query lifecycle and cannot leak across pooled connections.
        return this.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}"`);
            return tx.$queryRawUnsafe(query, ...params) as Promise<T>;
        }, { timeout: 15000 });
    }

    /**
     * Create a new tenant schema from the SQL template
     */
    async createTenantSchema(schemaName: string): Promise<void> {
        // 1. Always create the schema first (separate call, guaranteed to run)
        await this.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);

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
}
