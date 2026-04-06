import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class ContactsService {
    private readonly logger = new Logger(ContactsService.name);

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

    async listLeads(tenantId: string, params: {
        search?: string;
        stage?: string;
        assignedTo?: string;
        courseId?: string;
        isVip?: boolean;
        page?: number;
        limit?: number;
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const { search, stage, assignedTo, courseId, isVip, page = 1, limit = 25 } = params;
        const offset = (page - 1) * limit;

        let q = `SELECT l.*, c.name as company_name FROM leads l
                 LEFT JOIN companies c ON c.id = l.company_id
                 WHERE 1=1`;
        const p: any[] = [];
        let n = 1;

        if (search) {
            q += ` AND (l.first_name ILIKE $${n} OR l.last_name ILIKE $${n} OR l.phone ILIKE $${n} OR l.email ILIKE $${n})`;
            p.push(`%${search}%`);
            n++;
        }
        if (stage) { q += ` AND l.stage = $${n++}`; p.push(stage); }
        if (assignedTo) { q += ` AND l.assigned_to = $${n++}`; p.push(assignedTo); }
        if (courseId) { q += ` AND l.course_id = $${n++}`; p.push(courseId); }
        if (isVip !== undefined) { q += ` AND l.is_vip = $${n++}`; p.push(isVip); }

        q += ` ORDER BY l.score DESC, l.created_at DESC LIMIT $${n++} OFFSET $${n++}`;
        p.push(limit, offset);

        const [rows, total] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema, q, p),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as total FROM leads WHERE 1=1`,
                []
            ),
        ]);

        return {
            data: rows,
            total: parseInt(total[0]?.total || '0'),
            page,
            limit,
        };
    }

    /**
     * Full Lead 360 profile: lead + company + contact + opportunities + tags
     */
    async getLead360(tenantId: string, leadId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const [leads, opportunities, tags] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema, `
                SELECT l.*,
                    co.name as contact_name, co.avatar_url as contact_avatar,
                    c.name as company_name, c.industry as company_industry,
                    crs.name as course_name, crs.price as course_price,
                    cam.name as campaign_name
                FROM leads l
                LEFT JOIN contacts co ON co.id = l.contact_id
                LEFT JOIN companies c ON c.id = l.company_id
                LEFT JOIN courses crs ON crs.id = l.course_id
                LEFT JOIN campaigns cam ON cam.id = l.campaign_id
                WHERE l.id = $1::uuid LIMIT 1`,
                [leadId]
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT o.*, crs.name as course_name FROM opportunities o
                 LEFT JOIN courses crs ON crs.id = o.course_id
                 WHERE o.lead_id = $1::uuid ORDER BY o.created_at DESC`,
                [leadId]
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1::uuid`,
                [leadId]
            ),
        ]);

        if (!leads || leads.length === 0) throw new Error('Lead not found');
        return { lead: leads[0], opportunities, tags };
    }

    async updateLead(tenantId: string, leadId: string, data: Record<string, any>) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const allowedFields = ['first_name', 'last_name', 'email', 'stage', 'score', 'assigned_to', 'is_vip', 'preferred_contact'];
        const updates: string[] = [];
        const params: any[] = [leadId];
        let n = 2;

        for (const [key, val] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = $${n++}`);
                params.push(val);
            }
        }

        if (updates.length === 0) return;
        updates.push(`updated_at = NOW()`);

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE leads SET ${updates.join(', ')} WHERE id = $1::uuid`,
            params
        );
    }

    /**
     * Kanban Board: Opportunities grouped by pipeline stage
     * Replaces the old pipeline_stages/deals model with the real CRM commercial model
     */
    async getKanban(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { stages: [], forecast: { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 } };

        // Commercial pipeline stages (hardcoded per Parallly business rules)
        const STAGES = [
            { key: 'nuevo', name: 'Nuevo', color: '#95a5a6', position: 0, probability: 10 },
            { key: 'contactado', name: 'Contactado', color: '#3498db', position: 1, probability: 20 },
            { key: 'respondio', name: 'Respondió', color: '#9b59b6', position: 2, probability: 30 },
            { key: 'calificado', name: 'Calificado', color: '#e67e22', position: 3, probability: 50 },
            { key: 'tibio', name: 'Tibio', color: '#f39c12', position: 4, probability: 60 },
            { key: 'caliente', name: 'Caliente', color: '#e74c3c', position: 5, probability: 80 },
            { key: 'listo_cierre', name: 'Listo para cierre', color: '#27ae60', position: 6, probability: 95 },
            { key: 'ganado', name: 'Ganado', color: '#2ecc71', position: 7, probability: 100 },
            { key: 'perdido', name: 'Perdido', color: '#7f8c8d', position: 8, probability: 0 },
            { key: 'no_interesado', name: 'No interesado', color: '#bdc3c7', position: 9, probability: 0 },
        ];

        // Query all opportunities with lead info
        const opps = await this.prisma.executeInTenantSchema<any[]>(schema, `
            SELECT o.*, 
                   l.first_name, l.last_name, l.phone, l.email, l.score as lead_score,
                   crs.name as course_name, crs.price as course_price,
                   cam.name as campaign_name
            FROM opportunities o
            JOIN leads l ON l.id = o.lead_id
            LEFT JOIN courses crs ON crs.id = o.course_id
            LEFT JOIN campaigns cam ON cam.id = o.campaign_id
            WHERE o.lost_at IS NULL OR o.stage NOT IN ('perdido', 'no_interesado')
            ORDER BY o.updated_at DESC
        `, []);

        const allOpps = opps || [];

        const kanbanStages = STAGES.map(s => {
            const stageOpps = allOpps.filter((o: any) => o.stage === s.key);
            const totalValue = stageOpps.reduce((sum: number, o: any) => sum + parseFloat(o.estimated_value || 0), 0);

            return {
                id: s.key,
                name: s.name,
                color: s.color,
                position: s.position,
                dealCount: stageOpps.length,
                totalValue,
                deals: stageOpps.map((o: any) => {
                    const createdAt = o.created_at ? new Date(o.created_at) : new Date();
                    const daysInStage = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
                    return {
                        id: o.id,
                        title: o.course_name || o.campaign_name || 'Oportunidad',
                        contactName: `${o.first_name || ''} ${o.last_name || ''}`.trim() || 'Desconocido',
                        contactPhone: o.phone || '',
                        value: parseFloat(o.estimated_value || o.course_price || 0),
                        probability: s.probability,
                        daysInStage,
                        score: o.lead_score || 0,
                    };
                }),
            };
        });

        const totalValue = allOpps.reduce((sum: number, o: any) => sum + parseFloat(o.estimated_value || 0), 0);
        const count = allOpps.length;

        return {
            stages: kanbanStages,
            forecast: {
                total: totalValue,
                weighted: kanbanStages.reduce((sum, s) => 
                    sum + s.deals.reduce((ds, d) => ds + d.value * (d.probability / 100), 0), 0),
                dealCount: count,
                avgDealValue: count > 0 ? totalValue / count : 0,
            },
        };
    }

    /**
     * Move an opportunity to a new pipeline stage
     */
    async moveOpportunity(tenantId: string, opportunityId: string, newStage: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Get current stage for audit
        const current = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT stage, lead_id FROM opportunities WHERE id = $1::uuid LIMIT 1`,
            [opportunityId]
        );
        const oldStage = current?.[0]?.stage || 'unknown';
        const leadId = current?.[0]?.lead_id;

        // Update opportunity stage
        const wonFields = newStage === 'ganado' ? ', won_at = NOW()' : '';
        const lostFields = ['perdido', 'no_interesado'].includes(newStage) ? ', lost_at = NOW()' : '';

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE opportunities SET stage = $1, updated_at = NOW()${wonFields}${lostFields} WHERE id = $2::uuid`,
            [newStage, opportunityId]
        );

        // Also update lead stage to match
        if (leadId) {
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
                [newStage, leadId]
            );
        }

        // Record stage transition in history
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO stage_history (lead_id, opportunity_id, from_stage, to_stage, triggered_by)
             VALUES ($1, $2, $3, $4, 'agent')`,
            [leadId, opportunityId, oldStage, newStage]
        );

        this.logger.log(`Opportunity ${opportunityId} moved from ${oldStage} → ${newStage}`);
    }
}
