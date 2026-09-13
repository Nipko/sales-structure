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
    const dispatch: any = { send: jest.fn(async () => ({
        kind: 'prepared', originId: '55555555-5555-4555-8555-555555555555',
    })) };
    const persona: any = { resolvePersonaForChannel: jest.fn(async () => ({
        agentId: AGENT_ID, version: 1, operationalHash: 'a'.repeat(64), config: {},
    })) };
    const email: any = { send: jest.fn(async () => true) };
    return {
        service: new PaymentOutcomeNotifierService(prisma, dispatch, persona, email),
        dispatch, persona, email,
    };
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '33333333-3333-4333-8333-333333333333';
const INBOUND_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '66666666-6666-4666-8666-666666666666';
const BASE = {
    conversation_id: CONVERSATION_ID,
    channel_type: 'whatsapp',
    channel_account_id: 'acc-1',
    contact_id: CONTACT_ID,
    external_id: '573208010737',
    email: 'huesped@example.com',
    name: 'Nir',
    last_inbound_message_id: INBOUND_ID,
};

const INPUT = { tenantId: TENANT_ID, conversationId: CONVERSATION_ID,
    text: 'Tu pago entró', dedupeId: 'd1' };

describe('dentro de la ventana', () => {
    it('escribe por WhatsApp, que es donde el cliente está', async () => {
        const { service, dispatch, email } = build({ ...BASE, last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        expect(dispatch.send).toHaveBeenCalledTimes(1);
        expect(email.send).not.toHaveBeenCalled();
    });
});

describe('qué dice el trabajo sobre sí mismo', () => {
    /**
     * ═══ UN AVISO DE PAGO ES UNA RESPUESTA, NO UNA CAMPAÑA ═══
     *
     * La autoridad económica lee `disposition` de la fila durable. La identidad
     * viene del pago y su causa reactiva viene del último mensaje del cliente;
     * ninguna de las dos se infiere de la otra.
     *
     * Este productor TENÍA la conversación — la consulta de arriba la trae, y
     * el chequeo de las 24h es la razón entera de llegar hasta el enqueue — y
     * no la pasaba. Así que una respuesta de servicio dentro de la ventana se
     * cobraba como proactiva, y lo proactivo es exactamente lo que pausa el
     * freno suave: un tenant cerca de su techo habría retenido la
     * confirmación de un pago YA acreditado. R4 no lo deja: una pausa por
     * presupuesto no cancela pedidos ni borra respuestas.
     *
     * Se afirma sobre lo que recibe el outbox porque ese dato queda comprometido
     * antes de que el procesador lo lea.
     */
    it('lleva la conversación, que es lo que la hace reactiva', async () => {
        const { service, dispatch } = build({
            ...BASE, last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        const effect = dispatch.send.mock.calls[0][1];
        expect(effect.conversationId).toBe(CONVERSATION_ID);
        expect(effect.originKind).toBe('proactive');
        expect(effect.disposition).toBe('reactive');
        expect(effect.replyToMessageId).toBe(INBOUND_ID);
    });

    it('lleva el contacto, que es el alcance que acota un bucle', async () => {
        // El techo por contacto está keyeado por contacto. Sin él este
        // productor queda fuera del único alcance que puede frenar una
        // conversación desbocada.
        const { service, dispatch } = build({
            ...BASE, last_inbound_at: new Date(Date.now() - HORA) });

        await service.notifyCustomer(INPUT);

        expect(dispatch.send.mock.calls[0][1].contactId).toBe(CONTACT_ID);
    });

    it('rechaza antes de preparar cuando la fila no trae contacto', async () => {
        const { service, dispatch } = build({
            ...BASE, contact_id: null, last_inbound_at: new Date(Date.now() - HORA) });

        await expect(service.notifyCustomer(INPUT)).resolves.toBe(false);

        expect(dispatch.send).not.toHaveBeenCalled();
    });

    it('sella el agente asignado a la conexión y la clave estable del desenlace', async () => {
        const { service, dispatch, persona } = build({
            ...BASE, last_inbound_at: new Date(Date.now() - HORA),
        });

        await service.notifyCustomer(INPUT);

        expect(persona.resolvePersonaForChannel).toHaveBeenCalledWith(
            TENANT_ID, 'whatsapp', 'acc-1',
        );
        const effect = dispatch.send.mock.calls[0][1];
        expect(effect.originKey).toBe('payment_outcome:d1');
        expect(effect.operationalScope).toMatchObject({
            kind: 'agent', tenantId: TENANT_ID, agentId: AGENT_ID,
        });
    });
});

describe('fuera de la ventana', () => {
    it('cae a email en vez de mandar algo que Meta va a rechazar', async () => {
        const { service, dispatch, email } = build({ ...BASE, last_inbound_at: new Date(Date.now() - 30 * HORA) });

        await service.notifyCustomer(INPUT);

        expect(dispatch.send).not.toHaveBeenCalled();
        expect(email.send).toHaveBeenCalledTimes(1);
        expect(email.send.mock.calls[0][0].to).toBe('huesped@example.com');
    });

    it('sin email, no finge: devuelve false y deja el rastro', async () => {
        const { service, dispatch, email } = build({
            ...BASE, email: null, last_inbound_at: new Date(Date.now() - 30 * HORA),
        });

        await expect(service.notifyCustomer(INPUT)).resolves.toBe(false);
        expect(dispatch.send).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
    });

    it('una conversación sin mensajes del cliente se trata como fuera', async () => {
        // Nunca escribió: no hay ventana abierta que aprovechar.
        const { service, dispatch, email } = build({ ...BASE, last_inbound_at: null });

        await service.notifyCustomer(INPUT);

        expect(dispatch.send).not.toHaveBeenCalled();
        expect(email.send).toHaveBeenCalledTimes(1);
    });
});

describe('los demás canales no tienen ventana', () => {
    it('un widget viejo se sigue respondiendo por el widget', async () => {
        // La regla es de Meta, no nuestra: aplicarla a Telegram o al chat web
        // mandaría a email conversaciones que están perfectamente abiertas.
        const { service, dispatch, email } = build({
            ...BASE, channel_type: 'telegram', last_inbound_at: new Date(Date.now() - 200 * HORA),
        });

        await service.notifyCustomer(INPUT);

        expect(dispatch.send).toHaveBeenCalledTimes(1);
        expect(email.send).not.toHaveBeenCalled();
    });
});
