import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';

/**
 * Candidate DEFECT SPECS - CORE-ID-01 / CORE-ID-02 resilience of the OTP flow.
 *
 * (1) verifyCode runs a Serializable transaction and maps ANY failure to reason 'expired'
 *     (chat-identity.service.ts: `.catch(() => ({ state: 'expired' }))`). A correct code verified while
 *     other customers verify at the same time can be reported as expired. Intermittently seen in this
 *     suite as a fixture failure when two Jest workers hit public.chat_identity_challenges together.
 * (2) After an OTP expires, a customer asking for a new code re-issues request_identity_code with the
 *     same (empty) arguments. The central execution ledger replays the previous settled result for the
 *     same arguments in the same conversation (CONFIRMATION_TTL_MS = 30 min), so no new code is created.
 */
(isolationUrl ? describe : describe.skip)('DEFECT N3: identity OTP resilience', () => {
    jest.setTimeout(120_000);
    let w: World;
    beforeAll(async () => { w = await buildWorld('otr'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => { w.smtp.mockClear(); w.sms.mockClear(); });

    it('(1) twenty customers verifying a correct code at the same moment all succeed', async () => {
        const customers = await Promise.all(Array.from({ length: 20 }, async () => {
            const contactId = await w.newContact();
            const conversationId = await w.newConversation(contactId);
            await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp');
            const [row] = await w.client.$queryRawUnsafe(
                `SELECT code FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid`, conversationId) as any[];
            return { conversationId, code: row.code as string };
        }));
        const results = await Promise.all(customers.map(c => w.identity.verifyCode(c.conversationId, c.code)));
        expect(results.filter(r => !r.ok).map(r => r.reason)).toEqual([]);
    });

    it('(2) after the code expires, asking again issues a NEW code (not a replay of the old result)', async () => {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Necesito verificarme');
        const first = await w.run(contactId, conversationId, 'request_identity_code', {});
        expect(first).toMatchObject({ sent: true });
        await w.client.$executeRawUnsafe(
            `UPDATE public.chat_identity_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE conversation_id=$1::uuid`, conversationId);
        await w.inbound(conversationId, 'El código venció, envíame uno nuevo por favor');
        const deliveriesBefore = w.smtp.mock.calls.length;

        const second = await w.run(contactId, conversationId, 'request_identity_code', {});

        const live = await w.client.$queryRawUnsafe(
            `SELECT id FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at>NOW()`,
            conversationId) as any[];
        expect({ replay: second.idempotentReplay === true, newDeliveries: w.smtp.mock.calls.length - deliveriesBefore, liveChallenges: live.length })
            .toEqual({ replay: false, newDeliveries: 1, liveChallenges: 1 });
    });
    it('(3) an unexpected failure while verifying is never reported as expired nor replayed from the ledger', async () => {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Aquí está el código');
        await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp');
        const [row] = await w.client.$queryRawUnsafe(
            `SELECT code FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid AND consumed_at IS NULL`, conversationId) as any[];
        const broken = jest.spyOn(w.identity as any, 'verifyCodeOnce').mockRejectedValueOnce(new Error('connection reset'));
        let failed: any;
        try { failed = await w.run(contactId, conversationId, 'verify_identity_code', { code: row.code }); } finally { broken.mockRestore(); }
        expect(failed).toMatchObject({ verified: false, reason: 'unavailable', error: 'identity_verification_unavailable' });
        expect(failed.reason).not.toBe('expired');

        const retry = await w.run(contactId, conversationId, 'verify_identity_code', { code: row.code });
        expect({ replay: retry.idempotentReplay === true, verified: retry.verified }).toEqual({ replay: false, verified: true });
    });

    it('(5) after five wrong codes the lockout holds: no new code is issued and verify answers too_many, not expired', async () => {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp');
        const [row] = await w.client.$queryRawUnsafe(
            `SELECT code FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid AND consumed_at IS NULL`, conversationId) as any[];
        const wrong = row.code === '000000' ? '111111' : '000000';
        let last: any;
        for (let i = 0; i < 5; i += 1) last = await w.identity.verifyCode(conversationId, wrong);
        expect(last).toEqual({ ok: false, reason: 'too_many' });
        const deliveries = w.smtp.mock.calls.length;

        await w.inbound(conversationId, 'Dame otro código por favor');
        const again = await w.run(contactId, conversationId, 'request_identity_code', {});
        const retry = await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp');
        const right = await w.identity.verifyCode(conversationId, row.code);

        expect(again).toMatchObject({ error: 'identity_locked', shouldHandoff: true });
        expect(retry).toEqual({ status: 'blocked' });
        expect(right).toEqual({ ok: false, reason: 'too_many' });
        expect(w.smtp.mock.calls.length).toBe(deliveries);
    });

    it('(6) at most three codes per conversation and contact per hour, whatever the reason they were replaced', async () => {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        const before = w.smtp.mock.calls.length;
        for (let i = 0; i < 3; i += 1) {
            expect(await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp')).toMatchObject({ status: 'sent' });
            await w.client.$executeRawUnsafe(
                `UPDATE public.chat_identity_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE conversation_id=$1::uuid`, conversationId);
        }
        expect(await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp')).toEqual({ status: 'blocked' });
        expect(w.smtp.mock.calls.length - before).toBe(3);
    });

    it('(4) a serialization conflict (P2034) is retried and the correct code still verifies', async () => {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.identity.startVerification(w.tenantId, w.schema, contactId, conversationId, 'whatsapp');
        const [row] = await w.client.$queryRawUnsafe(
            `SELECT code FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid AND consumed_at IS NULL`, conversationId) as any[];
        const conflict = Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' });
        const spy = jest.spyOn(w.prisma, '$transaction').mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
        try { expect(await w.identity.verifyCode(conversationId, row.code)).toEqual({ ok: true }); } finally { spy.mockRestore(); }
    });
});
