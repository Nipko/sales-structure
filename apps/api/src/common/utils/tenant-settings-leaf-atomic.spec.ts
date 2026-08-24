import { mutateTenantSettingsLeafAtomic } from './tenant-settings-branch.util';

describe('mutateTenantSettingsLeafAtomic', () => {
    it('serializes a provider leaf and preserves sibling providers', async () => {
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{
                value: { provider: 'cliniko', apiKey: 'old', baseUrl: 'https://api.au1.cliniko.com/v1' },
            }]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        const prisma = { $transaction: jest.fn(async (callback: any) => callback(tx)) };

        const result = await mutateTenantSettingsLeafAtomic(
            prisma as any,
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            'verticalIntegrations',
            'cliniko',
            (current: any) => ({ ...current, apiKey: 'new' }),
        );

        expect(result).toMatchObject({ provider: 'cliniko', apiKey: 'new' });
        expect(tx.$queryRawUnsafe.mock.calls[0][0]).toMatch(/FOR UPDATE/i);
        expect(tx.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual([
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            '{verticalIntegrations,cliniko}',
        ]);
        const write = tx.$executeRawUnsafe.mock.calls[0];
        expect(write.slice(1, 4)).toEqual([
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            '{verticalIntegrations}',
            '{verticalIntegrations,cliniko}',
        ]);
        expect(JSON.parse(write[4])).toMatchObject({ apiKey: 'new' });
    });

    it('does not write when the transformer returns the live object unchanged', async () => {
        const current = { provider: 'toast', status: 'healthy' };
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ value: current }]),
            $executeRawUnsafe: jest.fn(),
        };
        const prisma = { $transaction: jest.fn(async (callback: any) => callback(tx)) };

        await expect(mutateTenantSettingsLeafAtomic(
            prisma as any,
            '8af1efcf-72fb-4a6c-8773-b17572ee8380',
            'verticalIntegrationHealth',
            'toast',
            (value) => value,
        )).resolves.toBe(current);
        expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });
});
