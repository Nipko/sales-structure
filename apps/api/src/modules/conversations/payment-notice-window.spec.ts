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

describe('qué dice el trabajo sobre sí mismo', () => {
    /**
     * ═══ UN AVISO DE PAGO ES UNA RESPUESTA, NO UNA CAMPAÑA ═══
     *
     * La autoridad económica lee `disposition` DEL TRABAJO: uno que lleva
     * conversación es una respuesta dentro de ella, uno que no lleva ninguna
     * es una campaña, un recordatorio o un paso de goteo
     * (`outbound-queue.processor.ts`, la última admisión del carril legado).
     *
     * Este productor TENÍA la conversación — la consulta de arriba la trae, y
     * el chequeo de las 24h es la razón entera de llegar hasta el enqueue — y
     * no la pasaba. Así que una respuesta de servicio dentro de la ventana se
     * cobraba como proactiva, y lo proactivo es exactamente lo que pausa el
     * freno suave: un tenant cerca de su techo habría retenido la
     * confirmación de un pago YA acreditado. R4 no lo deja: una pausa por
     * presupuesto no cancela pedidos ni borra respuestas.
     *
     * Se afirma sobre el trabajo encolado porque es el único lugar donde el
     * dato existe antes de que lo lea el procesador.
     */
    it('lleva la conversación, que es lo que la hace reactiva', async () => {
        const { service, outbound } = build({
            ...BASE, contact_id: 'contact-9', last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        const job = outbound.enqueue.mock.calls[0][0];
        expect(job.metadata?.conversationId).toBe('conv-1');
        // La regla del procesador, escrita acá tal cual para que se vea qué
        // decide el campo: sin conversación habría sido 'proactive'.
        expect(job.metadata?.conversationId ? 'reactive' : 'proactive').toBe('reactive');
    });

    it('lleva el contacto, que es el alcance que acota un bucle', async () => {
        // El techo por contacto está keyeado por contacto. Sin él este
        // productor queda fuera del único alcance que puede frenar una
        // conversación desbocada.
        const { service, outbound } = build({
            ...BASE, contact_id: 'contact-9', last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        expect(outbound.enqueue.mock.calls[0][0].metadata?.contactId).toBe('contact-9');
    });

    it('no inventa un contacto cuando la fila no lo trae', async () => {
        // Una fila vieja puede no tener contacto. Omitir la clave es honesto;
        // mandar `'undefined'` como alcance sería inventar un techo que
        // ninguna persona tiene.
        const { service, outbound } = build({
            ...BASE, contact_id: null, last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        const metadata = outbound.enqueue.mock.calls[0][0].metadata;
        expect(metadata.conversationId).toBe('conv-1');
        expect('contactId' in metadata).toBe(false);
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
