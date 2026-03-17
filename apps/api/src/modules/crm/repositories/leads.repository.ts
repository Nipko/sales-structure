import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Lead } from '../interfaces/lead.interface';

@Injectable()
export class LeadsRepository {
  private readonly logger = new Logger(LeadsRepository.name);

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
        total: parseInt((total as any)[0]?.total || '0'),
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
            WHERE l.id = $1 LIMIT 1`,
            [leadId]
        ),
        this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT o.*, crs.name as course_name FROM opportunities o
             LEFT JOIN courses crs ON crs.id = o.course_id
             WHERE o.lead_id = $1 ORDER BY o.created_at DESC`,
            [leadId]
        ),
        this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT t.name, t.color FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1`,
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
      `SELECT * FROM leads WHERE id = $1`,
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
        `SELECT * FROM leads WHERE phone = $1 AND campaign_id = $2`,
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

    const record = data as Record<string, any>;
    const fields = Object.keys(record).filter(k => record[k] !== undefined);
    const values = fields.map(k => record[k]);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

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

    const record = data as Record<string, any>;
    const fields = Object.keys(record).filter(k => record[k] !== undefined);
    if (fields.length === 0) return this.getLeadById(tenantId, id);

    const setClause = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [id, ...fields.map(k => record[k])];

    const results = await this.prisma.executeInTenantSchema<Lead[]>(
      schema,
      `UPDATE leads SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    const resultsArray = results as any[];
    return resultsArray && resultsArray.length > 0 ? resultsArray[0] : null;
  }
}
