import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Course, Campaign } from '../interfaces/catalog.interface';

@Injectable()
export class CatalogRepository {
  private readonly logger = new Logger(CatalogRepository.name);

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

  // ============================================
  // COURSES
  // ============================================
  async getCourses(tenantId: string): Promise<Course[]> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return [];
    
    return this.prisma.executeInTenantSchema<Course[]>(
      schema,
      `SELECT * FROM courses WHERE is_active = true ORDER BY name ASC`,
      []
    );
  }

  async getCourseById(tenantId: string, id: string): Promise<Course | null> {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) return null;
      
      const results = await this.prisma.executeInTenantSchema<Course[]>(
          schema,
          `SELECT * FROM courses WHERE id = $1::uuid`,
          [id]
      );
      return results && results.length > 0 ? results[0] : null;
  }

  // ============================================
  // CAMPAIGNS
  // ============================================
  async getCampaigns(tenantId: string): Promise<Campaign[]> {
    const schema = await this.getTenantSchema(tenantId);
    if (!schema) return [];

    return this.prisma.executeInTenantSchema<Campaign[]>(
      schema,
      `SELECT * FROM campaigns ORDER BY created_at DESC`,
      []
    );
  }

  async getActiveCampaigns(tenantId: string): Promise<Campaign[]> {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) return [];

      return this.prisma.executeInTenantSchema<Campaign[]>(
          schema,
          `SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC`,
          []
      );
  }

  async getCampaignById(tenantId: string, id: string): Promise<Campaign | null> {
      const schema = await this.getTenantSchema(tenantId);
      if (!schema) return null;

      const results = await this.prisma.executeInTenantSchema<Campaign[]>(
          schema,
          `SELECT * FROM campaigns WHERE id = $1::uuid`,
          [id]
      );
      return results && results.length > 0 ? results[0] : null;
  }
}

