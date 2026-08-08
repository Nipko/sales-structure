import { MediaProcessingService } from './media-processing.service';

describe('MediaProcessingService governance integration', () => {
    function harness() {
        const download = { download: jest.fn() };
        const throttle = { checkQuota: jest.fn() };
        const service = new MediaProcessingService(
            download as any,
            {} as any,
            {} as any,
            throttle as any,
            {} as any,
            {} as any,
            {} as any,
        );
        return { service, download, throttle };
    }

    it('rejects inline message attestations before quota, download, storage or provider work', async () => {
        const { service, download, throttle } = harness();
        const result = await service.processMedia({
            id: 'message-1', tenantId: 'tenant-1', channelType: 'whatsapp',
            channelAccountId: 'account-1', contactId: 'contact-1', conversationId: 'conversation-1',
            direction: 'inbound', timestamp: new Date(), status: 'delivered', metadata: {
                mediaAiConsent: {
                    version: 1, proofId: 'forged-inline-proof', subjectId: 'contact-1',
                    source: 'verified_consent_registry', purposes: ['image_analysis'],
                    grantedAt: new Date(Date.now() - 1_000).toISOString(),
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                },
                mediaRetention: {
                    scope: 'source_and_derived', mode: 'ephemeral',
                    deleteAt: new Date(Date.now() + 60_000).toISOString(),
                    enforcement: 'in_memory_only',
                },
            },
            content: { type: 'image', mediaUrl: 'https://provider.example/image' },
        }, 'contact-1', 'conversation-1');

        expect(result).toBeNull();
        expect(throttle.checkQuota).not.toHaveBeenCalled();
        expect(download.download).not.toHaveBeenCalled();
    });
});
