import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { isolatedEvalNamespaceForPrisma } from './isolated-eval-namespace';

/** El mismo contrato de nombre que `isolated-eval-namespace`, repetido aquí a propósito:
 * si alguien lo cambia allá y no acá, este barrido deja de encontrar nada y se
 * nota, en vez de borrar un schema que no le corresponde. */
const EVAL_NAMESPACE = /^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/;

/**
 * Recoger las réplicas de "Probar agente" que quedaron vencidas.
 *
 * `IsolatedEvalNamespace.reapExpired` ya existe, pero es perezosa y por tenant:
 * sólo limpia cuando ESE mismo tenant vuelve a lanzar una prueba. Una corrida
 * que murió a la mitad —un reinicio del contenedor en pleno deploy es el caso
 * normal— deja su réplica hasta que alguien pruebe el agente de ese negocio
 * otra vez. Si no lo hace, queda para siempre: una copia parcial del
 * conocimiento del cliente ocupando espacio y ensuciando cada arranque.
 *
 * Esto cierra ese hueco barriendo TODAS, sin depender de que alguien vuelva.
 */
@Injectable()
export class EvalNamespaceReaperService {
    private readonly logger = new Logger(EvalNamespaceReaperService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cronLock: CronLockService,
    ) {}

    // Con candado: en este repo la API y el worker comparten AppModule, así que
    // todo `@Cron` corre dos veces.
    @Cron('23 * * * *')
    async reapExpiredNamespacesCron(): Promise<void> {
        await this.cronLock.runExclusive('eval-namespace.reapExpired', 3600, async () => {
            const { reaped, unclaimable } = await this.reapExpiredNamespaces();
            if (reaped > 0) {
                this.logger.log(`[EvalNamespace] ${reaped} réplica(s) de prueba vencida(s) recogida(s)`);
            }
            if (unclaimable.length > 0) {
                // Sin la tabla marcadora no se puede probar de quién es, y borrar
                // un schema que no se puede atribuir no se hace. Se dice en voz
                // alta para que un operador lo mire, en vez de crecer callado.
                this.logger.warn(
                    `[EvalNamespace] ${unclaimable.length} schema(s) con forma de réplica y sin marcador de dueño, `
                    + `no se tocan: ${unclaimable.slice(0, 10).join(', ')}`,
                );
            }
        });
    }

    /** Devuelve cuántas recogió y cuáles no pudo atribuir. Idempotente. */
    async reapExpiredNamespaces(): Promise<{ reaped: number; unclaimable: string[] }> {
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT nspname::text AS nspname FROM pg_namespace
              WHERE nspname ~ '^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$'
              ORDER BY nspname LIMIT 500`,
        ) as Array<{ nspname: string }>;

        const namespaces = isolatedEvalNamespaceForPrisma(this.prisma);
        const unclaimable: string[] = [];
        let reaped = 0;

        for (const { nspname } of rows) {
            // El catálogo ya filtró por la expresión, pero el nombre se
            // interpola más abajo: se vuelve a comprobar acá antes de hacerlo.
            if (!EVAL_NAMESPACE.test(nspname)) continue;
            try {
                const marker = await this.prisma.$queryRawUnsafe(
                    'SELECT to_regclass($1)::text AS name', `"${nspname}".__eval_namespace`,
                ) as Array<{ name: string | null }>;
                if (!marker[0]?.name) { unclaimable.push(nspname); continue; }

                const lease = await this.prisma.$queryRawUnsafe(
                    `SELECT tenant_id::text AS "tenantId", owner_token::text AS token,
                            source_schema AS "sourceSchema", expires_at
                       FROM "${nspname}".__eval_namespace
                      WHERE expires_at < clock_timestamp()`,
                ) as Array<{ tenantId: string; token: string; sourceSchema: string; expires_at: Date }>;
                // Cero = sigue viva, y una prueba en curso no se interrumpe.
                // Más de una = no se puede decir quién manda; se deja quieta.
                if (lease.length !== 1) continue;

                await namespaces.dispose({
                    schemaName: nspname,
                    sourceSchema: lease[0].sourceSchema,
                    tenantId: lease[0].tenantId,
                    token: lease[0].token,
                    expiresAt: new Date(lease[0].expires_at).toISOString(),
                    tables: [],
                });
                reaped++;
            } catch (error: any) {
                // Una réplica que no se deja recoger no puede frenar a las
                // demás; vuelve a intentarse a la hora siguiente.
                this.logger.error(`[EvalNamespace] no se pudo recoger ${nspname}: ${error?.message}`);
            }
        }

        return { reaped, unclaimable };
    }
}
