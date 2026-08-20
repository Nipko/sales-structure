import { ExpiredHoldSweeperService } from './expired-hold-sweeper.service';

/**
 * El barrido de retenciones vencidas.
 *
 * Lo que NO hace, y conviene que quede fijado: no libera fechas. El cupo se
 * libera solo, por reloj, en el predicado de ocupación — vencido
 * `hold_expires_at` la fila deja de ocupar aunque este cron no corra nunca.
 * Acá sólo se ordena el estado, para que una reserva abandonada deje de figurar
 * como "esperando el pago" tres días después.
 */

function build(rowsPerQuery: any[] = []) {
    const executeInTenantSchema = jest.fn(async (_schema: string, _sql: string) => rowsPerQuery);
    const prisma: any = {
        tenant: { findMany: jest.fn(async () => [{ schemaName: 'tenant_a' }, { schemaName: 'tenant_b' }]) },
        executeInTenantSchema,
    };
    const cronLock: any = { runExclusive: jest.fn(async (_n, _t, fn) => fn()) };
    return { service: new ExpiredHoldSweeperService(prisma, cronLock), prisma, cronLock, executeInTenantSchema };
}

describe('barrido de retenciones vencidas', () => {
    it('sólo toca lo que TUVO reloj y ya venció', async () => {
        // Sin `hold_expires_at IS NOT NULL` marcaría como vencidas las filas
        // anteriores a la retención, que nunca tuvieron reloj y siguen
        // esperando un pago legítimamente.
        const { service, executeInTenantSchema } = build();

        await service.sweep();

        const sql = executeInTenantSchema.mock.calls[0][1] as string;
        expect(sql).toContain("status = 'pending_payment'");
        expect(sql).toContain('hold_expires_at IS NOT NULL');
        expect(sql).toContain('hold_expires_at < NOW()');
        expect(sql).toContain("SET status = 'expired'");
    });

    it('barre las dos verticales en cada tenant', async () => {
        const { service, executeInTenantSchema } = build();

        await service.sweep();

        const tablas = executeInTenantSchema.mock.calls.map(c => String(c[1]));
        expect(tablas.filter(s => s.includes('property_bookings'))).toHaveLength(2);
        expect(tablas.filter(s => s.includes('appointments'))).toHaveLength(2);
    });

    it('un tenant que falla no frena a los demás', async () => {
        const { service, prisma } = build();
        let n = 0;
        prisma.executeInTenantSchema = jest.fn(async (_schema: string, _sql: string) => {
            n++;
            if (n === 1) throw new Error('schema roto');
            return [];
        });

        await expect(service.sweep()).resolves.toBeUndefined();
        expect(prisma.executeInTenantSchema).toHaveBeenCalledTimes(4);
    });

    it('corre bajo lock: todo @Cron se dispara dos veces en esta plataforma', async () => {
        const { service, cronLock } = build();

        await service.sweepCron();

        expect(cronLock.runExclusive).toHaveBeenCalledWith(
            'expired-payment-holds', 300, expect.any(Function),
        );
    });
});
