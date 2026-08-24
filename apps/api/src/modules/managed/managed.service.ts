import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';

export interface ManagedConfig {
    enabled: boolean;
    resolutionTargetPct?: number;   // guaranteed verified-resolution %
    monthlyFeeCents?: number;
    notes?: string;
    startedAt?: string;
}

/**
 * Managed / done-for-you tier (T3.24). Super-admin marks a tenant as managed
 * with a resolution-rate guarantee; this tracks the actual (verified) AI
 * resolution rate vs the target for outcome-based billing reconciliation.
 * Leverages T0.1 (resolution) + T1.8 (verified resolution).
 */
@Injectable()
export class ManagedService {
    private readonly logger = new Logger(ManagedService.name);

    constructor(private readonly prisma: PrismaService) {}

    private monthRange(start?: string, end?: string): { start: string; end: string } {
        if (start && end) return { start, end };
        const now = new Date();
        const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { start: s.toISOString(), end: now.toISOString() };
    }

    async getConfig(tenantId: string): Promise<ManagedConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        return ((tenant?.settings as any)?.managed as ManagedConfig) || { enabled: false };
    }

    async setConfig(tenantId: string, patch: Partial<ManagedConfig>): Promise<ManagedConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        const now = new Date().toISOString();
        const merged = await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'managed',
            (value): ManagedConfig => {
                const current = (value && typeof value === 'object'
                    ? value
                    : { enabled: false }) as ManagedConfig;
                return {
                    enabled: patch.enabled ?? current.enabled,
                    resolutionTargetPct: patch.resolutionTargetPct ?? current.resolutionTargetPct ?? 70,
                    monthlyFeeCents: patch.monthlyFeeCents ?? current.monthlyFeeCents,
                    notes: patch.notes ?? current.notes,
                    startedAt: current.startedAt || (patch.enabled ? now : undefined),
                };
            },
        );
        return merged;
    }

    private async ensureColumn(schemaName: string): Promise<void> {
        try {
            await this.prisma.executeInTenantSchema(schemaName, `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_verified BOOLEAN`, []);
        } catch { /* noop */ }
    }

    /** Resolution metrics for one tenant over a period. */
    async computeResolution(tenantId: string, start?: string, end?: string): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        await this.ensureColumn(schemaName);
        const { start: s, end: e } = this.monthRange(start, end);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                COUNT(*) FILTER (WHERE resolution_type IS NOT NULL)::int AS closed,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS ai_resolved,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved' AND resolution_verified = true)::int AS ai_verified
             FROM conversations
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [s, e],
        );
        const r = rows?.[0] || {};
        const closed = Number(r.closed) || 0;
        const aiResolved = Number(r.ai_resolved) || 0;
        const aiVerified = Number(r.ai_verified) || 0;
        return {
            periodStart: s,
            periodEnd: e,
            closed,
            aiResolved,
            aiVerified,
            resolutionRate: closed > 0 ? Math.round((aiResolved / closed) * 10000) / 100 : 0,
            verifiedResolutionRate: closed > 0 ? Math.round((aiVerified / closed) * 10000) / 100 : 0,
        };
    }

    private status(verifiedRate: number, target: number): 'met' | 'at_risk' | 'breached' {
        if (verifiedRate >= target) return 'met';
        if (verifiedRate >= target - 5) return 'at_risk';
        return 'breached';
    }

    /** All managed tenants with their current-period guarantee status. */
    async listManaged(start?: string, end?: string): Promise<any[]> {
        const tenants = await this.prisma.tenant.findMany({
            where: { settings: { path: ['managed', 'enabled'], equals: true } as any },
            select: { id: true, name: true, slug: true, settings: true },
        });

        const out: any[] = [];
        for (const tenant of tenants) {
            const cfg: ManagedConfig = (tenant.settings as any)?.managed || { enabled: true };
            const target = cfg.resolutionTargetPct ?? 70;
            let resolution: any = null;
            try {
                resolution = await this.computeResolution(tenant.id, start, end);
            } catch (e: any) {
                this.logger.warn(`[Managed] resolution failed for ${tenant.id}: ${e.message}`);
            }
            const verifiedRate = resolution?.verifiedResolutionRate ?? 0;
            out.push({
                tenantId: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                targetPct: target,
                monthlyFeeCents: cfg.monthlyFeeCents ?? null,
                startedAt: cfg.startedAt ?? null,
                notes: cfg.notes ?? null,
                resolution,
                deltaPct: resolution ? Math.round((verifiedRate - target) * 100) / 100 : null,
                status: resolution ? this.status(verifiedRate, target) : 'unknown',
            });
        }
        // Worst-status first for ops triage.
        const order: Record<string, number> = { breached: 0, at_risk: 1, met: 2, unknown: 3 };
        out.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        return out;
    }

    async getReport(tenantId: string, start?: string, end?: string): Promise<any> {
        const cfg = await this.getConfig(tenantId);
        const target = cfg.resolutionTargetPct ?? 70;
        const resolution = await this.computeResolution(tenantId, start, end);
        return {
            config: { ...cfg, resolutionTargetPct: target },
            resolution,
            deltaPct: Math.round((resolution.verifiedResolutionRate - target) * 100) / 100,
            status: this.status(resolution.verifiedResolutionRate, target),
        };
    }
}
