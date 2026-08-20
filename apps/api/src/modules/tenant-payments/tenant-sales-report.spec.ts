import { TenantSalesReportService } from './tenant-sales-report.service';

/**
 * Cómo va el negocio, en plata de verdad.
 *
 * Integramos el cobro y nadie lo contaba: la analítica del tenant medía
 * conversaciones y métricas de IA, pero no había una sola cifra de dinero.
 *
 * Lo que hace útil a este reporte es la distinción que casi nadie hace: **un
 * anticipo no es una venta cobrada**. Mezclarlos da una foto falsa en las dos
 * direcciones — infla el ingreso y esconde el saldo.
 */

function build(pagos: any[], ops: any[]) {
    const prisma: any = {
        getTenantSchemaName: jest.fn(async () => 'tenant_x'),
        executeInTenantSchema: jest.fn(async (_s: string, sql: string) =>
            sql.includes('tenant_payment_intents') ? pagos : ops),
    };
    return new TenantSalesReportService(prisma);
}

describe('el dinero que entró', () => {
    it('separa lo cobrado de lo devuelto y da el neto', async () => {
        const svc = build(
            [{ currency: 'COP', collected: '1000000', refunded: '150000', paid_count: 4 }],
            [],
        );

        const [r] = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(r.collectedCents).toBe(1000000);
        expect(r.refundedCents).toBe(150000);
        expect(r.netCents).toBe(850000);
    });

    it('el desglose SIEMPRE suma el cobrado', async () => {
        // Un desglose que no cuadra con su propio total es peor que no tenerlo:
        // por eso "pagos completos" se deriva en vez de contarse aparte.
        const svc = build(
            [{ currency: 'COP', collected: '1000000', refunded: '0', paid_count: 3 }],
            [{ currency: 'COP', deposits_taken: '300000', outstanding: '700000',
               with_deposit_count: 1, in_progress: '0', in_progress_count: 0, lost: '0', lost_count: 0 }],
        );

        const [r] = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(r.fromDepositsCents + r.fromFullPaymentsCents).toBe(r.collectedCents);
        expect(r.fromDepositsCents).toBe(300000);
        expect(r.fromFullPaymentsCents).toBe(700000);
    });
});

describe('lo que todavía no entró', () => {
    it('el saldo de un anticipo NO se cuenta como cobrado', async () => {
        // Es el error que hace inútil un reporte de ventas: contar 1.000.000
        // cuando en la cuenta hay 300.000.
        const svc = build(
            [{ currency: 'COP', collected: '300000', refunded: '0', paid_count: 1 }],
            [{ currency: 'COP', deposits_taken: '300000', outstanding: '700000',
               with_deposit_count: 1, in_progress: '0', in_progress_count: 0, lost: '0', lost_count: 0 }],
        );

        const [r] = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(r.collectedCents).toBe(300000);
        expect(r.outstandingCents).toBe(700000);
    });

    it('lo que está esperando pago no es venta todavía', async () => {
        const svc = build(
            [],
            [{ currency: 'COP', deposits_taken: '0', outstanding: '0', with_deposit_count: 0,
               in_progress: '450000', in_progress_count: 2, lost: '0', lost_count: 0 }],
        );

        const [r] = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(r.inProgressCents).toBe(450000);
        expect(r.collectedCents).toBe(0);
        expect(r.counts.inProgress).toBe(2);
    });

    it('muestra lo perdido, que es lo que enseña', async () => {
        // Retenciones vencidas sin pagar: la venta que el negocio no cerró.
        const svc = build(
            [],
            [{ currency: 'COP', deposits_taken: '0', outstanding: '0', with_deposit_count: 0,
               in_progress: '0', in_progress_count: 0, lost: '2000000', lost_count: 3 }],
        );

        const [r] = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(r.lostCents).toBe(2000000);
        expect(r.counts.lost).toBe(3);
    });
});

describe('multi-moneda', () => {
    it('nunca suma monedas distintas', async () => {
        // Sumar COP y USD daría un número sin significado.
        const svc = build(
            [{ currency: 'COP', collected: '1000000', refunded: '0', paid_count: 2 },
             { currency: 'USD', collected: '20000', refunded: '0', paid_count: 1 }],
            [],
        );

        const filas = await svc.getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(filas).toHaveLength(2);
        expect(filas.map(f => f.currency).sort()).toEqual(['COP', 'USD']);
    });
});

describe('robustez', () => {
    it('un fallo leyendo no tumba el reporte entero', async () => {
        // Media foto es mejor que un error: el dueño ve lo que sí se pudo leer.
        const prisma: any = {
            getTenantSchemaName: jest.fn(async () => 'tenant_x'),
            executeInTenantSchema: jest.fn(async (_s: string, sql: string) => {
                if (sql.includes('tenant_payment_intents')) throw new Error('tabla ausente');
                return [{ currency: 'COP', deposits_taken: '0', outstanding: '0', with_deposit_count: 0,
                          in_progress: '100', in_progress_count: 1, lost: '0', lost_count: 0 }];
            }),
        };

        const filas = await new TenantSalesReportService(prisma).getMoneySummary('t1', '2026-08-01', '2026-08-31');

        expect(filas[0].inProgressCents).toBe(100);
        expect(filas[0].collectedCents).toBe(0);
    });
});
