import {
    onboardingClientKey,
    onboardingOnceKey,
    sanitizeOnboardingClientBatch,
    sanitizeOnboardingClientEvent,
} from '@parallext/shared';
import {
    forgetOnboardingEventMemoryForTests,
    recordOnboardingClientEvents,
    recordOnboardingEvent,
} from './onboarding-event.util';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

describe('onboarding event contract', () => {
    beforeEach(() => forgetOnboardingEventMemoryForTests());

    it('accepts only the declared client shape and vocabulary', () => {
        expect(sanitizeOnboardingClientEvent({
            event: 'wizard_step_advanced', step: 'test', detail: 'edited',
        })).toEqual({ event: 'wizard_step_advanced', step: 'test', detail: 'edited' });
        expect(sanitizeOnboardingClientEvent({
            event: 'wizard_step_advanced', step: 'test', detail: 'looks_good',
        })).toBeNull();
        expect(sanitizeOnboardingClientEvent({
            event: 'wizard_step_viewed', step: 'test', message: 'customer text',
        })).toBeNull();
        expect(sanitizeOnboardingClientEvent({
            event: 'channel_connect_later', channelType: 'email',
        })).toBeNull();
    });

    it('requires a UUID session and caps a browser batch', () => {
        expect(sanitizeOnboardingClientBatch({ sessionId: 'browser-1', events: [] })).toBeNull();
        const batch = sanitizeOnboardingClientBatch({
            sessionId: SESSION_ID,
            events: Array.from({ length: 12 }, () => ({ event: 'wizard_step_viewed', step: 'business' })),
        });
        expect(batch?.events).toHaveLength(10);
        expect(batch?.sessionId).toBe(SESSION_ID);
    });

    it('deduplicates server milestones in process and in PostgreSQL', async () => {
        const prisma: any = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
        const dedupeKey = onboardingOnceKey('test_chat_first_reply', TENANT_ID, 'setup_wizard');
        await expect(recordOnboardingEvent(prisma, {
            tenantId: TENANT_ID, event: 'test_chat_first_reply', detail: 'setup_wizard', dedupeKey,
        })).resolves.toBe('recorded');
        await expect(recordOnboardingEvent(prisma, {
            tenantId: TENANT_ID, event: 'test_chat_first_reply', detail: 'setup_wizard', dedupeKey,
        })).resolves.toBe('remembered');
        expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
        expect(String(prisma.$executeRawUnsafe.mock.calls[0][0])).toContain('ON CONFLICT (dedupe_key)');
    });

    it('records client events with server time and never stores free text', async () => {
        const prisma: any = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
        const events = [{ event: 'channel_connect_started' as const, channelType: 'instagram' as const, detail: 'oauth' }];
        await expect(recordOnboardingClientEvents(prisma, TENANT_ID, USER_ID, SESSION_ID, events))
            .resolves.toBe(1);
        expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
            expect.any(String), TENANT_ID, USER_ID, 'channel_connect_started', 'instagram', null,
            'oauth', 'client', SESSION_ID,
            onboardingClientKey(TENANT_ID, SESSION_ID, events[0]), null,
        );
    });

    it('does not break the product when analytics storage is unavailable', async () => {
        const prisma: any = { $executeRawUnsafe: jest.fn().mockRejectedValue(new Error('table unavailable')) };
        await expect(recordOnboardingEvent(prisma, {
            tenantId: TENANT_ID,
            event: 'onboarding_completed',
            dedupeKey: onboardingOnceKey('onboarding_completed', TENANT_ID),
        })).resolves.toBe('failed');
    });
});
