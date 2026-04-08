import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class ImportExportService {
    private readonly logger = new Logger(ImportExportService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }

    async importCSV(
        tenantId: string,
        csvContent: string,
        options?: { skipDuplicates?: boolean },
    ): Promise<{ imported: number; skipped: number; errors: string[] }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            return { imported: 0, skipped: 0, errors: ['CSV must have at least a header and one data row'] };
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const expectedColumns = ['first_name', 'last_name', 'phone', 'email', 'stage', 'source', 'company'];

        // Validate headers
        const missingHeaders = expectedColumns.filter(c => !headers.includes(c));
        if (missingHeaders.length > 0) {
            return { imported: 0, skipped: 0, errors: [`Missing columns: ${missingHeaders.join(', ')}`] };
        }

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const values = this.parseCSVLine(line);
                const row: Record<string, string> = {};
                headers.forEach((h, idx) => {
                    row[h] = (values[idx] || '').trim();
                });

                if (!row.phone && !row.email) {
                    errors.push(`Row ${i + 1}: phone or email required`);
                    skipped++;
                    continue;
                }

                const conflictClause = options?.skipDuplicates !== false
                    ? 'ON CONFLICT (phone) DO NOTHING'
                    : 'ON CONFLICT (phone) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email, stage = EXCLUDED.stage, source = EXCLUDED.source, company = EXCLUDED.company, updated_at = NOW()';

                const result = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `INSERT INTO leads (first_name, last_name, phone, email, stage, source, company)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ${conflictClause}
                     RETURNING id`,
                    [
                        row.first_name || null,
                        row.last_name || null,
                        row.phone || null,
                        row.email || null,
                        row.stage || 'nuevo',
                        row.source || 'csv_import',
                        row.company || null,
                    ],
                );

                if (result && result.length > 0) {
                    imported++;
                } else {
                    skipped++;
                }
            } catch (err: any) {
                errors.push(`Row ${i + 1}: ${err.message}`);
                skipped++;
            }
        }

        this.logger.log(`CSV import for tenant ${tenantId}: imported=${imported}, skipped=${skipped}, errors=${errors.length}`);
        return { imported, skipped, errors };
    }

    async exportCSV(tenantId: string, segmentId?: string): Promise<string> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        let rows: any[];

        if (segmentId) {
            // Fetch segment filter rules and apply them
            const segments = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT filter_rules FROM contact_segments WHERE id = $1::uuid`,
                [segmentId],
            );

            if (segments && segments.length > 0) {
                const rules = typeof segments[0].filter_rules === 'string'
                    ? JSON.parse(segments[0].filter_rules)
                    : segments[0].filter_rules;

                const { whereClause, params } = this.buildFilterSQL(rules);
                rows = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT first_name, last_name, phone, email, stage, score, created_at
                     FROM leads${whereClause ? ` WHERE ${whereClause}` : ''}
                     ORDER BY created_at DESC`,
                    params,
                );
            } else {
                rows = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT first_name, last_name, phone, email, stage, score, created_at
                     FROM leads ORDER BY created_at DESC`,
                );
            }
        } else {
            rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT first_name, last_name, phone, email, stage, score, created_at
                 FROM leads ORDER BY created_at DESC`,
            );
        }

        const headers = 'first_name,last_name,phone,email,stage,score,created_at';
        const csvLines = [headers];

        for (const row of (rows || [])) {
            csvLines.push([
                this.escapeCSV(row.first_name || ''),
                this.escapeCSV(row.last_name || ''),
                this.escapeCSV(row.phone || ''),
                this.escapeCSV(row.email || ''),
                this.escapeCSV(row.stage || ''),
                row.score !== null && row.score !== undefined ? Number(row.score) : '',
                row.created_at ? new Date(row.created_at).toISOString() : '',
            ].join(','));
        }

        return csvLines.join('\n');
    }

    getImportTemplate(): string {
        return 'first_name,last_name,phone,email,stage,source,company';
    }

    private parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    private escapeCSV(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private buildFilterSQL(rules: any[]): { whereClause: string; params: any[] } {
        if (!rules || rules.length === 0) {
            return { whereClause: '', params: [] };
        }

        const conditions: string[] = [];
        const params: any[] = [];
        let n = 1;

        for (const rule of rules) {
            const column = rule.field.startsWith('metadata.')
                ? `metadata->>'${rule.field.replace('metadata.', '')}'`
                : rule.field;

            switch (rule.operator) {
                case 'eq':
                    conditions.push(`${column} = $${n++}`);
                    params.push(rule.value);
                    break;
                case 'neq':
                    conditions.push(`${column} != $${n++}`);
                    params.push(rule.value);
                    break;
                case 'contains':
                    conditions.push(`${column} ILIKE $${n++}`);
                    params.push(`%${rule.value}%`);
                    break;
                case 'in':
                    if (Array.isArray(rule.value)) {
                        const placeholders = rule.value.map(() => `$${n++}`).join(', ');
                        conditions.push(`${column} IN (${placeholders})`);
                        params.push(...rule.value);
                    }
                    break;
                case 'gt': conditions.push(`${column} > $${n++}`); params.push(rule.value); break;
                case 'gte': conditions.push(`${column} >= $${n++}`); params.push(rule.value); break;
                case 'lt': conditions.push(`${column} < $${n++}`); params.push(rule.value); break;
                case 'lte': conditions.push(`${column} <= $${n++}`); params.push(rule.value); break;
            }
        }

        return { whereClause: conditions.join(' AND '), params };
    }
}
