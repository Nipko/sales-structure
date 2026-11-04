import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { ReadinessService } from './readiness.service';

/**
 * Evaluación programada de la preparación (decisión del dueño, 4-nov): cada tenant activo se evalúa cada 6 horas,
 * aunque nadie abra el panel ni converse. Así el veredicto, los bloqueantes y las alarmas (modo de reserva por defecto)
 * están al día en Inicio y en el historial de todos los negocios, no solo de los que usan el panel. El historial
 * guarda una fila solo cuando el resultado cambia (ReadinessService.persist).
 */
@Injectable()
export class ReadinessScheduler {
    private readonly logger = new Logger(ReadinessScheduler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly readiness: ReadinessService,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('0 */6 * * *')
    async evaluateAllCron(): Promise<void> {
        await this.cronLock.runExclusive('readiness.evaluateAll', 1800, () => this.evaluateAll());
    }

    /** Evalúa los tenants activos de a uno; un tenant que falla no detiene a los demás. */
    async evaluateAll(): Promise<{ evaluated: number; failed: number }> {
        const tenants = await this.prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
        let evaluated = 0;
        let failed = 0;
        for (const tenant of tenants) {
            try {
                await this.readiness.evaluateTenant(tenant.id, 'scheduled');
                evaluated++;
            } catch (err) {
                failed++;
                this.logger.warn(`readiness: evaluación programada falló para ${tenant.id}: ${(err as Error).message}`);
            }
        }
        if (failed) this.logger.warn(`readiness: evaluación programada ${evaluated} ok, ${failed} con error`);
        return { evaluated, failed };
    }
}
