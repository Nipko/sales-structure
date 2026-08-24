/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const migration = require('../../../scripts/migrate-bi-api-keys.js');

describe('legacy BI API key migration', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    it('detects only usable plaintext legacy keys and hashes deterministically', () => {
        expect(migration.legacyBiKey({ biApiKey: 'pk_live_1234567890abcdef' }))
            .toBe('pk_live_1234567890abcdef');
        expect(migration.legacyBiKey({ biApiKey: 'short' })).toBeNull();
        expect(migration.hashKey('raw')).toMatch(/^[a-f0-9]{64}$/);
        expect(migration.withAnalyticsScope(['read:contacts', 'read:analytics']))
            .toEqual(['read:contacts', 'read:analytics']);
    });

    it('writes the hash and removes plaintext with CAS in one transaction', async () => {
        let settings: Record<string, unknown> = { biApiKey: 'pk_live_1234567890abcdef', timezone: 'UTC' };
        const tx: any = {
            tenant: { findUnique: jest.fn(async () => ({ settings })) },
            apiKey: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'key-1' }),
                update: jest.fn(),
            },
            $executeRawUnsafe: jest.fn(async (_sql: string, id: string, raw: string) => {
                expect(id).toBe(tenantId);
                expect(raw).toBe('pk_live_1234567890abcdef');
                settings = { timezone: 'UTC' };
                return 1;
            }),
        };
        const client = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

        await expect(migration.migrateTenant(client, { id: tenantId }))
            .resolves.toBe('created');
        expect(tx.apiKey.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                tenantId,
                scopes: ['read:analytics'],
                keyHash: migration.hashKey('pk_live_1234567890abcdef'),
            }),
        });
        expect(settings).toEqual({ timezone: 'UTC' });
    });

    it('fails closed on cross-tenant hash collision and leaves settings untouched', async () => {
        const settings = { biApiKey: 'pk_live_1234567890abcdef' };
        const tx: any = {
            tenant: { findUnique: jest.fn(async () => ({ settings })) },
            apiKey: { findUnique: jest.fn().mockResolvedValue({ id: 'key-x', tenantId: 'other' }) },
            $executeRawUnsafe: jest.fn(),
        };
        const client = { $transaction: jest.fn(async (fn: any) => fn(tx)) };

        await expect(migration.migrateTenant(client, { id: tenantId }))
            .rejects.toThrow('legacy_bi_key_collision');
        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(settings).toHaveProperty('biApiKey');
    });
});
