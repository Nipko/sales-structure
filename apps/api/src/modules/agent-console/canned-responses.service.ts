import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CannedResponse {
    id: string;
    shortcode: string;
    title: string;
    content: string;
    category: string;
}

@Injectable()
export class CannedResponsesService {
    private readonly logger = new Logger(CannedResponsesService.name);

    constructor(private prisma: PrismaService) { }

    async getAll(tenantId: string): Promise<CannedResponse[]> {
        const tenant = await this.prisma.$queryRaw<any[]>`
      SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `;
        if (!tenant || tenant.length === 0) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            tenant[0].schema_name,
            `SELECT id, shortcode, title, content, category FROM canned_responses ORDER BY category, shortcode`,
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            shortcode: r.shortcode,
            title: r.title,
            content: r.content,
            category: r.category || 'general',
        }));
    }

    async search(tenantId: string, query: string): Promise<CannedResponse[]> {
        const all = await this.getAll(tenantId);
        const q = query.toLowerCase().replace('/', '');
        return all.filter(
            r => r.shortcode.toLowerCase().includes(q) || r.title.toLowerCase().includes(q),
        );
    }

    async create(
        tenantId: string,
        data: { shortcode: string; title: string; content: string; category?: string },
    ): Promise<CannedResponse> {
        const tenant = await this.prisma.$queryRaw<any[]>`
      SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `;
        if (!tenant || tenant.length === 0) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(
            tenant[0].schema_name,
            `INSERT INTO canned_responses (tenant_id, shortcode, title, content, category, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, shortcode, title, content, category`,
            [tenantId, data.shortcode, data.title, data.content, data.category || 'general'],
        );

        return result[0];
    }

    async update(
        tenantId: string,
        id: string,
        data: { shortcode?: string; title?: string; content?: string; category?: string },
    ): Promise<void> {
        const tenant = await this.prisma.$queryRaw<any[]>`
      SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `;
        if (!tenant || tenant.length === 0) return;

        const sets: string[] = [];
        const params: any[] = [id];
        let i = 2;

        if (data.shortcode) { sets.push(`shortcode = $${i++}`); params.push(data.shortcode); }
        if (data.title) { sets.push(`title = $${i++}`); params.push(data.title); }
        if (data.content) { sets.push(`content = $${i++}`); params.push(data.content); }
        if (data.category) { sets.push(`category = $${i++}`); params.push(data.category); }

        if (sets.length === 0) return;

        await this.prisma.executeInTenantSchema(
            tenant[0].schema_name,
            `UPDATE canned_responses SET ${sets.join(', ')} WHERE id = $1`,
            params,
        );
    }

    /**
     * Replace variables in canned response content
     */
    interpolate(content: string, variables: Record<string, string>): string {
        return content.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] || match);
    }
}
