import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';

/**
 * Deja en `expired` las retenciones que nadie pagó.
 *
 * IMPORTANTE, para que nadie le atribuya un poder que no tiene: **este barrido
 * NO libera fechas**. El cupo se libera solo, por reloj, en el predicado de
 * ocupación (`holdStillAliveSql`): vencido `hold_expires_at`, la fila deja de
 * ocupar aunque este cron no corra nunca. Esa fue la decisión de diseño y sigue
 * en pie.
 *
 * Lo que hace es limpieza y honestidad de estado. Sin él, una reserva abandonada
 * queda para siempre en `pending_payment`, que significa "esperando el pago" —
 * y a los tres días eso ya no es cierto. Ensucia la pestaña de Reservas, ensucia
 * lo que el agente lee como operación activa, y ensucia cualquier métrica que
 * cuente pendientes.
 *
 * Por eso mismo puede fallar sin consecuencias: si el cron muere, lo único que
 * pasa es que queda basura visible. Nadie pierde una fecha ni un cobro.
 */
@Injectable()
export class ExpiredHoldSweeperService {
    private readonly logger = new Logger(ExpiredHoldSweeperService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cronLock: CronLockService,
    ) {}

    // Cada 10 minutos: la retención dura 15, así que una vencida se marca en el
    // siguiente barrido. No hace falta más frecuencia — no hay nada urgente que
    // liberar, sólo estado que ordenar.
    @Cron('*/10 * * * *')
    async sweepCron(): Promise<void> {
        // Todo @Cron corre DOS veces en esta plataforma (API y worker comparten
        // AppModule). Sin el lock, dos barridos compiten por las mismas filas.
        await this.cronLock.runExclusive('expired-payment-holds', 300, () => this.sweep());
    }

    async sweep(): Promise<void> {
        let tenants: Array<{ schemaName: string }> = [];
        try {
            tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { schemaName: true },
            });
        } catch (e: any) {
            this.logger.error(`[Retenciones] no se pudo listar tenants: ${e.message}`);
            return;
        }

        for (const { schemaName } of tenants) {
            if (!schemaName) continue;
            for (const table of ['property_bookings', 'appointments']) {
                try {
                    // El `hold_expires_at IS NOT NULL` no es decorativo: sin él
                    // se marcarían como vencidas las filas anteriores a la
                    // retención, que nunca tuvieron reloj y siguen esperando un
                    // pago legítimamente.
                    const rows = await this.prisma.executeInTenantSchema<any[]>(
                        schemaName,
                        `UPDATE ${table}
                            SET status = 'expired', updated_at = NOW()
                          WHERE status = 'pending_payment'
                            AND hold_expires_at IS NOT NULL
                            AND hold_expires_at < NOW()
                          RETURNING id`,
                    );
                    if (rows?.length) {
                        this.logger.log(
                            `[Retenciones] ${rows.length} sin pagar vencieron en ${schemaName}.${table}`,
                        );
                    }
                } catch (e: any) {
                    // Un tenant que falla no puede frenar a los demás: el barrido
                    // es best-effort por definición.
                    this.logger.warn(`[Retenciones] ${schemaName}.${table}: ${e.message}`);
                }
            }
        }
    }
}
