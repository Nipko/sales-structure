import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Lead } from '../interfaces/lead.interface';
import { normalizePhoneE164 } from '../../../common/utils/phone.util';
import { PipelineService } from '../../pipeline/pipeline.service';

/**
 * Columns of `leads` that a caller may write, as they actually exist in
 * `prisma/tenant-schema.sql`.
 *
 * This used to be two hand-maintained lists (one in createLead, one in
 * updateLead) that between them named five columns the table never had:
 * `source`, `notes`, `tags`, `customer_profile_id` and `converted_at`. A
 * whitelist that admits a phantom column is worse than no whitelist — it
 * promotes the field into the INSERT and Postgres rejects the whole statement
 * with 42703. The mobile app hardcodes `source: 'mobile'` on every lead, so
 * creating a lead from the phone failed 100% of the time with a 500.
 *
 * Lead attribution lives in `utm_source` (that is what CRM analytics reads);
 * anything else a client sends under `source` is folded into `metadata`.
 */
const LEAD_WRITABLE_COLUMNS = [
  'first_name', 'last_name', 'phone', 'phone_normalized', 'email',
  'stage', 'score', 'is_vip', 'metadata',
] as const;

const PROTECTED_LEAD_COLUMNS = ['assigned_to', 'archived_at'] as const;

function rejectProtectedLeadColumns(record: Record<string, any>): void {
  const protectedField = PROTECTED_LEAD_COLUMNS.find((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (protectedField) {
    throw new BadRequestException(`${protectedField} must be changed through its dedicated endpoint`);
  }
}

/** Keys that are meaningful to callers but are not columns — kept in metadata. */
const METADATA_FOLDED_KEYS = ['source', 'notes', 'tags'] as const;

/**
 * Moves non-column keys into `metadata` instead of letting them reach the SQL
 * builder, so a client sending `source` gets its value stored rather than a 500.
 */
function foldNonColumnsIntoMetadata(record: Record<string, any>): void {
  const folded: Record<string, any> = {};
  for (const key of METADATA_FOLDED_KEYS) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      folded[key] = record[key];
    }
    delete record[key];
  }
  if (Object.keys(folded).length === 0) return;
  const existing = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  record.metadata = { ...existing, ...folded };
}

@Injectable()
export class LeadsRepository {
  private readonly logger = new Logger(LeadsRepository.name);

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

  async listLeads(tenantId: string, params: {
    search?: string;
    stage?: string;
    assignedTo?: string;
    courseId?: string;
    isVip?: boolean;
    includeArchived?: boolean;
    scoreMin?: number;
    scoreMax?: number;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
    page?: number;
    limit?: number;
  }) {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) throw new Error('Tenant not found');

    const { search, stage, assignedTo, courseId, isVip, includeArchived, scoreMin, scoreMax, dateFrom, dateTo, tags: filterTags, page = 1, limit = 25 } = params;
    const offset = (page - 1) * limit;

    // Consolidated query: one row per person (grouped by customer_profile_id)
    // Falls back to one row per lead for leads without a profile link
    let q = `WITH lead_data AS (
      SELECT l.*,
        c.name as company_name,
        ct.channel_type as contact_channel,
        ci.customer_profile_id as profile_id,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(ci.customer_profile_id, l.id)
          ORDER BY l.score DESC, l.updated_at DESC
        ) as rn
      FROM leads l
      LEFT JOIN companies c ON c.id = l.company_id
      LEFT JOIN contacts ct ON ct.id = l.contact_id
      LEFT JOIN contact_identities ci ON ci.contact_id = l.contact_id
      WHERE 1=1`;

    const p: any[] = [];
    let n = 1;

    // archived_at column may not exist on older tenants — check safely
    if (!includeArchived) {
        try {
            const hasCol = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'leads' AND column_name = 'archived_at' LIMIT 1`,
                [schema],
            );
            if (hasCol?.length) {
                q += ` AND l.archived_at IS NULL`;
            }
        } catch (e: any) {
            this.logger.warn(`archived_at column check failed for schema ${schema}: ${e.message}`);
        }
    }
    if (search) {
        q += ` AND (l.first_name ILIKE $${n} OR l.last_name ILIKE $${n} OR l.phone ILIKE $${n} OR l.email ILIKE $${n})`;
        p.push(`%${search}%`);
        n++;
    }
    if (stage) { q += ` AND l.stage = $${n++}`; p.push(stage); }
    if (assignedTo) { q += ` AND l.assigned_to = $${n++}::uuid`; p.push(assignedTo); }
    if (courseId) { q += ` AND l.course_id = $${n++}::uuid`; p.push(courseId); }
    if (isVip !== undefined) { q += ` AND l.is_vip = $${n++}`; p.push(isVip); }
    if (scoreMin !== undefined) { q += ` AND l.score >= $${n++}`; p.push(scoreMin); }
    if (scoreMax !== undefined) { q += ` AND l.score <= $${n++}`; p.push(scoreMax); }
    if (dateFrom) { q += ` AND l.created_at >= $${n++}`; p.push(dateFrom); }
    if (dateTo) { q += ` AND l.created_at <= $${n++}`; p.push(dateTo); }
    if (filterTags && filterTags.length > 0) {
      q += ` AND EXISTS (SELECT 1 FROM lead_tags lt2 JOIN tags t2 ON t2.id = lt2.tag_id WHERE lt2.lead_id = l.id AND t2.name = ANY($${n++}::text[]))`;
      p.push(`{${filterTags.join(',')}}`);
    }

    q += `)
    SELECT ld.*,
      (SELECT COUNT(*) FROM conversations cv
       JOIN contacts ct2 ON ct2.id = cv.contact_id
       LEFT JOIN contact_identities ci2 ON ci2.contact_id = ct2.id
       WHERE COALESCE(ci2.customer_profile_id, ct2.id) = COALESCE(ld.profile_id, ld.contact_id)
      ) as conversations_count,
      (SELECT ARRAY_AGG(DISTINCT ct3.channel_type) FROM contacts ct3
       LEFT JOIN contact_identities ci3 ON ci3.contact_id = ct3.id
       WHERE ci3.customer_profile_id = ld.profile_id AND ld.profile_id IS NOT NULL
      ) as channels,
      (SELECT MAX(m2.created_at) FROM messages m2
       JOIN conversations cv2 ON cv2.id = m2.conversation_id
       WHERE cv2.contact_id = ld.contact_id
      ) as last_message_at
    FROM lead_data ld
    WHERE ld.rn = 1
    ORDER BY ld.score DESC, ld.created_at DESC
    LIMIT $${n++} OFFSET $${n++}`;
    p.push(limit, offset);

    const rows = await this.prisma.executeInTenantSchema<any[]>(schema, q, p);

    let countQ = `SELECT COUNT(DISTINCT COALESCE(ci.customer_profile_id, l.id)) as total
      FROM leads l
      LEFT JOIN contact_identities ci ON ci.contact_id = l.contact_id
      WHERE 1=1`;
    if (!includeArchived) {
        try {
            const hasCol2 = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'leads' AND column_name = 'archived_at' LIMIT 1`,
                [schema],
            );
            if (hasCol2?.length) countQ += ` AND l.archived_at IS NULL`;
        } catch (e: any) {
            this.logger.warn(`archived_at column check failed for count query (schema ${schema}): ${e.message}`);
        }
    }
    const total = await this.prisma.executeInTenantSchema<any[]>(schema, countQ, []);

    return {
        data: rows || [],
        total: parseInt((total as any)?.[0]?.total || '0'),
        page,
        limit,
    };
  }

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

    const leadsArray = leads as any[];
    if (!leadsArray || leadsArray.length === 0) throw new Error('Lead not found');
    return { lead: leadsArray[0], opportunities, tags };
  }

  async getLeadById(tenantId: string, id: string): Promise<Lead | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const results = await this.prisma.executeInTenantSchema<Lead[]>(
      schema,
      `SELECT * FROM leads WHERE id = $1::uuid`,
      [id]
    );
    const resultsArray = results as any[];
    return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
  }

  async getLeadByPhone(tenantId: string, phone: string, campaignId?: string): Promise<Lead | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    if (campaignId) {
      const results = await this.prisma.executeInTenantSchema<Lead[]>(
        schema,
        `SELECT * FROM leads WHERE phone = $1 AND campaign_id = $2::uuid`,
        [phone, campaignId]
      );
      const resultsArray = results as any[];
      return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
    } else {
      const results = await this.prisma.executeInTenantSchema<Lead[]>(
        schema,
        `SELECT * FROM leads WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
        [phone]
      );
      const resultsArray = results as any[];
      return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
    }
  }

  async createLead(tenantId: string, data: Partial<Lead>): Promise<Lead | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const record = { ...(data as Record<string, any>) };
    rejectProtectedLeadColumns(record);
    foldNonColumnsIntoMetadata(record);
    // `leads.phone` is NOT NULL. Without this the missing-phone case reaches
    // Postgres and comes back as a 500, which the caller can only read as
    // "nothing happened" — the same dead-end the phantom columns produced.
    if (!String(record.phone ?? '').trim()) {
      throw new BadRequestException('phone is required to create a lead');
    }
    const canonicalStage = await this.pipelineService.resolveTenantStage(tenantId, record.stage, { schemaName: schema });
    record.stage = canonicalStage.slug;
    // Auto-normalize phone
    if (record.phone) {
      record.phone_normalized = normalizePhoneE164(record.phone) || record.phone;
    }
    const fields = Object.keys(record).filter(k => record[k] !== undefined && (LEAD_WRITABLE_COLUMNS as readonly string[]).includes(k));
    const values = fields.map(k => record[k]);
    const placeholders = fields.map((k, i) => {
      const isUuid = ['assigned_to', 'customer_profile_id', 'contact_id', 'campaign_id', 'course_id'].includes(k);
      return `$${i + 1}${isUuid ? '::uuid' : ''}`;
    }).join(', ');

    const results = await this.prisma.executeInTenantSchema<Lead[]>(
      schema,
      `INSERT INTO leads (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    const resultsArray = results as any[];
    return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
  }

  async updateLead(tenantId: string, id: string, data: Partial<Lead>): Promise<Lead | null> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return null;

    const record = { ...(data as Record<string, any>) };
    rejectProtectedLeadColumns(record);
    foldNonColumnsIntoMetadata(record);
    if (record.stage !== undefined) {
      record.stage = (await this.pipelineService.resolveTenantStage(
        tenantId,
        String(record.stage),
        { schemaName: schema },
      )).slug;
    }
    // Auto-normalize phone on update
    if (record.phone) {
      record.phone_normalized = normalizePhoneE164(record.phone) || record.phone;
    }
    const fields = Object.keys(record).filter(k => record[k] !== undefined && (LEAD_WRITABLE_COLUMNS as readonly string[]).includes(k));
    if (fields.length === 0) return this.getLeadById(tenantId, id);

    const setClause = fields.map((k, i) => {
      const isUuid = ['assigned_to', 'contact_id', 'campaign_id', 'course_id'].includes(k);
      return `${k} = $${i + 2}${isUuid ? '::uuid' : ''}`;
    }).join(', ');
    const values = [id, ...fields.map(k => record[k])];

    const results = await this.prisma.executeInTenantSchema<Lead[]>(
      schema,
      `UPDATE leads SET ${setClause}, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
      values
    );
    const resultsArray = results as any[];
    return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
  }

  async bulkUpdate(tenantId: string, leadIds: string[], action: string, payload: any): Promise<{ updated: number }> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) throw new Error('Tenant not found');
    if (!leadIds.length) return { updated: 0 };

    const idsParam = `{${leadIds.join(',')}}`;

    switch (action) {
      case 'stage': {
        const canonicalStage = await this.pipelineService.resolveTenantStage(
          tenantId,
          payload.stage,
          { schemaName: schema },
        );
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
          `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) RETURNING id`,
          [canonicalStage.slug, idsParam],
        );
        return { updated: result?.length || 0 };
      }
      case 'assign': {
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
          `UPDATE leads SET assigned_to = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) RETURNING id`,
          [payload.assignedTo, idsParam],
        );
        return { updated: result?.length || 0 };
      }
      case 'archive': {
        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
          `UPDATE leads SET archived_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[]) RETURNING id`,
          [idsParam],
        );
        return { updated: result?.length || 0 };
      }
      case 'tag': {
        const tagName = payload.tag;
        if (!tagName) return { updated: 0 };
        // Ensure tag exists
        await this.prisma.executeInTenantSchema(schema,
          `INSERT INTO tags (name, color) VALUES ($1, '#6366f1') ON CONFLICT (name) DO NOTHING`,
          [tagName.trim()],
        );
        // Add tag to all selected leads, tracking actual successes
        let taggedCount = 0;
        for (const leadId of leadIds) {
          try {
            await this.prisma.executeInTenantSchema(schema,
              `INSERT INTO lead_tags (lead_id, tag_id)
               SELECT $1::uuid, t.id FROM tags t WHERE t.name = $2
               ON CONFLICT DO NOTHING`,
              [leadId, tagName.trim()],
            );
            taggedCount++;
          } catch {
            // Skip individual failures (e.g. invalid UUID), continue with rest
          }
        }
        return { updated: taggedCount };
      }
      default:
        throw new Error(`Unknown bulk action: ${action}`);
    }
  }

  async updateLeadTags(tenantId: string, leadId: string, tagNames: string[]): Promise<void> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return;

    // Remove existing tags
    await this.prisma.executeInTenantSchema(schema,
      `DELETE FROM lead_tags WHERE lead_id = $1::uuid`,
      [leadId],
    );

    if (tagNames.length === 0) return;

    // Ensure tags exist (create if not)
    for (const name of tagNames) {
      await this.prisma.executeInTenantSchema(schema,
        `INSERT INTO tags (name, color) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [name.trim(), '#6366f1'],
      );
    }

    // Re-link tags to lead
    for (const name of tagNames) {
      await this.prisma.executeInTenantSchema(schema,
        `INSERT INTO lead_tags (lead_id, tag_id)
         SELECT $1::uuid, t.id FROM tags t WHERE t.name = $2
         ON CONFLICT DO NOTHING`,
        [leadId, name.trim()],
      );
    }
  }

  async archiveLead(tenantId: string, id: string): Promise<void> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) throw new Error('Tenant not found');
    await this.prisma.executeInTenantSchema(schema,
      `UPDATE leads SET archived_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
      [id],
    );
  }

  async restoreLead(tenantId: string, id: string): Promise<void> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) throw new Error('Tenant not found');
    await this.prisma.executeInTenantSchema(schema,
      `UPDATE leads SET archived_at = NULL, updated_at = NOW() WHERE id = $1::uuid`,
      [id],
    );
  }
}
