import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { TenantThrottleService } from '../../../throttle/tenant-throttle.service';
import { normalizePhoneE164 } from '../../../../common/utils/phone.util';
import { PipelineService, resolveTenantNativeStage } from '../../../pipeline/pipeline.service';

@Injectable()
export class ImportExportService {
    private readonly logger = new Logger(ImportExportService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private throttle: TenantThrottleService,
        private pipelineService: PipelineService,
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
        const stageCatalog = await this.pipelineService.getTenantStageCatalog(tenantId, schema);

        // Plan contact cap — enforced incrementally so the bulk import can't
        // bypass the per-plan limit the way single-create (crm.controller) is gated.
        // -1 (unlimited) resolves to Infinity; archived_at is the lifecycle
        // contract. Stage slugs are vertical-specific and must never decide quota.
        const maxContacts = await this.throttle.getPlanLimit(tenantId, 'maxContacts');
        let liveContactCount = 0;
        if (Number.isFinite(maxContacts)) {
            const cnt = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS c FROM leads WHERE archived_at IS NULL`);
            liveContactCount = cnt?.[0]?.c || 0;
        }

        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            return { imported: 0, skipped: 0, errors: ['El archivo CSV debe contener al menos la cabecera y una fila de datos.'] };
        }

        // Auto-detect separator: comma (,) vs semicolon (;) based on count in header line
        const headerLine = lines[0];
        const commaCount = (headerLine.match(/,/g) || []).length;
        const semicolonCount = (headerLine.match(/;/g) || []).length;
        const separator = semicolonCount > commaCount ? ';' : ',';

        const rawHeaders = this.parseCSVLine(headerLine, separator).map(h => h.trim().toLowerCase());

        // Dictionary to map synonyms in Spanish/English to official DB columns
        const HEADER_MAPPING: Record<string, string> = {
            'first_name': 'first_name',
            'firstname': 'first_name',
            'nombre': 'first_name',
            'nombres': 'first_name',
            'first name': 'first_name',

            'last_name': 'last_name',
            'lastname': 'last_name',
            'apellido': 'last_name',
            'apellidos': 'last_name',
            'last name': 'last_name',

            'phone': 'phone',
            'telefono': 'phone',
            'teléfono': 'phone',
            'celular': 'phone',
            'movil': 'phone',
            'móvil': 'phone',
            'whatsapp': 'phone',

            'email': 'email',
            'correo': 'email',
            'correo_electronico': 'email',
            'correo electrónico': 'email',
            'mail': 'email',

            'stage': 'stage',
            'etapa': 'stage',
            'estado': 'stage',
            'fase': 'stage',

            'source': 'source',
            'origen': 'source',
            'fuente': 'source',

            'company': 'company',
            'empresa': 'company',
            'compañía': 'company',
            'compania': 'company',

            'is_vip': 'is_vip',
            'vip': 'is_vip',
            'es_vip': 'is_vip',
            'es vip': 'is_vip',

            'preferred_contact': 'preferred_contact',
            'preferred_channel': 'preferred_contact',
            'contacto_preferido': 'preferred_contact',
            'canal_preferido': 'preferred_contact',

            'utm_source': 'utm_source',
            'utm_medium': 'utm_medium',
            'utm_campaign': 'utm_campaign',
            'utm_content': 'utm_content',
        };

        const mappedHeaders = rawHeaders.map(h => HEADER_MAPPING[h] || h);
        const phoneIdx = mappedHeaders.indexOf('phone');

        // Phone column is strictly required
        if (phoneIdx === -1) {
            return {
                imported: 0,
                skipped: 0,
                errors: ['No se encontró la columna obligatoria de Teléfono (sinónimos permitidos: telefono, teléfono, celular, movil, phone).'],
            };
        }

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                const values = this.parseCSVLine(line, separator);
                const row: Record<string, string> = {};
                mappedHeaders.forEach((field, idx) => {
                    if (field) {
                        row[field] = (values[idx] || '').trim();
                    }
                });

                const rawPhone = row.phone;
                if (!rawPhone) {
                    errors.push(`Fila ${i + 1}: Teléfono requerido`);
                    skipped++;
                    continue;
                }

                // Phone Normalization using normalizePhoneE164
                const normalizedPhone = normalizePhoneE164(rawPhone);
                if (!normalizedPhone) {
                    errors.push(`Fila ${i + 1}: Teléfono inválido o formato no reconocido (${rawPhone})`);
                    skipped++;
                    continue;
                }

                // Resolve before any row-side effect (including company creation).
                // Empty means the first non-terminal tenant stage; unknown non-empty
                // labels are row errors rather than silently becoming a generic slug.
                let stage: string;
                try {
                    stage = resolveTenantNativeStage(stageCatalog, row.stage || undefined).slug;
                } catch (error: any) {
                    errors.push(`Fila ${i + 1}: Etapa inválida (${row.stage || '(vacía)'}): ${error.message}`);
                    skipped++;
                    continue;
                }

                // Company search or creation
                let companyId: string | null = null;
                const companyName = row.company ? row.company.trim() : '';
                if (companyName) {
                    const existingCompanies = await this.prisma.executeInTenantSchema<any[]>(
                        schema,
                        `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
                        [companyName],
                    );
                    if (existingCompanies && existingCompanies.length > 0) {
                        companyId = existingCompanies[0].id;
                    } else {
                        const newCompany = await this.prisma.executeInTenantSchema<any[]>(
                            schema,
                            `INSERT INTO companies (name, created_at, updated_at) VALUES ($1, NOW(), NOW()) RETURNING id`,
                            [companyName],
                        );
                        if (newCompany && newCompany.length > 0) {
                            companyId = newCompany[0].id;
                        }
                    }
                }

                // VIP parsing (flexible terms)
                const rawVip = (row.is_vip || '').toLowerCase().trim();
                const isVip = ['true', '1', 'yes', 'si', 'sí', 'verdadero', 'active', 'y'].includes(rawVip);

                // Preferred contact parsing
                const rawPreferred = (row.preferred_contact || '').toLowerCase().trim();
                let preferredContact = 'whatsapp';
                if (['email', 'correo', 'mail'].includes(rawPreferred)) {
                    preferredContact = 'email';
                } else if (['phone', 'telefono', 'teléfono', 'celular', 'llamada'].includes(rawPreferred)) {
                    preferredContact = 'phone';
                }

                // SELECT-then-INSERT/UPDATE pattern for deduplication based on phone_normalized
                const existingLeads = await this.prisma.executeInTenantSchema<any[]>(
                    schema,
                    `SELECT id, metadata FROM leads WHERE phone_normalized = $1 OR phone = $2 LIMIT 1`,
                    [normalizedPhone, normalizedPhone],
                );

                if (existingLeads && existingLeads.length > 0) {
                    if (options?.skipDuplicates) {
                        skipped++;
                        continue;
                    }

                    const leadId = existingLeads[0].id;
                    const currentMetadata = typeof existingLeads[0].metadata === 'string'
                        ? JSON.parse(existingLeads[0].metadata)
                        : existingLeads[0].metadata || {};

                    const updatedMetadata = {
                        ...currentMetadata,
                        source: row.source || currentMetadata.source || 'csv_import',
                        company: companyName || currentMetadata.company || null,
                    };

                    await this.pipelineService.writeLeadStage(
                        tenantId,
                        String(leadId),
                        stage,
                        { schemaName: schema, onlyActiveOpportunities: true },
                    );
                    await this.prisma.executeInTenantSchema(
                        schema,
                        `UPDATE leads
                         SET first_name = COALESCE($1, first_name),
                             last_name = COALESCE($2, last_name),
                             email = COALESCE($3, email),
                             stage = $4,
                             company_id = COALESCE($5, company_id),
                             is_vip = $6,
                             preferred_contact = $7,
                             utm_source = COALESCE($8, utm_source),
                             utm_medium = COALESCE($9, utm_medium),
                             utm_campaign = COALESCE($10, utm_campaign),
                             utm_content = COALESCE($11, utm_content),
                             metadata = $12::jsonb,
                             updated_at = NOW()
                         WHERE id = $13::uuid`,
                        [
                            row.first_name || null,
                            row.last_name || null,
                            row.email || null,
                            stage,
                            companyId,
                            isVip,
                            preferredContact,
                            row.utm_source || null,
                            row.utm_medium || null,
                            row.utm_campaign || null,
                            row.utm_content || null,
                            JSON.stringify(updatedMetadata),
                            leadId,
                        ],
                    );
                    imported++;
                } else {
                    if (Number.isFinite(maxContacts) && liveContactCount >= maxContacts) {
                        errors.push(`Fila ${i + 1}: se alcanzó el límite de contactos del plan (${maxContacts}). Actualizá tu plan para importar más.`);
                        skipped++;
                        continue;
                    }
                    const metadata = {
                        source: row.source || 'csv_import',
                        company: companyName || null,
                    };

                    await this.prisma.executeInTenantSchema(
                        schema,
                        `INSERT INTO leads (
                            first_name, last_name, phone, phone_normalized, email, stage,
                            company_id, is_vip, preferred_contact, utm_source, utm_medium, utm_campaign, utm_content,
                            metadata, created_at, updated_at
                         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW(), NOW())`,
                        [
                            row.first_name || null,
                            row.last_name || null,
                            normalizedPhone,
                            normalizedPhone,
                            row.email || null,
                            stage,
                            companyId,
                            isVip,
                            preferredContact,
                            row.utm_source || null,
                            row.utm_medium || null,
                            row.utm_campaign || null,
                            row.utm_content || null,
                            JSON.stringify(metadata),
                        ],
                    );
                    imported++;
                    liveContactCount++;
                }
            } catch (err: any) {
                errors.push(`Fila ${i + 1}: ${err.message}`);
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
        let whereClause = '';
        let params: any[] = [];

        if (segmentId) {
            const segments = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT filter_rules FROM contact_segments WHERE id = $1::uuid`,
                [segmentId],
            );

            if (segments && segments.length > 0) {
                const rules = typeof segments[0].filter_rules === 'string'
                    ? JSON.parse(segments[0].filter_rules)
                    : segments[0].filter_rules;

                const filter = this.buildFilterSQL(rules);
                whereClause = filter.whereClause;
                params = filter.params;
            }
        }

        // We use a CTE "filtered_leads" to apply filter_rules on leads first to avoid column ambiguity with companies
        const query = `
            WITH filtered_leads AS (
                SELECT * FROM leads
                ${whereClause ? ` WHERE ${whereClause}` : ''}
            )
            SELECT fl.first_name, fl.last_name, fl.phone, fl.phone_normalized, fl.email, fl.stage, fl.score, fl.is_vip, fl.preferred_contact,
                   fl.utm_source, fl.utm_medium, fl.utm_campaign, fl.created_at,
                   c.name AS company_name,
                   (
                       SELECT string_agg(t.name, ',')
                       FROM lead_tags lt
                       JOIN tags t ON lt.tag_id = t.id
                       WHERE lt.lead_id = fl.id
                   ) AS tags_list
            FROM filtered_leads fl
            LEFT JOIN companies c ON fl.company_id = c.id
            ORDER BY fl.created_at DESC
        `;

        rows = await this.prisma.executeInTenantSchema<any[]>(schema, query, params);

        const headers = 'first_name,last_name,phone,phone_normalized,email,stage,score,is_vip,preferred_contact,company,tags,utm_source,utm_medium,utm_campaign,created_at';
        const csvLines = [headers];

        for (const row of (rows || [])) {
            csvLines.push([
                this.escapeCSV(row.first_name || ''),
                this.escapeCSV(row.last_name || ''),
                this.escapeCSV(row.phone || ''),
                this.escapeCSV(row.phone_normalized || ''),
                this.escapeCSV(row.email || ''),
                this.escapeCSV(row.stage || ''),
                row.score !== null && row.score !== undefined ? Number(row.score) : '',
                row.is_vip ? 'verdadero' : 'falso',
                this.escapeCSV(row.preferred_contact || 'whatsapp'),
                this.escapeCSV(row.company_name || ''),
                this.escapeCSV(row.tags_list || ''),
                this.escapeCSV(row.utm_source || ''),
                this.escapeCSV(row.utm_medium || ''),
                this.escapeCSV(row.utm_campaign || ''),
                row.created_at ? new Date(row.created_at).toISOString() : '',
            ].join(','));
        }

        return csvLines.join('\n');
    }

    getImportTemplate(): string {
        return 'first_name,last_name,phone,email,stage,source,company,is_vip,preferred_contact,utm_source,utm_medium,utm_campaign';
    }

    private parseCSVLine(line: string, separator: string = ','): string[] {
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
            } else if (char === separator && !inQuotes) {
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
        if (typeof value !== 'string') return '';
        if (value.includes(',') || value.includes(';') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private static readonly ALLOWED_FILTER_FIELDS = new Set([
        'first_name', 'last_name', 'phone', 'email', 'stage', 'source',
        'score', 'assigned_to', 'is_vip', 'created_at', 'updated_at',
        'converted_at', 'archived_at', 'tags',
    ]);
    private static readonly METADATA_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

    private buildFilterSQL(rules: any[]): { whereClause: string; params: any[] } {
        if (!rules || rules.length === 0) {
            return { whereClause: '', params: [] };
        }

        const conditions: string[] = [];
        const params: any[] = [];
        let n = 1;

        for (const rule of rules) {
            let column: string;
            if (rule.field.startsWith('metadata.')) {
                const key = rule.field.replace('metadata.', '');
                if (!ImportExportService.METADATA_KEY_PATTERN.test(key)) continue;
                column = `metadata->>'${key}'`;
            } else {
                if (!ImportExportService.ALLOWED_FILTER_FIELDS.has(rule.field)) continue;
                column = rule.field;
            }

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
