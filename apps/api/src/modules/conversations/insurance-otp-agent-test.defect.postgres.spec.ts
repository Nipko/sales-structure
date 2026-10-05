import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

/**
 * DEFECT SPEC (kept red on purpose) - check_policy_status / list_my_claims in Agent Test.
 *
 * Promise: Agent Test (executionContext.persistence === 'disabled') is zero-write and
 * zero-effect. tool-execution-control.service.ts:1135-1141 says so explicitly: the central
 * guard "must not turn those reads back into writes by creating ledgers or sending OTPs".
 *
 * Cause: both tools are `agentTestAllowed`, so preflight returns allowed on the read-only
 * path, but the handlers (ai-tool-executor.service.ts:1040-1062) call requireVerifiedIdentity
 * -> ChatIdentityService.startVerification, which inserts a challenge and DELIVERS a real OTP
 * (SMTP/SMS) to the contact on file. A previewing tenant admin texting a real policyholder.
 */
(isolationUrl ? describe : describe.skip)('DEFECT N3: insurance reads send a real OTP from Agent Test', () => {
    jest.setTimeout(120_000);
    let w: World;
    beforeAll(async () => { w = await buildWorld('otp'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => { w.smtp.mockClear(); w.sms.mockClear(); });

    it.each(['check_policy_status', 'list_my_claims'])('%s under Agent Test sends no OTP and creates no challenge', async tool => {
        const contactId = await w.newContact({ email: 'policyholder@example.test', phone: '+573001112233' });
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Consulta de póliza');
        await w.q(`INSERT INTO insurance_policies(policy_number,contact_id,policyholder_name,monthly_premium,starts_at)
                   VALUES($2,$1::uuid,'Titular QA',50000,CURRENT_DATE-30)`, [contactId, `POL-${tool}`]);

        const result = await w.run(contactId, conversationId, tool, tool === 'check_policy_status' ? { policyNumber: `POL-${tool}` } : {},
            { executionContext: AGENT_TEST_EXECUTION_CONTEXT });

        const challenges = await w.client.$queryRawUnsafe(
            `SELECT state,channel,hint FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid`, conversationId) as any[];
        expect(result).toMatchObject({ error: 'identity_verification_required', outboundSuppressed: true });
        expect({ transportCalls: w.smtp.mock.calls.length + w.sms.mock.calls.length, challenges })
            .toEqual({ transportCalls: 0, challenges: [] });
    });
});
