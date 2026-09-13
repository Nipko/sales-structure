import { MediaProcessingService } from './media-processing.service';

describe('MediaProcessingService governance integration', () => {
    function harness() {
        const download = { download: jest.fn() };
        const throttle = { checkQuota: jest.fn(), recordUsage: jest.fn() };
        const consent = { resolve: jest.fn().mockResolvedValue(null), request: jest.fn().mockResolvedValue({
            message: 'consent required', reason: 'consent_required',
        }) };
        const service = new MediaProcessingService(
            download as any,
            {} as any,
            {} as any,
            throttle as any,
            {} as any,
            {} as any,
            {} as any,
            consent as any,
        );
        return { service, download, throttle, consent };
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

        expect(result).toEqual({ blockedMessage: 'consent required', blockedReason: 'consent_required' });
        expect(throttle.checkQuota).not.toHaveBeenCalled();
        expect(download.download).not.toHaveBeenCalled();
    });

    it('uses verified registry authority but never persists an ephemeral source or transcript', async () => {
        const { service, download, throttle, consent } = harness();
        const now = Date.now();
        consent.resolve.mockResolvedValue({
            consent: {
                version: 1, proofId: 'registry-proof', subjectId: 'contact-1',
                source: 'verified_consent_registry', purposes: ['audio_transcription'],
                grantedAt: new Date(now - 1_000).toISOString(),
                expiresAt: new Date(now + 86_400_000).toISOString(),
            },
            retention: {
                scope: 'source_and_derived', mode: 'ephemeral',
                deleteAt: new Date(now + 60_000).toISOString(), enforcement: 'in_memory_only',
            },
        });
        throttle.checkQuota.mockResolvedValue({ allowed: true, limits: { maxAudioDurationSec: 60 } });
        download.download.mockResolvedValue({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' });
        (service as any).transcription = { transcribe: jest.fn().mockResolvedValue({
            text: 'necesito una cita', durationSec: 2, costCentsUsd: 1, model: 'whisper-1',
        }) };
        (service as any).redis = {
            get: jest.fn().mockResolvedValue('es'), incrBy: jest.fn(), sadd: jest.fn(),
            expire: jest.fn(),
        };
        (service as any).media = { saveBuffer: jest.fn() };
        (service as any).prisma = { executeInTenantSchema: jest.fn() };

        const result = await service.processMedia({
            id: 'message-1', tenantId: 'tenant-1', channelType: 'whatsapp',
            channelAccountId: 'account-1', contactId: 'external-contact', conversationId: 'conversation-1',
            direction: 'inbound', timestamp: new Date(), status: 'delivered',
            metadata: {},
            content: { type: 'audio', mediaUrl: 'media-id' },
        }, 'contact-1', 'conversation-1');

        expect(result).toMatchObject({ text: expect.stringContaining('necesito una cita') });
        expect(consent.resolve).toHaveBeenCalledWith('tenant-1', 'contact-1', 'audio_transcription');
        expect((service as any).media.saveBuffer).not.toHaveBeenCalled();
        expect((service as any).prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
