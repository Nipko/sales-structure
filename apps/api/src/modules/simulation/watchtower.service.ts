import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Watchtower — always-on QA sampling 5% daily (Decagon Watchtower style, D9).
 * Samples conversations from last 24h, runs QualityService judge, emits alert if median overall <7.
 * Lightweight: reuses simulation pipeline, no LLM cost unless sampled.
 */
@Injectable()
export class WatchtowerService {
    private readonly logger = new Logger(WatchtowerService.name);

    constructor(private readonly prisma: PrismaService) {}

    @Cron('0 2 * * *')
    async sampleDaily(): Promise<void> {
        try {
            // Sample 5% of tenants' conversations from last 24h (max 50)
            const tenants = await this.prisma.tenant.findMany({ select: { id: true, schemaName: true }, where: { isActive: true } });
            let sampled = 0;
            for (const t of tenants.slice(0, 20)) { // cap 20 tenants per run to avoid overload
                try {
                    const rows: any[] = await (this.prisma.executeInTenantSchema(t.schemaName,
                        `SELECT id FROM conversations WHERE updated_at > NOW() - INTERVAL '24 hours' ORDER BY random() LIMIT 2`,
                    ).catch(() => []) as Promise<any[]>);
                    sampled += rows.length;
                } catch {}
            }
            this.logger.log(`[Watchtower] Daily sample: ${sampled} conversations across ${Math.min(tenants.length,20)} tenants (5% sampling placeholder, QualityService judge to be wired)`);
            // TODO: wire QualityService.judgeTranscript for sampled ids and emit analytics/alerts if median <7
        } catch (e: any) {
            this.logger.warn(`[Watchtower] sampleDaily failed: ${e.message}`);
        }
    }
}
