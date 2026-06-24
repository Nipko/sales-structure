import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type IncidentSeverity = 'info' | 'warning' | 'critical';

const OPEN_STATUSES = ['active', 'acknowledged'];

/**
 * Persistent incident store for the super_admin ops center.
 *
 * Turns the previously ephemeral, email-only platform alerts into deduped,
 * acknowledgeable, historical records. PlatformMonitorService.alert() calls
 * record() on every fire (independent of the email cooldown); the threshold
 * checks call resolveByKey() when a condition clears, and sweepStale() is a
 * backstop for alerts that simply stop re-firing (e.g. daily ones).
 */
@Injectable()
export class IncidentService {
    private readonly logger = new Logger(IncidentService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** Upsert the OPEN incident for a key: bump count/lastSeen if one exists, else create. */
    async record(
        key: string,
        severity: IncidentSeverity,
        title: string,
        body: string,
        value?: number,
    ): Promise<void> {
        try {
            const open = await this.prisma.platformIncident.findFirst({
                where: { key, status: { in: OPEN_STATUSES } },
                orderBy: { lastSeenAt: 'desc' },
                select: { id: true },
            });
            if (open) {
                await this.prisma.platformIncident.update({
                    where: { id: open.id },
                    data: {
                        lastSeenAt: new Date(),
                        count: { increment: 1 },
                        severity,
                        title,
                        body,
                        value: value ?? null,
                    },
                });
            } else {
                await this.prisma.platformIncident.create({
                    data: { key, severity, title, body, value: value ?? null, status: 'active' },
                });
            }
        } catch (e: any) {
            this.logger.warn(`Incident record failed for ${key}: ${e.message}`);
        }
    }

    /** Auto-resolve every open incident for a key when the condition clears. */
    async resolveByKey(key: string): Promise<void> {
        try {
            await this.prisma.platformIncident.updateMany({
                where: { key, status: { in: OPEN_STATUSES } },
                data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system' },
            });
        } catch (e: any) {
            this.logger.debug(`resolveByKey failed for ${key}: ${e.message}`);
        }
    }

    async acknowledge(id: string, by: string) {
        return this.prisma.platformIncident.update({
            where: { id },
            data: { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: by },
        });
    }

    async resolve(id: string, by: string) {
        return this.prisma.platformIncident.update({
            where: { id },
            data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: by },
        });
    }

    async list(opts: { status?: string; severity?: string; limit?: number; offset?: number }) {
        const where: Record<string, any> = {};
        if (opts.status && opts.status !== 'all') where.status = opts.status;
        if (opts.severity && opts.severity !== 'all') where.severity = opts.severity;
        const take = Math.min(200, Math.max(1, opts.limit ?? 100));
        const skip = Math.max(0, opts.offset ?? 0);
        const [items, total] = await Promise.all([
            this.prisma.platformIncident.findMany({
                where,
                orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
                take,
                skip,
            }),
            this.prisma.platformIncident.count({ where }),
        ]);
        return { items, total };
    }

    async summary() {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [activeCritical, activeWarning, acknowledged, resolved24h] = await Promise.all([
            this.prisma.platformIncident.count({ where: { status: 'active', severity: 'critical' } }),
            this.prisma.platformIncident.count({ where: { status: 'active', severity: 'warning' } }),
            this.prisma.platformIncident.count({ where: { status: 'acknowledged' } }),
            this.prisma.platformIncident.count({ where: { status: 'resolved', resolvedAt: { gte: since } } }),
        ]);
        return { activeCritical, activeWarning, acknowledged, resolved24h };
    }

    /** Backstop: auto-resolve open incidents not seen for `staleHours` (default 48h). */
    async sweepStale(staleHours = 48): Promise<number> {
        const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);
        try {
            const res = await this.prisma.platformIncident.updateMany({
                where: { status: { in: OPEN_STATUSES }, lastSeenAt: { lt: cutoff } },
                data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system' },
            });
            return res.count;
        } catch {
            return 0;
        }
    }
}
