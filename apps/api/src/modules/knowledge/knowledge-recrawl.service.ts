import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { CronLockService } from '../redis/cron-lock.service';

@Injectable()
export class KnowledgeRecrawlService {
    private readonly logger = new Logger(KnowledgeRecrawlService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly knowledgeService: KnowledgeService,
        private readonly cronLock: CronLockService,
    ) {}

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 4 * * 0')
    async handleWeeklyRecrawlCron() {
        await this.cronLock.runExclusive('knowledge-recrawl.handleWeeklyRecrawl', 3600, () => this.handleWeeklyRecrawl());
    }

    async handleWeeklyRecrawl() {
        this.logger.log('[KB Recrawl] Starting weekly URL recrawl…');

        const tenants = await this.prisma.$queryRaw<any[]>`
            SELECT id, schema_name FROM tenants WHERE is_active = true
        `;

        let total = 0;
        let updated = 0;
        let errors = 0;

        for (const tenant of tenants) {
            try {
                const urlDocs = await this.prisma.executeInTenantSchema<any[]>(
                    tenant.schema_name,
                    `SELECT id, source_url, title FROM knowledge_documents
                     WHERE source_type = 'url' AND status = 'ready'
                       AND auto_recrawl = true
                       AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '6 days')
                     ORDER BY last_crawled_at ASC NULLS FIRST
                     LIMIT 20`,
                );

                if (!urlDocs?.length) continue;
                total += urlDocs.length;

                for (const doc of urlDocs) {
                    try {
                        const result = await this.knowledgeService.recrawlUrl(tenant.id, doc.id);
                        if (!('changed' in result) || result.changed !== false) updated++;
                    } catch (e: any) {
                        errors++;
                        this.logger.warn(`[KB Recrawl] Failed ${doc.id} (${doc.source_url}): ${e.message}`);
                    }
                }
            } catch (e: any) {
                this.logger.error(`[KB Recrawl] Tenant ${tenant.id} failed: ${e.message}`);
            }
        }

        this.logger.log(`[KB Recrawl] Done. Checked: ${total}, Updated: ${updated}, Errors: ${errors}`);
    }
}
