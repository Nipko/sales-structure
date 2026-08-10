import { PushController } from './push.controller';

describe('PushController native unsubscribe', () => {
    it('forwards installation proof when registering a native token', async () => {
        const pushService = { subscribeExpo: jest.fn().mockResolvedValue(undefined) } as any;
        const controller = new PushController(pushService);

        await expect(controller.expoSubscribe(
            {
                sub: '11111111-1111-4111-8111-111111111111',
                tenantId: '22222222-2222-4222-8222-222222222222',
            },
            {
                token: 'ExponentPushToken[device-token]',
                installationId: '33333333-3333-4333-8333-333333333333',
            },
        )).resolves.toEqual({ success: true });

        expect(pushService.subscribeExpo).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'ExponentPushToken[device-token]',
            '33333333-3333-4333-8333-333333333333',
        );
    });

    it('uses only the authenticated user and tenant scope', async () => {
        const pushService = { unsubscribeExpo: jest.fn().mockResolvedValue(undefined) } as any;
        const controller = new PushController(pushService);

        await expect(controller.expoUnsubscribe(
            {
                sub: '11111111-1111-4111-8111-111111111111',
                tenantId: '22222222-2222-4222-8222-222222222222',
            },
            { token: 'ExponentPushToken[device-token]' },
        )).resolves.toEqual({ success: true });

        expect(pushService.unsubscribeExpo).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'ExponentPushToken[device-token]',
        );
    });
});
