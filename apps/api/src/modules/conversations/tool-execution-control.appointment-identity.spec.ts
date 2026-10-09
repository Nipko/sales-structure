import { ToolExecutionControlService } from './tool-execution-control.service';

/**
 * The central guard decides, per tenant, whether a contact must verify with a code to read or act on their own appointments —
 * from the business type, the same classification the prompt uses — and it can report an unverified chat WITHOUT sending a code
 * (the transition engine requests the code itself, once). These specs use the real guard; only the tenant row, the identity
 * service and (for the reads) nothing else are doubles.
 */
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

function guard(tenant: any, options: { verified?: boolean; lookupFails?: boolean } = {}) {
    const findUnique = jest.fn(async () => {
        if (options.lookupFails) throw new Error('db down');
        return tenant;
    });
    const chatIdentity = {
        isVerified: jest.fn(async () => options.verified === true),
        startVerification: jest.fn(async () => ({ status: 'sent', via: 'email', hint: 'j***@example.com' })),
    };
    const service = new ToolExecutionControlService({ tenant: { findUnique } } as any, { get: () => 'unit-signing-secret-at-least-32-bytes' } as any,
        chatIdentity as any, {} as any);
    const request = (toolName: string, extra: Record<string, unknown> = {}) => ({
        schemaName: 'tenant_x', tenantId, contactId, conversationId, channelType: 'telegram', toolName, args: toolName === 'cancel_appointment' ? { appointmentId: conversationId } : {}, ...extra,
    }) as any;
    const call = (toolName: string, extra: Record<string, unknown> = {}) => service.preflight(request(toolName, extra));
    // A writer's identity gate runs before any ledger table is touched; `preflight` would open the control tables first.
    const callWriter = (toolName: string, extra: Record<string, unknown> = {}) => (service as any).preflightInternal(request(toolName, extra));
    return { call, callWriter, chatIdentity, findUnique };
}

const SALON = { industry: 'moda_belleza', settings: { verticalConfig: { industry: 'moda_belleza', subType: 'salon_belleza' } } };
const CLINIC = { industry: 'salud', settings: { verticalConfig: { industry: 'salud', subType: 'consultorio' } } };

describe('list_customer_appointments / get_appointment_details follow the business type', () => {
    it.each(['list_customer_appointments', 'get_appointment_details'])('a salon: %s runs for an unverified chat and sends no code', async tool => {
        const g = guard(SALON);
        const decision = await g.call(tool);
        expect(decision.allowed).toBe(true);
        expect(g.chatIdentity.startVerification).not.toHaveBeenCalled();
    });

    it.each(['list_customer_appointments', 'get_appointment_details'])('a clinic: %s asks for the code (and the model\'s own loop sends it)', async tool => {
        const g = guard(CLINIC);
        const decision: any = await g.call(tool);
        expect(decision.allowed).toBe(false);
        expect(decision.result).toMatchObject({ error: 'identity_verification_required', needsVerification: true, sentTo: 'j***@example.com' });
        expect(g.chatIdentity.startVerification).toHaveBeenCalledTimes(1);
    });

    it('a clinic read for the SERVER (identityChallenge none) reports the unverified chat and sends nothing', async () => {
        const g = guard(CLINIC);
        const decision: any = await g.call('list_customer_appointments', { identityChallenge: 'none' });
        expect(decision.allowed).toBe(false);
        expect(decision.result).toMatchObject({ error: 'identity_verification_required', needsVerification: true, challengeSent: false });
        expect(g.chatIdentity.startVerification).not.toHaveBeenCalled();
    });

    it('a verified clinic chat reads', async () => {
        const g = guard(CLINIC, { verified: true });
        expect((await g.call('list_customer_appointments', { identityChallenge: 'none' })).allowed).toBe(true);
    });

    it('cancelling in a clinic needs the same code (before anything is written or proposed)', async () => {
        const g = guard(CLINIC);
        const decision: any = await g.callWriter('cancel_appointment', { identityChallenge: 'none' });
        expect(decision.allowed).toBe(false);
        expect(decision.result.error).toBe('identity_verification_required');
        const reschedule: any = await g.callWriter('reschedule_appointment', { identityChallenge: 'none', args: { appointmentId: conversationId, newDate: '2026-10-16', newTime: '11:00' } });
        expect(reschedule.result.error).toBe('identity_verification_required');
    });

    it('fails closed: an unknown vertical, a missing tenant row or a failed lookup behave as a sensitive business', async () => {
        for (const options of [{ tenant: { industry: 'otro_mundo', settings: {} } }, { tenant: null }, { tenant: SALON, lookupFails: true }]) {
            const g = guard(options.tenant, { lookupFails: (options as any).lookupFails });
            const decision: any = await g.call('list_customer_appointments', { identityChallenge: 'none' });
            expect(decision.allowed).toBe(false);
            expect(decision.result.error).toBe('identity_verification_required');
        }
    });

    it('the vertical is looked up once per tenant for a while, not per call', async () => {
        const g = guard(SALON);
        await g.call('list_customer_appointments');
        await g.call('get_appointment_details');
        expect(g.findUnique).toHaveBeenCalledTimes(1);
    });

    it('other step-up tools are untouched: a salon still needs the code for a treatment plan', async () => {
        const g = guard(SALON);
        const decision: any = await g.call('get_treatment_plan', { identityChallenge: 'none' });
        expect(decision.allowed).toBe(false);
        expect(decision.result.error).toBe('identity_verification_required');
    });
});
