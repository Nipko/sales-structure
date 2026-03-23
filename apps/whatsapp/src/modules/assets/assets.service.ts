import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MetaGraphService } from '../meta-graph/meta-graph.service';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @InjectQueue('sync') private readonly syncQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly metaGraph: MetaGraphService,
  ) {}

  /**
   * Encolar sincronización de templates para un tenant
   */
  async enqueueSyncTemplates(tenantId: string, wabaId: string) {
    await this.syncQueue.add('sync-templates', {
      tenantId,
      wabaId,
      timestamp: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
    });

    this.logger.log(`Template sync enqueued for tenant: ${tenantId}`);
  }

  /**
   * Encolar sincronización de números de teléfono
   */
  async enqueueSyncPhoneNumbers(tenantId: string, wabaId: string) {
    await this.syncQueue.add('sync-phone-numbers', {
      tenantId,
      wabaId,
      timestamp: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
    });

    this.logger.log(`Phone number sync enqueued for tenant: ${tenantId}`);
  }

  /**
   * Encolar reconciliación completa de assets
   */
  async enqueueFullReconciliation(tenantId: string, wabaId: string) {
    await this.syncQueue.add('full-reconciliation', {
      tenantId,
      wabaId,
      timestamp: new Date().toISOString(),
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: 20,
    });

    this.logger.log(`Full reconciliation enqueued for tenant: ${tenantId}`);
  }
}
