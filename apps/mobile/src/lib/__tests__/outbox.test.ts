jest.mock('../api', () => ({ api: { sendMessage: jest.fn() } }));
jest.mock('../socket', () => ({ onInboxStatus: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined) },
}));

import { enqueue, pendingFor } from '../outbox';
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
});
