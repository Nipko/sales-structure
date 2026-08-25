import { VerticalIntegrationsController } from './vertical-integrations.controller';

describe('VerticalIntegrationsController health contract', () => {
    it('exposes differentiated provider health without credentials', async () => {
        const health = {
            toast: { provider: 'toast', status: 'stale', connected: true },
            mindbody: { provider: 'mindbody', status: 'degraded', connected: true },
            cliniko: { provider: 'cliniko', status: 'unhealthy', connected: false },
        };
        const vi = { getAllHealth: jest.fn().mockResolvedValue(health) };
        const controller = new VerticalIntegrationsController(vi as any, {} as any);

        await expect(controller.getAllHealth('tenant-1')).resolves.toEqual({
            success: true,
            data: health,
        });
    });

    it('does not claim newly saved credentials are connected and never returns secrets', async () => {
        const vi = {
            updateConfig: jest.fn().mockResolvedValue({
                provider: 'toast',
                clientId: 'client-id',
                clientSecret: 'super-secret',
            }),
            getProviderHealth: jest.fn().mockResolvedValue({
                provider: 'toast',
                status: 'unavailable',
                connected: false,
                credentialValidated: false,
            }),
        };
        const controller = new VerticalIntegrationsController(vi as any, {} as any);

        const response = await controller.updateConfig('tenant-1', 'toast', {
            clientSecret: 'super-secret',
        });

        expect(response).toMatchObject({
            success: true,
            data: {
                provider: 'toast',
                clientId: 'client-id',
                connected: false,
                status: 'unavailable',
                health: { credentialValidated: false },
            },
        });
        expect(response.data.clientSecret).toBeUndefined();
        expect(JSON.stringify(response)).not.toContain('super-secret');
    });

    // The tenant decorator yields a tenantId, never a schema name. Handing it to
    // the service as if it were one made every synced-items read die with a
    // Postgres 3F000 in production.
    it('hands the synced-items read a tenantId, not a schema name', async () => {
        const vi = { listItems: jest.fn().mockResolvedValue([]) };
        const controller = new VerticalIntegrationsController(vi as any, {} as any);

        await controller.items('11111111-1111-4111-8111-111111111111', 'toast', 'menu_item');

        expect(vi.listItems).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            'toast',
            'menu_item',
        );
    });
});
