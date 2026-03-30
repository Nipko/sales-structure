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
        });
    }

    /**
     * Create a new tenant schema from the SQL template
     */
    async createTenantSchema(schemaName: string): Promise<void> {
        const fs = await import('fs');
        const path = await import('path');

        // Try multiple possible locations for the SQL template
        const possiblePaths = [
            path.join(process.cwd(), 'prisma', 'tenant-schema.sql'),
            path.join(process.cwd(), 'apps', 'api', 'prisma', 'tenant-schema.sql'),
            path.join(__dirname, '..', '..', 'prisma', 'tenant-schema.sql'),
        ];

        let template: string | null = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                template = fs.readFileSync(p, 'utf-8');
                break;
            }
        }

        if (!template) {
            throw new Error(
                `tenant-schema.sql not found. Searched: ${possiblePaths.join(', ')}`,
            );
        }

        // Replace placeholder with actual schema name
        template = template.replace(/\{\{SCHEMA_NAME\}\}/g, schemaName);

        // Execute the SQL statements
        const statements = template
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            await this.$executeRawUnsafe(statement + ';');
        }
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
