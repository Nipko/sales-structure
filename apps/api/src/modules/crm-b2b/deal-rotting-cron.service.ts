import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';

const DEFAULT_ROTTING_DAYS = 14;
const OPEN = `won_at IS NULL AND o.lost_at IS NULL`;

/**
 * Deal rotting detector (T3.21). Every 6h, flags open opportunities with no
 * movement for ≥ rottingDays (per-tenant override via tenant.settings.crm.rottingDays)
 * and emits `crm.deal_rotting` for newly-stale deals (deduped via metadata.is_rotting).
 * El docstring decia "idempotente aunque el cron dispare en varios procesos"
 * y NO lo era: el ciclo es SELECT (los que aun no estan marcados) -> UPDATE ->
 * emit, asi que la API y el worker leian las mismas filas antes de que ninguno
 * escribiera y ambos emitian el evento crm.deal_rotting. El dueño recibia la
 * alerta de negocio duplicada por cada oportunidad estancada.
 *
 * Ahora corre en UNA sola instancia via CronLockService, como los otros 28.
 */
@Injectable()
export class DealRottingCronService {
    private readonly logger = new Logger(DealRottingCronService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('0 */6 * * *')
    async detectRottingCron(): Promise<void> {
        await this.cronLock.runExclusive('crm-b2b.detectRotting', 1800, () => this.detectRotting());
    }

    async detectRotting(): Promise<void> {
        let tenants: any[] = [];
        try {
            tenants = await this.prisma.$queryRaw<any[]>`SELECT id, schema_name, settings FROM tenants WHERE is_active = true`;
        } catch (e: any) {
            this.logger.error(`[Rotting] tenant list failed: ${e.message}`);
            return;
        }

        for (const tenant of tenants) {
            try {
                await this.detectForTenant(tenant.id, tenant.schema_name, tenant.settings);
            } catch (e: any) {
                this.logger.warn(`[Rotting] tenant ${tenant.id} failed: ${e.message}`);
            }
        }
    }

    private async detectForTenant(tenantId: string, schemaName: string, settings: any): Promise<void> {
        if (!schemaName) return;
        const rottingDays = Number(settings?.crm?.rottingDays) > 0 ? Number(settings.crm.rottingDays) : DEFAULT_ROTTING_DAYS;

        // Newly stale opportunities not yet flagged.
        let stale: any[] = [];
        try {
            stale = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT o.id, o.stage, o.estimated_value, o.currency, o.lead_id,
                        FLOOR(EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 86400)::int AS days_stale
                 FROM opportunities o
                 WHERE o.${OPEN}
                   AND o.updated_at < NOW() - ($1 || ' days')::interval
                   AND COALESCE((o.metadata->>'is_rotting')::boolean, false) = false
                 LIMIT 200`,
                [String(rottingDays)],
            );
        } catch (e: any) {
            // opportunities table may not exist for very new tenants
            return;
        }
        if (!stale.length) return;

        for (const opp of stale) {
            try {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE opportunities
                     SET metadata = jsonb_set(jsonb_set(COALESCE(metadata, '{}'::jsonb), '{is_rotting}', 'true'::jsonb, true),
                                              '{rotting_since}', to_jsonb(NOW()::text), true)
                     WHERE id = $1::uuid`,
                    [opp.id],
                );
                this.eventEmitter.emit('crm.deal_rotting', {
                    tenantId,
                    opportunityId: opp.id,
                    leadId: opp.lead_id,
                    stage: opp.stage,
                    value: Number(opp.estimated_value) || 0,
                    daysStale: Number(opp.days_stale) || 0,
                });
            } catch (e: any) {
                this.logger.debug(`[Rotting] flag ${opp.id} failed: ${e.message}`);
            }
        }
        this.logger.log(`[Rotting] tenant ${tenantId}: flagged ${stale.length} rotting deal(s) (>${rottingDays}d)`);
    }
}
