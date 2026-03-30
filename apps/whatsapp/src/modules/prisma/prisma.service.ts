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
    if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }

    // Scope search_path to the transaction to avoid leakage across pooled connections.
    return this.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}"`);
      return tx.$queryRawUnsafe(query, ...params) as Promise<T>;
    });
  }

  /**
   * Lookup the tenant ID and schema from a WhatsApp phone_number_id
   * Used for webhook routing: phone_number_id → tenantId
   */
  async getTenantByPhoneNumberId(phoneNumberId: string): Promise<{ tenantId: string; schemaName: string } | null> {
    const results = (await this.$queryRawUnsafe(
      `SELECT ca.tenant_id, t.schema_name
       FROM channel_accounts ca
       JOIN tenants t ON t.id = ca.tenant_id
       WHERE ca.channel_type = 'whatsapp'
         AND ca.account_id = $1
         AND ca.is_active = true
       LIMIT 1`,
      phoneNumberId,
    )) as Array<{ tenant_id: string; schema_name: string }>;

    if (!results || results.length === 0) return null;
    return { tenantId: results[0].tenant_id, schemaName: results[0].schema_name };
  }
}
