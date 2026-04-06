import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Opportunity } from '../interfaces/opportunity.interface';

@Injectable()
export class OpportunitiesRepository {
  private readonly logger = new Logger(OpportunitiesRepository.name);

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

  async getOpportunities(tenantId: string, stage?: string): Promise<Opportunity[]> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return [];

    if (stage) {
      return this.prisma.executeInTenantSchema<Opportunity[]>(
        schema,
        `SELECT * FROM opportunities WHERE stage = $1 ORDER BY updated_at DESC`,
        [stage]
      );
    }
    return this.prisma.executeInTenantSchema<Opportunity[]>(
      schema,
      `SELECT * FROM opportunities ORDER BY created_at DESC`,
      []
    );
  }

  async getOpportunityById(tenantId: string, id: string): Promise<Opportunity | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const results = await this.prisma.executeInTenantSchema<Opportunity[]>(
      schema,
      `SELECT * FROM opportunities WHERE id = $1::uuid`,
      [id]
    );
    return results && results.length > 0 ? results[0] : null;
  }

  async createOpportunity(tenantId: string, data: Partial<Opportunity>): Promise<Opportunity | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const record = data as Record<string, any>;
    const fields = Object.keys(record).filter(k => record[k] !== undefined);
    const values = fields.map(k => record[k]);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

    const results = await this.prisma.executeInTenantSchema<Opportunity[]>(
      schema,
      `INSERT INTO opportunities (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return results && results.length > 0 ? results[0] : null;
  }

  async updateOpportunity(tenantId: string, id: string, data: Partial<Opportunity>): Promise<Opportunity | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const record = data as Record<string, any>;
    const fields = Object.keys(record).filter(k => record[k] !== undefined);
    if (fields.length === 0) return this.getOpportunityById(tenantId, id);

    const setClause = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [id, ...fields.map(k => record[k])];

    const results = await this.prisma.executeInTenantSchema<Opportunity[]>(
      schema,
      `UPDATE opportunities SET ${setClause}, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
      values
    );
    return results && results.length > 0 ? results[0] : null;
  }

  async recordStageHistory(tenantId: string, data: { lead_id: string, opportunity_id: string, from_stage?: string, to_stage: string, reason?: string, triggered_by?: string, agent_id?: string }) {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return;

    await this.prisma.executeInTenantSchema(
      schema,
      `INSERT INTO stage_history (lead_id, opportunity_id, from_stage, to_stage, reason, triggered_by, agent_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
      [data.lead_id, data.opportunity_id, data.from_stage || null, data.to_stage, data.reason || null, data.triggered_by || 'system', data.agent_id || null]
    );
  }

  async getKanban(tenantId: string) {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) return { stages: [], forecast: { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 } };

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

  async moveOpportunity(tenantId: string, opportunityId: string, newStage: string) {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) throw new Error('Tenant not found');

      const current = await this.prisma.executeInTenantSchema<any[]>(schema,
          `SELECT stage, lead_id FROM opportunities WHERE id = $1::uuid LIMIT 1`,
          [opportunityId]
      );
      
      const currentArray = current as any[];
      const oldStage = currentArray?.[0]?.stage || 'unknown';
      const leadId = currentArray?.[0]?.lead_id;

      const wonFields = newStage === 'ganado' ? ', won_at = NOW()' : '';
      const lostFields = ['perdido', 'no_interesado'].includes(newStage) ? ', lost_at = NOW()' : '';

      await this.prisma.executeInTenantSchema(schema,
          `UPDATE opportunities SET stage = $1, updated_at = NOW()${wonFields}${lostFields} WHERE id = $2::uuid`,
          [newStage, opportunityId]
      );

      if (leadId) {
          await this.prisma.executeInTenantSchema(schema,
              `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
              [newStage, leadId]
          );
      }

      await this.recordStageHistory(tenantId, {
          lead_id: leadId,
          opportunity_id: opportunityId,
          from_stage: oldStage,
          to_stage: newStage,
          triggered_by: 'agent'
      });

      this.logger.log(`Opportunity ${opportunityId} moved from ${oldStage} → ${newStage}`);
  }
}
