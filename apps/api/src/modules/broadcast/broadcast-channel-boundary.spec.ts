import { BadRequestException } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';

describe('Broadcast self-service channel boundary', () => {
    const service = new BroadcastService(
        {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );

    it.each(['email', 'sms', 'instagram'])('rejects unsupported new %s campaigns before touching storage', async (channel) => {
        await expect(service.createCampaign('tenant', { name: 'x', channels: [channel] }))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'broadcast_channel_not_self_service' }) });
    });

    it('accepts only the implemented WhatsApp campaign boundary', () => {
        expect(() => (service as any).assertSelfServiceBroadcastChannels(['whatsapp'])).not.toThrow();
        expect(() => (service as any).assertSelfServiceBroadcastChannels(['whatsapp', 'email']))
            .toThrow(BadRequestException);
    });

    it('rechecks verified-email authorization inside the service for scheduled workers', async () => {
        const verified = new BroadcastService(
            { user: { findFirst: jest.fn().mockResolvedValue({ id: 'ok' }) } } as any,
            {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        await expect((verified as any).assertLaunchEmailAuthorization(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        )).resolves.toBeUndefined();

        const unverified = new BroadcastService(
            { user: { findFirst: jest.fn().mockResolvedValue(null) } } as any,
            {} as any, {} as any, {} as any, {} as any, {} as any,
        );
        await expect((unverified as any).assertLaunchEmailAuthorization(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
        )).rejects.toMatchObject({
            response: expect.objectContaining({ capability: 'send_outbound', workerSafe: true }),
        });
    });
});
