const mockStorage = new Map<string, string>();

jest.mock('../api', () => ({ api: { sendMessage: jest.fn() } }));
jest.mock('../socket', () => ({ onInboxStatus: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
        setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
        removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
        getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
        multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((key) => mockStorage.delete(key)); }),
    },
}));

import {
    activateOutboxScope,
    clearAllOutboxStorage,
    deactivateOutboxScope,
    enqueue,
    pendingFor,
    retry,
} from '../outbox';
import { api } from '../api';

const sendMessage = api.sendMessage as jest.Mock;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('outbox account isolation', () => {
    beforeEach(async () => {
        sendMessage.mockReset();
        mockStorage.clear();
        await clearAllOutboxStorage();
        await activateOutboxScope('user-1', 'tenant-1');
    });

    afterEach(async () => {
        await clearAllOutboxStorage();
    });

    it('sends and removes a message owned by the active account', async () => {
        sendMessage.mockResolvedValue({ success: true });
        expect(enqueue({ id: 'm1', tenantId: 'tenant-1', conversationId: 'conv-ok', body: 'hola' })).toBe(true);
        await tick();

        // Actor identity is derived by the API from the authenticated session; the
        // outbox keeps userId only for local queue isolation and never sends it.
        expect(sendMessage).toHaveBeenCalledWith('tenant-1', 'conv-ok', 'hola');
        expect(pendingFor('conv-ok')).toHaveLength(0);
    });

    it('keeps a message failed when the API resolves an offline/error envelope', async () => {
        sendMessage.mockResolvedValue({ success: false, error: 'network_error' });
        enqueue({ id: 'm2', tenantId: 'tenant-1', conversationId: 'conv-fail', body: 'hey' });
        await tick();

        const pending = pendingFor('conv-fail');
        expect(pending).toHaveLength(1);
        expect(pending[0].failed).toBe(true);
        expect(pending[0].agentId).toBe('user-1');
    });

    it('retry() sends a failed message when connectivity returns', async () => {
        sendMessage.mockResolvedValue({ success: false, error: 'offline' });
        enqueue({ id: 'm3', tenantId: 'tenant-1', conversationId: 'conv-retry', body: 'reintento' });
        await tick();
        expect(pendingFor('conv-retry')[0].failed).toBe(true);

        sendMessage.mockReset();
        sendMessage.mockResolvedValue({ success: true });
        retry('m3');
        await tick();
        expect(pendingFor('conv-retry')).toHaveLength(0);
    });

    it('refuses messages for another tenant or an explicitly different agent', () => {
        expect(enqueue({ id: 'wrong-t', tenantId: 'tenant-2', conversationId: 'c', body: 'x' })).toBe(false);
        expect(enqueue({ id: 'wrong-u', tenantId: 'tenant-1', conversationId: 'c', body: 'x', agentId: 'user-2' })).toBe(false);
        expect(pendingFor('c')).toHaveLength(0);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('clears every persisted queue at logout so a second account cannot retry it', async () => {
        sendMessage.mockResolvedValue({ success: false, error: 'offline' });
        enqueue({ id: 'old', tenantId: 'tenant-1', conversationId: 'private', body: 'mensaje privado' });
        await tick();
        expect(pendingFor('private')).toHaveLength(1);

        await clearAllOutboxStorage();
        sendMessage.mockReset();
        sendMessage.mockResolvedValue({ success: true });
        await activateOutboxScope('user-2', 'tenant-2');
        retry();
        await tick();

        expect(pendingFor('private')).toHaveLength(0);
        expect(sendMessage).not.toHaveBeenCalled();
        const persistedOutboxes = [...mockStorage.entries()]
            .filter(([key]) => key.startsWith('parallly_outbox_'))
            .map(([, value]) => JSON.parse(value));
        expect(persistedOutboxes.every((items) => Array.isArray(items) && items.length === 0)).toBe(true);
    });

    it('deletes the unscoped v1 queue instead of migrating or sending it', async () => {
        deactivateOutboxScope();
        mockStorage.set('parallly_outbox_v1', JSON.stringify([
            { id: 'legacy', tenantId: 'tenant-1', conversationId: 'private', body: 'old' },
        ]));
        sendMessage.mockResolvedValue({ success: true });

        await activateOutboxScope('user-2', 'tenant-2');
        await tick();

        expect(mockStorage.has('parallly_outbox_v1')).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
