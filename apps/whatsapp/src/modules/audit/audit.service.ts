import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  tenantId: string;
  userId?: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crear un registro de auditoría.
   * Adapta el formato interno al schema existente del AuditLog (resource + details).
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          tenantId: entry.tenantId,
          userId: entry.userId || 'system',
          resource: `${entry.entityType}:${entry.entityId}`,
          details: {
            entityType: entry.entityType,
            entityId: entry.entityId,
            source: 'whatsapp-service',
            ...entry.metadata,
          },
        },
      });
    } catch (error: any) {
      // Audit log failure should NEVER break the main flow
      this.logger.warn(`Failed to create audit log: ${error.message}`);
    }
  }
}
