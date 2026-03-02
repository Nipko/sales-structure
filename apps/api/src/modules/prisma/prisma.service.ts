import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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
        const result = await this.$queryRawUnsafe<T>(
            `SET search_path TO "${schemaName}"; ${query}`,
            ...params,
        );
        // Reset to public schema
        await this.$executeRawUnsafe('SET search_path TO "public"');
        return result;
    }

    /**
     * Create a new tenant schema from the SQL template
     */
    async createTenantSchema(schemaName: string): Promise<void> {
        const fs = await import('fs');
        const path = await import('path');

        const templatePath = path.join(__dirname, '..', '..', 'prisma', 'tenant-schema.sql');
        let template = fs.readFileSync(templatePath, 'utf-8');

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
        const tables = await this.$queryRawUnsafe<Array<{ table_name: string }>>(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
            schemaName,
        );
        return tables.map((t) => t.table_name);
    }
}
