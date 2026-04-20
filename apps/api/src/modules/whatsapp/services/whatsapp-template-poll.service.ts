import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappTemplateService } from './whatsapp-template.service';

@Injectable()
export class WhatsappTemplatePollService {
    private readonly logger = new Logger(WhatsappTemplatePollService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly templateService: WhatsappTemplateService,
    ) {}

    // Every 30 minutes. Webhook is the primary signal — this is a safety net
    // that catches templates stuck in PENDING for >12h (webhook never arrived,
    // was dropped, or fired before DI was ready).
    @Cron('*/30 * * * *')
    async pollAll() {
        let tenants: Array<{ id: string; schemaName: string }>;
        try {
            tenants = await this.prisma.$queryRaw<Array<{ id: string; schemaName: string }>>`
                SELECT id, "schemaName" FROM tenants WHERE is_active = true
            `;
        } catch (e: any) {
            this.logger.warn(`[pollAll] Failed to list tenants: ${e.message}`);
            return;
        }

        let totalRefreshed = 0;
        for (const t of tenants) {
            try {
                const { refreshed } = await this.templateService.pollPendingTemplates(t.schemaName);
                totalRefreshed += refreshed;
            } catch (e: any) {
                this.logger.warn(`[pollAll] tenant ${t.id}: ${e.message}`);
            }
        }
        if (totalRefreshed > 0) {
            this.logger.log(`[pollAll] Refreshed ${totalRefreshed} stale templates across ${tenants.length} tenants`);
        }
    }
}
