import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AIToolExecutorService } from './ai-tool-executor.service';

/**
 * El agente tiene que saber si un servicio exige pago ANTES de agendarlo.
 *
 * En alojamiento ya lo recibía al consultar disponibilidad. En citas no lo veía
 * en ningún lado: la política se resolvía al CREAR, así que el agente se
 * enteraba de que había que cobrar después de haber agendado — el mismo orden
 * invertido que todo este trabajo vino a corregir.
 */

function build(servicios: any[]) {
    const prisma: any = { $queryRawUnsafe: jest.fn(async () => servicios) };
    const service = Object.create(AIToolExecutorService.prototype);
    service.prisma = prisma;
    return { service, prisma };
}

const SERVICIO_CON_SENA = {
    id: 's1', name: 'Sesión de fotos', description: null,
    duration_minutes: 60, buffer_minutes: 0, price: '400000', currency: 'COP',
    duration_type: 'fixed', duration_minutes_max: null,
    payment_policy: 'deposit', deposit_percent: 30, deposit_amount: null,
};

const SERVICIO_SIN_PAGO = {
    ...SERVICIO_CON_SENA, id: 's2', name: 'Consulta',
    payment_policy: 'none', deposit_percent: null,
};

describe('list_services le dice al agente cómo cobrar', () => {
    it('marca que exige pago y cuánto', async () => {
        const { service } = build([SERVICIO_CON_SENA]);

        const out = await (service as any).listServices('tenant_x');
        const s = out.services[0];

        expect(s.requiresPaymentToConfirm).toBe(true);
        expect(s.amountDueToConfirm).toBe(120000); // 30% de 400.000
    });

    it('incluye la instrucción de cómo proceder, no sólo el dato', async () => {
        // Los flags dicen QUÉ pasa; sin la nota el modelo tiene que deducir el
        // procedimiento, y eso es justo lo que hace mal.
        const { service } = build([SERVICIO_CON_SENA]);

        const s = (await (service as any).listServices('tenant_x')).services[0];

        expect(s.paymentNote).toContain('anticipo');
        expect(s.paymentNote).toContain('No lo des por confirmado');
        expect(s.paymentNote).toContain('20 minutos');
    });

    it('un servicio sin pago no arrastra ruido', async () => {
        const { service } = build([SERVICIO_SIN_PAGO]);

        const s = (await (service as any).listServices('tenant_x')).services[0];

        expect(s.requiresPaymentToConfirm).toBe(false);
        expect(s.paymentNote).toBeUndefined();
    });

    it('sigue devolviendo lo de siempre', async () => {
        // La política se suma; no reemplaza nada de lo que el agente ya usaba.
        const { service } = build([SERVICIO_CON_SENA]);

        const s = (await (service as any).listServices('tenant_x')).services[0];

        expect(s).toMatchObject({ id: 's1', name: 'Sesión de fotos', price: 400000, currency: 'COP' });
    });
});

describe('la consulta trae las columnas', () => {
    it('selecciona la política, o todo lo anterior sería NULL', () => {
        const SRC = readFileSync(resolve(__dirname, 'ai-tool-executor.service.ts'), 'utf8');
        const q = SRC.slice(SRC.indexOf('private async listServices'), SRC.indexOf('private async listServices') + 900);
        expect(q).toContain('payment_policy, deposit_percent, deposit_amount');
    });
});
