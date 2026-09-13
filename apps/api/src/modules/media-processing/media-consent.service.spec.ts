import { createHash } from 'crypto';
import { MediaConsentService } from './media-consent.service';

describe('MediaConsentService', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const policyId = '44444444-4444-4444-8444-444444444444';
    const content = 'We use AI only to understand media the customer asks us to process.';

    function harness() {
        const state = new Map<string, any>();
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_test'),
            executeInTenantSchema: jest.fn(),
            tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'acme' }) },
        };
        const redis = {
            getJson: jest.fn(async (key: string) => state.get(key) ?? null),
            setJson: jest.fn(async (key: string, value: any) => { state.set(key, value); }),
            del: jest.fn(async (key: string) => state.delete(key) ? 1 : 0),
        };
        return { service: new MediaConsentService(prisma as any, redis as any), prisma, redis, state };
    }

    it('accepts only a current consent whose contact, scope and active policy hash match', async () => {
        const h = harness();
        h.prisma.executeInTenantSchema.mockResolvedValueOnce([{
            id: 'proof-1', created_at: '2026-09-12T10:00:00.000Z',
            expires_at: '2027-09-12T10:00:00.000Z', revoked_at: null,
            consent_scope: 'media.ai', policy_id: policyId, policy_version: 3,
            legal_text_hash: createHash('sha256').update(content).digest('hex'),
            policy_content: content,
        }]);

        const result = await h.service.resolve(
            tenantId, contactId, 'image_analysis', new Date('2026-09-12T12:00:00.000Z'),
        );

        expect(result?.consent).toMatchObject({
            proofId: 'proof-1', subjectId: contactId,
            purposes: ['image_analysis'], source: 'verified_consent_registry',
        });
        expect(result?.retention).toMatchObject({ mode: 'ephemeral', enforcement: 'in_memory_only' });

        h.prisma.executeInTenantSchema.mockResolvedValueOnce([{
            id: 'forged', created_at: '2026-09-12T10:00:00.000Z',
            expires_at: '2027-09-12T10:00:00.000Z', legal_text_hash: 'wrong',
            policy_content: content,
        }]);
        await expect(h.service.resolve(tenantId, contactId, 'image_analysis')).resolves.toBeNull();
    });

    it('binds the challenge to the active privacy policy and records one idempotent grant', async () => {
        const h = harness();
        h.prisma.executeInTenantSchema
            .mockResolvedValueOnce([{ id: policyId, title: 'Privacy v3', content, version: 3 }])
            .mockResolvedValueOnce([{ id: 'consent-1' }]);

        const request = await h.service.request(
            tenantId, contactId, conversationId, 'whatsapp', ['audio_transcription'], 'es',
        );
        expect(request).toMatchObject({ available: true, reason: 'consent_required' });
        expect(request.message).toContain('/policies/public/acme/privacy');
        expect(request.message).toContain('sí, autorizo');

        const result = await h.service.handlePendingReply(
            tenantId, contactId, conversationId, 'Sí, autorizo', 'es',
        );
        expect(result).toMatchObject({ handled: true });
        expect(result.message).toContain('Autorización registrada');
        expect(h.prisma.executeInTenantSchema.mock.calls[1][1]).toContain('ON CONFLICT (consent_request_id)');
        expect(h.prisma.executeInTenantSchema.mock.calls[1][2]).toEqual(expect.arrayContaining([
            contactId, policyId, 'media.ai', conversationId,
        ]));
        expect(h.state.size).toBe(0);
    });

    it('does not turn an acknowledgement or qualified yes into sensitive-data consent', async () => {
        for (const reply of ['ok', 'sí, pero primero dime para qué', 'gracias']) {
            const h = harness();
            h.prisma.executeInTenantSchema.mockResolvedValueOnce([{
                id: policyId, title: 'Privacy v3', content, version: 3,
            }]);
            await h.service.request(
                tenantId, contactId, conversationId, 'telegram', ['image_analysis'], 'es',
            );
            const result = await h.service.handlePendingReply(
                tenantId, contactId, conversationId, reply, 'es',
            );
            expect(result.message).toContain('respuesta clara');
            expect(h.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        }
    });

    it('honours refusal and never writes a consent row', async () => {
        const h = harness();
        h.prisma.executeInTenantSchema.mockResolvedValueOnce([{
            id: policyId, title: 'Privacy v3', content, version: 3,
        }]);
        await h.service.request(
            tenantId, contactId, conversationId, 'messenger', ['image_analysis'], 'en',
        );
        const result = await h.service.handlePendingReply(
            tenantId, contactId, conversationId, 'No, do not do that', 'en',
        );
        expect(result.message).toContain('will not analyze');
        expect(h.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
    });
});
