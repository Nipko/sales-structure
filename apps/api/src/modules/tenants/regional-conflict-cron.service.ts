import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { RegionalProfileService } from './regional-profile.service';

/**
 * El llamador que `queueConflictsForReview` no tenía.
 *
 * El servicio sabía detectar conflictos regionales —moneda que no corresponde
 * al país, país de facturación distinto del país escrito en Business Info— y
 * sabía guardarlos. Nadie lo llamaba nunca, así que `regional_identity_reviews`
 * estaba **permanentemente vacía** y la pantalla de revisión no habría tenido
 * nada que mostrar aunque existiera. Un detector sin disparador es una función
 * que compila.
 *
 * Corre de noche y por tenant activo. Es deliberadamente lento y barato:
 * detectar un conflicto no es urgente —las señales que lo producen cambian
 * cuando alguien edita la configuración, no solas— y `queueConflictsForReview`
 * es idempotente: actualiza la revisión pendiente en vez de acumular filas.
 */
@Injectable()
export class RegionalConflictCronService {
    private readonly logger = new Logger(RegionalConflictCronService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly regional: RegionalProfileService,
        private readonly cronLock: CronLockService,
    ) {}

    /** 3:40 AM. Cada @Cron corre en API y worker: el lock elige uno. */
    @Cron('40 3 * * *')
    async detectConflicts(): Promise<void> {
        await this.cronLock.runExclusive(
            'regional.conflicts',
            3600,
            () => this.sweep(),
            { prefer: 'worker' },
        );
    }

    async sweep(): Promise<{ scanned: number; queued: number }> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true },
        });

        let queued = 0;
        for (const tenant of tenants) {
            try {
                queued += await this.regional.queueConflictsForReview(tenant.id);
            } catch (error: any) {
                // Un tenant que falla no puede parar el barrido de los demás.
                this.logger.warn(`[Regional] barrido falló para ${tenant.id}: ${error?.message}`);
            }
        }
        if (queued) {
            this.logger.log(`[Regional] ${queued} conflicto(s) en ${tenants.length} tenants`);
        }
        return { scanned: tenants.length, queued };
    }
}
