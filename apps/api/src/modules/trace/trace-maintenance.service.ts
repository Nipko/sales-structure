import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TraceService } from './trace.service';

const TURN_TRACE_RETENTION_DAYS = 30;

/**
 * Retention for step-by-step turn traces (WS5 #1). They're voluminous (one row per
 * turn), so we keep only the last 30 days. Runs weekly, after the media cleanup.
 */
@Injectable()
export class TraceMaintenanceService {
    private readonly logger = new Logger(TraceMaintenanceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly trace: TraceService,
    ) {}

    // Weekly, Sunday 4:45 AM (after the media cleanup at 4:30, before infra cleanup at 5).
    @Cron('45 4 * * 0')
    async pruneOldTurnTraces(): Promise<void> {
        this.logger.log(`Pruning turn traces older than ${TURN_TRACE_RETENTION_DAYS} days...`);
        let tenants: { id: string; schemaName: string }[] = [];
        try {
            tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });
        } catch (e: any) {
            this.logger.warn(`pruneOldTurnTraces: tenant list failed: ${e.message}`);
            return;
        }

        let processed = 0;
        for (const t of tenants) {
            if (!t.schemaName) continue;
            await this.trace.pruneTurnTraces(t.schemaName, TURN_TRACE_RETENTION_DAYS);
            processed++;
        }
        this.logger.log(`Turn-trace pruning complete across ${processed} tenants`);
    }
}
