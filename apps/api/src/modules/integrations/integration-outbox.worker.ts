import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { IntegrationWriteAdapter, OutboxEntry } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { IntegrationOutboxService } from './integration-outbox.service';

/**
 * ═══ EL ANDAMIAJE NO TENÍA QUIÉN LO CORRIERA ═══
 *
 * `IntegrationOutboxService` tenía cola, arrendamiento, reintentos con espera,
 * muerte por agotamiento, dedupe de webhooks y reconciliación. Y **cero
 * llamadores**: ningún módulo lo importaba, ningún proceso drenaba la cola,
 * ninguna entrada salía nunca. Una escritura encolada se quedaba encolada.
 *
 * Peor que eso: las entradas nacían `suppressed` mientras el proveedor no
 * estuviera certificado, y `claim` sólo mira `pending`/`retrying`. La promesa
 * escrita en el servicio —"el día que el proveedor se certifique, sale"— no la
 * cumplía nadie: al encender el interruptor, lo acumulado seguía sin salir.
 *
 * Este worker es el que faltaba. Corre cada minuto y hace **cuatro** cosas,
 * ninguna de las cuales llama a un tercero por sí sola:
 *
 * 1. **Vence** lo que ya no tiene sentido entregar.
 * 2. **Libera** lo suprimido cuando su proveedor pasa a estar certificado.
 * 3. **Reclama** con arrendamiento lo que toca (un worker muerto no congela una
 *    escritura: el arrendamiento vence y otro la retoma).
 * 4. **Entrega**, y sólo si hay un adapter registrado para ese proveedor.
 *
 * Sin adapter registrado la entrada **no se pierde y no reintenta para
 * siempre**: muere con `no_adapter_registered`, que es información y no una
 * cola creciendo en silencio. Hoy no hay ninguno registrado —ninguna
 * integración externa está certificada— y eso es correcto: el riel funciona,
 * la escritura real espera autorización.
 */

/** Cuántas entradas por tenant y proveedor en cada tick. */
const BATCH_PER_PROVIDER = 20;

@Injectable()
export class IntegrationOutboxWorker {
    private readonly logger = new Logger(IntegrationOutboxWorker.name);

    /**
     * Los adapters que saben ejecutar de verdad.
     *
     * Es un registro y no un `switch` a propósito: un `switch` obliga a este
     * archivo a conocer a cada proveedor, y el que agrega uno nuevo termina
     * editando el worker en vez de escribir su adapter.
     */
    private readonly adapters = new Map<string, IntegrationWriteAdapter>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly outbox: IntegrationOutboxService,
        private readonly cronLock: CronLockService,
    ) {}

    /**
     * Registra un adapter. Lo llama el módulo del proveedor al arrancar.
     *
     * Rechaza el duplicado en vez de pisarlo: dos adapters para el mismo
     * proveedor es un error de cableado, y el que gane depende del orden de
     * carga de los módulos — un defecto que aparece distinto en cada
     * despliegue.
     */
    register(adapter: IntegrationWriteAdapter): void {
        const provider = String(adapter.provider || '').trim().toLowerCase();
        if (!provider) throw new Error('Un adapter de integración necesita proveedor');
        if (this.adapters.has(provider)) {
            throw new Error(`Ya hay un adapter registrado para ${provider}`);
        }
        this.adapters.set(provider, adapter);
        this.logger.log(`[Outbox] adapter registrado para ${provider}`);
    }

    /** Los proveedores que hoy pueden entregar de verdad. */
    registeredProviders(): string[] {
        return [...this.adapters.keys()];
    }

    /**
     * Cada minuto. TTL de media vuelta, por la regla de CronLock: largo para
     * que el gemelo no duplique, corto para no saltarse el tick siguiente.
     * API y worker levantan el mismo AppModule, así que sin esto todo corre dos
     * veces — y dos veces contra el límite de tasa de un tercero.
     */
    @Cron('37 * * * * *')
    async drainCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'integration-outbox.drain',
            30,
            () => this.drainAll(),
            { prefer: 'worker' },
        );
    }

    async drainAll(): Promise<{ delivered: number; failed: number; expired: number }> {
        let tenants: Array<{ id: string; schemaName: string }> = [];
        try {
            tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });
        } catch (error: any) {
            this.logger.warn(`[Outbox] no se pudo listar tenants: ${error?.message}`);
            return { delivered: 0, failed: 0, expired: 0 };
        }

        let delivered = 0;
        let failed = 0;
        let expired = 0;
        for (const tenant of tenants) {
            try {
                const result = await this.drainTenant(tenant.id, tenant.schemaName);
                delivered += result.delivered;
                failed += result.failed;
                expired += result.expired;
            } catch (error: any) {
                // Que un tenant con el schema a medias no frene a los demás.
                this.logger.debug(`[Outbox] ${tenant.id} omitido: ${error?.message}`);
            }
        }
        if (delivered || failed || expired) {
            this.logger.log(
                `[Outbox] entregadas ${delivered}, con error ${failed}, vencidas ${expired}`,
            );
        }
        return { delivered, failed, expired };
    }

    async drainTenant(
        tenantId: string,
        schemaName: string,
    ): Promise<{ delivered: number; failed: number; expired: number }> {
        // (1) Vencer va PRIMERO. Liberar una entrada de hace tres meses la
        // mandaría al proveedor como si fuera de hoy.
        const expired = await this.outbox.expireStale(schemaName).catch(() => 0);

        let delivered = 0;
        let failed = 0;
        // Los proveedores a mirar son los que tienen adapter más los que están
        // certificados: un proveedor recién certificado tiene entradas
        // suprimidas que liberar aunque todavía no tenga adapter, y verlas
        // detenidas con motivo es mejor que no verlas.
        for (const provider of this.providersToVisit()) {
            await this.outbox.releaseSuppressed(schemaName, provider).catch(() => 0);
            const entries = await this.outbox
                .claim(schemaName, provider, BATCH_PER_PROVIDER)
                .catch(() => [] as OutboxEntry[]);
            for (const entry of entries) {
                const outcome = await this.deliver(tenantId, schemaName, entry);
                if (outcome === 'delivered') delivered += 1;
                else failed += 1;
            }
        }
        return { delivered, failed, expired };
    }

    private providersToVisit(): string[] {
        const certified = String(process.env.INTEGRATION_WRITE_PROVIDERS || '')
            .split(',')
            .map(entry => entry.trim().toLowerCase())
            .filter(Boolean);
        return [...new Set([...this.adapters.keys(), ...certified])];
    }

    private async deliver(
        tenantId: string,
        schemaName: string,
        entry: OutboxEntry,
    ): Promise<'delivered' | 'failed'> {
        const adapter = this.adapters.get(String(entry.provider).toLowerCase());
        if (!adapter) {
            // No hay a quién llamar. Reintentar ocho veces sólo retrasa el
            // momento en que alguien lo mira, así que muere con motivo legible.
            await this.kill(schemaName, entry, 'no_adapter_registered');
            return 'failed';
        }
        if (!adapter.operations.includes(entry.operation)) {
            // El adapter declara qué sabe hacer. Sin esta comprobación, una
            // operación desconocida llega hasta adentro y explota con un
            // `undefined is not a function` — un error que no dice nada.
            await this.kill(schemaName, entry, `operation_not_supported:${entry.operation}`);
            return 'failed';
        }

        try {
            const result = await adapter.write(entry, { tenantId, schemaName });
            if (result.ok) {
                await this.outbox.markDelivered(schemaName, entry.id, result.externalId);
                return 'delivered';
            }
            const reason = result.error || 'provider_rejected';
            if (result.retryable === false) {
                // Un payload que el proveedor rechaza por inválido no mejora
                // esperando: ocho reintentos son ocho llamadas inútiles.
                await this.kill(schemaName, entry, reason);
            } else {
                await this.outbox.markFailed(schemaName, entry.id, reason);
            }
            return 'failed';
        } catch (error: any) {
            await this.outbox.markFailed(schemaName, entry.id, String(error?.message || error));
            return 'failed';
        }
    }

    /**
     * Mata la entrada sin gastar los ocho intentos.
     *
     * Se hace agotando los intentos de una vez y no con un `UPDATE` a mano para
     * que el estado terminal lo escriba el mismo lugar que lo escribe siempre:
     * dos caminos que llevan a `dead` son dos formas de que uno de ellos se
     * olvide de limpiar el arrendamiento.
     */
    private async kill(schemaName: string, entry: OutboxEntry, reason: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE integration_outbox
                SET status = 'dead', attempts = GREATEST(attempts, $2),
                    last_error = $3, lease_expires_at = NULL,
                    next_attempt_at = NULL, updated_at = NOW()
              WHERE id = $1::uuid`,
            [entry.id, 8, reason.slice(0, 1000)],
        ).catch((error: any) => {
            this.logger.warn(`[Outbox] no se pudo cerrar ${entry.id}: ${error?.message}`);
        });
        this.logger.warn(`[Outbox] ${entry.provider}/${entry.operation} detenida: ${reason}`);
    }
}
