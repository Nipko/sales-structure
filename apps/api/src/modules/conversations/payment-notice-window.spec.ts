import { PaymentOutcomeNotifierService } from './payment-outcome-notifier.service';

/**
 * La ventana de 24h de WhatsApp.
 *
 * Meta sólo deja escribir libre dentro de las 24h desde el último mensaje DEL
 * CLIENTE. Con la retención de 20 minutos el caso normal entra holgado, pero un
 * pago que se acredita tarde cae fuera y el aviso se pierde: el cliente pagó y
 * nunca supo que su reserva quedó firme.
 */

const HORA = 60 * 60 * 1000;

function build(row: any) {
    const prisma: any = {
        getTenantSchemaName: jest.fn(async () => 'tenant_x'),
        executeInTenantSchema: jest.fn(async () => (row ? [row] : [])),
    };
    const outbound: any = { enqueue: jest.fn(async () => undefined) };
    const email: any = { send: jest.fn(async () => true) };
    return {
        service: new PaymentOutcomeNotifierService(prisma, outbound, email),
        outbound, email,
    };
}

const BASE = {
    conversation_id: 'conv-1',
    channel_type: 'whatsapp',
    channel_account_id: 'acc-1',
    external_id: '573208010737',
    email: 'huesped@example.com',
    name: 'Nir',
};

const INPUT = { tenantId: 't1', conversationId: 'conv-1', text: 'Tu pago entró', dedupeId: 'd1' };

describe('dentro de la ventana', () => {
    it('escribe por WhatsApp, que es donde el cliente está', async () => {
        const { service, outbound, email } = build({ ...BASE, last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        expect(outbound.enqueue).toHaveBeenCalledTimes(1);
        expect(email.send).not.toHaveBeenCalled();
    });
});

describe('fuera de la ventana', () => {
    it('cae a email en vez de mandar algo que Meta va a rechazar', async () => {
        const { service, outbound, email } = build({ ...BASE, last_inbound_at: new Date(Date.now() - 30 * HORA) });

        await service.notifyCustomer(INPUT);

        expect(outbound.enqueue).not.toHaveBeenCalled();
        expect(email.send).toHaveBeenCalledTimes(1);
        expect(email.send.mock.calls[0][0].to).toBe('huesped@example.com');
    });

    it('sin email, no finge: devuelve false y deja el rastro', async () => {
        const { service, outbound, email } = build({
            ...BASE, email: null, last_inbound_at: new Date(Date.now() - 30 * HORA),
        });

        await expect(service.notifyCustomer(INPUT)).resolves.toBe(false);
        expect(outbound.enqueue).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });

    it('una conversación sin mensajes del cliente se trata como fuera', async () => {
        // Nunca escribió: no hay ventana abierta que aprovechar.
        const { service, outbound, email } = build({ ...BASE, last_inbound_at: null });

        await service.notifyCustomer(INPUT);

        expect(outbound.enqueue).not.toHaveBeenCalled();
        expect(email.send).toHaveBeenCalledTimes(1);
    });
});

describe('los demás canales no tienen ventana', () => {
    it('un widget viejo se sigue respondiendo por el widget', async () => {
        // La regla es de Meta, no nuestra: aplicarla a Telegram o al chat web
        // mandaría a email conversaciones que están perfectamente abiertas.
        const { service, outbound, email } = build({
            ...BASE, channel_type: 'telegram', last_inbound_at: new Date(Date.now() - 200 * HORA),
        });

        await service.notifyCustomer(INPUT);

        expect(outbound.enqueue).toHaveBeenCalledTimes(1);
        expect(email.send).not.toHaveBeenCalled();
    });
});
