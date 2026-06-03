jest.mock('../api', () => ({ api: { sendMessage: jest.fn() } }));
jest.mock('../socket', () => ({ onInboxStatus: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined) },
}));

import { enqueue, pendingFor, retry } from '../outbox';
import { api } from '../api';

const sendMessage = api.sendMessage as jest.Mock;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('outbox', () => {
    beforeEach(() => sendMessage.mockReset());

    it('envía el mensaje encolado y lo quita de la cola al tener éxito', async () => {
        sendMessage.mockResolvedValue({ success: true });
        enqueue({ id: 'm1', tenantId: 't', conversationId: 'conv-ok', body: 'hola' });
        await tick();
        expect(sendMessage).toHaveBeenCalledWith('t', 'conv-ok', 'hola', undefined);
        expect(pendingFor('conv-ok')).toHaveLength(0);
    });

    it('mantiene el mensaje como fallido cuando el envío falla (offline)', async () => {
        sendMessage.mockRejectedValue(new Error('offline'));
        enqueue({ id: 'm2', tenantId: 't', conversationId: 'conv-fail', body: 'hey', agentId: 'a1' });
        await tick();
        const pend = pendingFor('conv-fail');
        expect(pend).toHaveLength(1);
        expect(pend[0].failed).toBe(true);
    });

    it('retry() reintenta un fallido y lo envía cuando vuelve la red', async () => {
        // Drena cualquier residuo de tests anteriores (la cola es de módulo).
        sendMessage.mockResolvedValue({ success: true });
        retry(); await tick();

        // Escenario: encola con la red caída → queda fallido.
        sendMessage.mockReset();
        sendMessage.mockRejectedValue(new Error('offline'));
        enqueue({ id: 'm3', tenantId: 't', conversationId: 'conv-retry', body: 'reintento' });
        await tick();
        expect(pendingFor('conv-retry')[0].failed).toBe(true);

        // Vuelve la red + retry → se envía y sale de la cola.
        sendMessage.mockReset();
        sendMessage.mockResolvedValue({ success: true });
        retry('m3');
        await tick();
        expect(pendingFor('conv-retry')).toHaveLength(0);
    });
});
