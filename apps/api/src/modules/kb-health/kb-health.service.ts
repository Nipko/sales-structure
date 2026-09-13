import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { KnowledgeConflictService } from './knowledge-conflict.service';

/** Compatibility entry point. All scans now produce versioned, quoted evidence. */
@Injectable()
export class KbHealthService {
    private readonly logger = new Logger(KbHealthService.name);
    constructor(private readonly prisma: PrismaService, private readonly cronLock: CronLockService,
        private readonly conflicts: KnowledgeConflictService) {}

    async scanContradictions(tenantId: string): Promise<number> {
        return (await this.conflicts.scan(tenantId)).newIssues;
    }

    async getIssues(tenantId: string, status = 'open') {
        const result = await this.conflicts.overview(tenantId);
        return result.cases.filter(item => item.status === status).map(item => ({
            ...item, type: 'potential_conflict', documentTitle: item.sourceA.title, relatedDocumentTitle: item.sourceB.title,
        }));
    }

    async updateIssue(_tenantId: string, _id: string, _status: string): Promise<void> {
        throw new BadRequestException({ error: 'conflict_review_evidence_required' });
    }

    /** Weekly scan across all active tenants (Sundays 05:00 UTC, after recrawl @04:00). */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 5 * * 0')
    async weeklyScanCron() {
        await this.cronLock.runExclusive('kb-health.weeklyScan', 3600, () => this.weeklyScan());
    }

    async weeklyScan(): Promise<void> {
        let tenants: any[];
        try {
            tenants = await this.prisma.$queryRawUnsafe(
                `SELECT id FROM tenants WHERE is_active = true`,
            );
        } catch (err: any) {
            this.logger.warn(`[KBHealth] weekly scan: failed to list tenants: ${err.message}`);
            return;
        }
        this.logger.log(`[KBHealth] Weekly contradiction scan for ${tenants?.length || 0} tenants`);
        for (const t of tenants || []) {
            try {
                await this.scanContradictions(t.id);
            } catch (err: any) {
                this.logger.warn(`[KBHealth] scan failed for tenant ${t.id}: ${err.message}`);
            }
        }
    }
}
