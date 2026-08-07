import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Opportunity } from '../interfaces/opportunity.interface';
import { PipelineService } from '../../pipeline/pipeline.service';

@Injectable()
export class OpportunitiesRepository {
  private readonly logger = new Logger(OpportunitiesRepository.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
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

    // Map friendly inputs to the REAL opportunities schema. This table is
    // lead-centric: it has `estimated_value` (not `value`) and no `title`/`notes`
    // columns — those live on `deals`. Fold title/notes into `metadata` so a
    // manually-created opportunity still renders on the board (getKanban reads
    // metadata.title). Inserting non-existent columns previously failed the INSERT.
    const d = { ...(data as Record<string, any>) };
    if (d.lead_id == null && (d.leadId ?? d.contactId) != null) d.lead_id = d.leadId ?? d.contactId;
    if (d.estimated_value == null && d.value != null) d.estimated_value = d.value;
    if (!d.lead_id) return null;

    const canonicalStage = await this.pipelineService.resolveTenantStage(tenantId, d.stage, { schemaName: schema });
    d.stage = canonicalStage.slug;
    if (canonicalStage.terminal_outcome === 'won') {
      d.won_at = d.won_at || new Date();
      d.lost_at = null;
    } else if (canonicalStage.terminal_outcome === 'lost') {
      d.lost_at = d.lost_at || new Date();
      d.won_at = null;
    }
    const metadata = { ...(d.metadata || {}) };
    if (d.title) metadata.title = d.title;
    if (d.notes) metadata.notes = d.notes;
    d.metadata = metadata;

    const REAL_COLUMNS = [
      'lead_id', 'course_id', 'campaign_id', 'conversation_id', 'stage', 'score',
      'estimated_value', 'currency', 'sla_deadline', 'won_at', 'lost_at',
      'loss_reason', 'assigned_to', 'approval_status', 'approval_stage', 'approved_by',
      'metadata', 'deal_id',
    ];
    const UUID_COLUMNS = new Set(['lead_id', 'course_id', 'campaign_id', 'conversation_id', 'deal_id']);
    const JSON_COLUMNS = new Set(['metadata']);

    const fields = REAL_COLUMNS.filter(k => d[k] !== undefined);
    const values = fields.map(k => (JSON_COLUMNS.has(k) ? JSON.stringify(d[k]) : d[k]));
    const placeholders = fields.map((k, i) => {
      const suffix = UUID_COLUMNS.has(k) ? '::uuid' : JSON_COLUMNS.has(k) ? '::jsonb' : '';
      return `$${i + 1}${suffix}`;
    }).join(', ');

    const results = await this.prisma.executeInTenantSchema<Opportunity[]>(
      schema,
      `INSERT INTO opportunities (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    const created = results && results.length > 0 ? results[0] : null;
    if (created) {
      await this.pipelineService.syncOpportunityToDeal(
        tenantId,
        String(d.lead_id),
        canonicalStage.slug,
        String((created as any).id),
      );
    }
    return created;
  }

  async updateOpportunity(tenantId: string, id: string, data: Partial<Opportunity>): Promise<Opportunity | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const record = { ...(data as Record<string, any>) };
    if (record.stage !== undefined) {
      await this.moveOpportunity(tenantId, id, String(record.stage));
      delete record.stage;
    }
    const ALLOWED_FIELDS = [
      'lead_id', 'title', 'value', 'currency', 'probability',
      'expected_close_date', 'assigned_to', 'notes', 'metadata',
      'source', 'lost_reason', 'won_date', 'lost_date',
    ];
    const fields = Object.keys(record).filter(k => record[k] !== undefined && ALLOWED_FIELDS.includes(k));
    if (fields.length === 0) return this.getOpportunityById(tenantId, id);

    const setClause = fields.map((k, i) => {
      const isUuid = ['lead_id', 'assigned_to'].includes(k);
      return `${k} = $${i + 2}${isUuid ? '::uuid' : ''}`;
    }).join(', ');
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
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid)`,
      [data.lead_id, data.opportunity_id, data.from_stage || null, data.to_stage, data.reason || null, data.triggered_by || 'system', data.agent_id || null]
    );
  }

  async getKanban(tenantId: string) {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) return { stages: [], forecast: { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 } };

      // Load configurable stages from DB, fallback to defaults
      const DEFAULT_STAGES = [
          { key: 'nuevo', name: 'Nuevo', color: '#95a5a6', position: 0, probability: 10, is_terminal: false, terminal_outcome: null },
          { key: 'contactado', name: 'Contactado', color: '#3498db', position: 1, probability: 20, is_terminal: false, terminal_outcome: null },
          { key: 'respondio', name: 'Respondió', color: '#9b59b6', position: 2, probability: 30, is_terminal: false, terminal_outcome: null },
          { key: 'calificado', name: 'Calificado', color: '#e67e22', position: 3, probability: 50, is_terminal: false, terminal_outcome: null },
          { key: 'tibio', name: 'Tibio', color: '#f39c12', position: 4, probability: 60, is_terminal: false, terminal_outcome: null },
          { key: 'caliente', name: 'Caliente', color: '#e74c3c', position: 5, probability: 80, is_terminal: false, terminal_outcome: null },
          { key: 'listo_para_cierre', name: 'Listo para cierre', color: '#27ae60', position: 6, probability: 95, is_terminal: false, terminal_outcome: null },
          { key: 'ganado', name: 'Ganado', color: '#2ecc71', position: 7, probability: 100, is_terminal: true, terminal_outcome: 'won' },
          { key: 'perdido', name: 'Perdido', color: '#7f8c8d', position: 8, probability: 0, is_terminal: true, terminal_outcome: 'lost' },
          { key: 'no_interesado', name: 'No interesado', color: '#bdc3c7', position: 9, probability: 0, is_terminal: true, terminal_outcome: 'lost' },
      ];

      let STAGES = DEFAULT_STAGES;
      try {
          const dbStages = await this.prisma.executeInTenantSchema<any[]>(schema,
              `SELECT slug as key, name, color, position, default_probability as probability,
                      is_terminal, terminal_outcome
               FROM pipeline_stages WHERE tenant_id = $1::uuid ORDER BY position ASC`,
              [tenantId],
          );
          if (dbStages?.length > 0) {
              STAGES = dbStages.map((s: any) => ({
                  key: s.key || s.name.toLowerCase().replace(/\s+/g, '_'),
                  name: s.name,
                  color: s.color || '#3498db',
                  position: s.position,
                  probability: s.probability ?? 0,
                  is_terminal: !!s.is_terminal,
                  terminal_outcome: s.terminal_outcome || null,
              }));
          }
      } catch (e) {
          // Fallback to defaults if pipeline_stages table doesn't exist yet
      }

      // Deduplicate: show only the most recent opportunity per lead
      // Note: archived_at column may not exist on older tenants, so we use a safe check
      const hasArchivedCol = await this.prisma.executeInTenantSchema<any[]>(schema,
          `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'leads' AND column_name = 'archived_at' LIMIT 1`,
          [schema],
      );
      const archiveFilter = hasArchivedCol?.length ? 'AND l.archived_at IS NULL' : '';

      const opps = await this.prisma.executeInTenantSchema<any[]>(schema, `
          SELECT DISTINCT ON (o.lead_id) o.*,
                 l.first_name, l.last_name, l.phone, l.email, l.score as lead_score,
                 crs.name as course_name, crs.price as course_price,
                 cam.name as campaign_name
          FROM opportunities o
          JOIN leads l ON l.id = o.lead_id
          LEFT JOIN courses crs ON crs.id = o.course_id
          LEFT JOIN campaigns cam ON cam.id = o.campaign_id
          WHERE 1=1 ${archiveFilter}
          ORDER BY o.lead_id, o.updated_at DESC
      `, []);

      const allOpps = opps || [];

      // Generic funnel slugs (what new opportunities and auto-progression write:
      // nuevo/contactado/calificado/...) are DISJOINT from a vertical tenant's own
      // stage slugs (consulta/cotizacion/reserva/...). Without a bridge, every such
      // card fails the exact `o.stage === s.key` match and piles into column 1. Map
      // any unmatched-but-known generic slug to the closest column by probability,
      // respecting terminal-ness (won/lost generic → terminal column).
      const GENERIC_PROB: Record<string, { prob: number; outcome: 'won' | 'lost' | null }> = {
          nuevo: { prob: 10, outcome: null },
          contactado: { prob: 20, outcome: null },
          respondio: { prob: 30, outcome: null },
          calificado: { prob: 50, outcome: null },
          tibio: { prob: 60, outcome: null },
          caliente: { prob: 80, outcome: null },
          listo_cierre: { prob: 95, outcome: null },
          listo_para_cierre: { prob: 95, outcome: null },
          ganado: { prob: 100, outcome: 'won' },
          perdido: { prob: 0, outcome: 'lost' },
          no_interesado: { prob: 0, outcome: 'lost' },
      };
      const resolveColumnIndex = (stage: string | null | undefined): number => {
          if (!stage) return -1; // null → caller drops into column 0 catch-all
          const exact = STAGES.findIndex(s => s.key === stage);
          if (exact >= 0) return exact; // tenant slug (or generic on a generic tenant)
          const gen = GENERIC_PROB[stage];
          if (!gen) return -1; // unknown custom slug → column 0 catch-all
          const indexed = STAGES.map((s, i) => ({ i, s }));
          let pool: Array<{ i: number; s: typeof STAGES[number] }>;
          if (gen.outcome) {
              // Match the explicit business outcome, never a translated slug or
              // display probability. This keeps won/lost cards and forecasts aligned.
              pool = indexed.filter(({ s }) => s.is_terminal && s.terminal_outcome === gen.outcome);
              if (!pool.length) return -1; // no matching-polarity terminal → column 0 catch-all
          } else {
              pool = indexed.filter(({ s }) => !s.is_terminal);
              if (!pool.length) pool = indexed;
          }
          let best = pool[0];
          let bestDiff = Infinity;
          for (const c of pool) {
              const diff = Math.abs((c.s.probability ?? 0) - gen.prob);
              if (diff < bestDiff) { bestDiff = diff; best = c; } // strict < keeps the earlier column on ties
          }
          return best.i;
      };
      const oppColIdx = new Map<any, number>();
      for (const o of allOpps) oppColIdx.set(o, resolveColumnIndex((o as any).stage));

      const kanbanStages = STAGES.map((s, idx) => {
          const stageOpps = allOpps.filter((o: any) => {
              const col = oppColIdx.get(o);
              // Resolved column wins; unresolved (null / unknown custom slug) fall into
              // the first column so a card is never silently dropped from the board.
              return col != null && col >= 0 ? col === idx : idx === 0;
          });
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
                      title: o.course_name || o.campaign_name || o.metadata?.title || 'Oportunidad',
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
      const target = await this.pipelineService.moveOpportunityStage(
          tenantId,
          opportunityId,
          newStage,
          'agent',
      );
      this.logger.log(`Opportunity ${opportunityId} moved to ${target.slug}`);
  }
}
