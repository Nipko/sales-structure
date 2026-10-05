import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';

/**
 * CORE-ID-01 / CORE-ID-02 through the real executor tools request_identity_code and
 * verify_identity_code against public.chat_identity_challenges. SMTP and SMS are
 * counters; the OTP is read from the row only as the oracle's "what the customer
 * would have received".
 */
(isolationUrl ? describe : describe.skip)('N3 identity OTP contracts (CORE-ID-01, CORE-ID-02)', () => {
    jest.setTimeout(120_000);
    let w: World;
    beforeAll(async () => { w = await buildWorld('id'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => { w.smtp.mockClear(); w.sms.mockClear(); });

    const rows = (conversationId: string) => w.client.$queryRawUnsafe(
        `SELECT * FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid ORDER BY created_at`,
        w.tenantId, conversationId) as Promise<any[]>;
    const active = async (conversationId: string) =>
        (await rows(conversationId)).filter(r => !r.consumed_at && !r.superseded_at);
    const transport = () => w.smtp.mock.calls.length + w.sms.mock.calls.length;
    async function customer(contact: { email?: string | null; phone?: string | null } = {}) {
        const contactId = await w.newContact(contact);
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Necesito verificar mi identidad');
        return { contactId, conversationId };
    }
    const request = (c: any) => w.run(c.contactId, c.conversationId, 'request_identity_code', {});
    const verify = (c: any, code: string) => w.run(c.contactId, c.conversationId, 'verify_identity_code', { code });
    const wrong = (real: string, n = 0) => { const candidate = String(100000 + n); return candidate === real ? String(200000 + n) : candidate; };

    describe('CORE-ID-01 one code per challenge, no invented channel, no repeated delivery', () => {
        it('three concurrent request_identity_code calls produce one challenge and one delivery', async () => {
            const c = await customer();
            const results = await Promise.all([request(c), request(c), request(c)]);
            // The central ledger turns the racers into operation_in_progress: still exactly one delivery.
            expect(results.filter(r => r.sent === true && r.idempotentReplay !== true)).toHaveLength(1);
            for (const r of results) expect(r.sent === true || r.pending === true || r.error === 'operation_in_progress').toBe(true);
            expect(await active(c.conversationId)).toHaveLength(1);
            expect(await rows(c.conversationId)).toHaveLength(1);
            expect(transport()).toBe(1);
            expect((await rows(c.conversationId))[0]).toMatchObject({ state: 'sent', channel: 'email' });
        });

        it('a later request and the recovery sweep never deliver the same challenge again', async () => {
            const c = await customer();
            await request(c);
            await request(c);
            await w.identity.processDue();
            expect(transport()).toBe(1);
            expect(await rows(c.conversationId)).toHaveLength(1);
        });

        it('a contact with neither email nor phone is unverifiable: handoff, zero rows, zero deliveries', async () => {
            const c = await customer({ email: null, phone: null });
            const result = await request(c);
            expect(result).toMatchObject({ error: 'identity_unverifiable', shouldHandoff: true });
            expect(await rows(c.conversationId)).toHaveLength(0);
            expect(transport()).toBe(0);
        });

        it('an SMS conversation without email has no independent channel and nothing is invented', async () => {
            const c = await customer({ email: null, phone: '+573001112233' });
            const result = await w.run(c.contactId, c.conversationId, 'request_identity_code', {}, { channelType: 'sms' });
            expect(result).toMatchObject({ error: 'identity_unverifiable', shouldHandoff: true });
            expect(transport()).toBe(0);
        });

        it('an already verified conversation reports alreadyVerified and sends nothing', async () => {
            const c = await customer();
            await w.verify(c.conversationId, c.contactId);
            const before = (await rows(c.conversationId)).length;
            expect(await request(c)).toEqual({ alreadyVerified: true });
            expect((await rows(c.conversationId)).length).toBe(before);
            expect(transport()).toBe(0);
        });
    });

    describe('CORE-ID-02 five attempts, bound to contact and conversation, expires', () => {
        it('five wrong codes burn the challenge: too_many + handoff, code NULL, and the right code no longer works', async () => {
            const c = await customer();
            await request(c);
            const [challenge] = await active(c.conversationId);
            const first4: any[] = [];
            for (let attempt = 1; attempt <= 4; attempt += 1) first4.push((await verify(c, wrong(challenge.code, attempt))).reason);
            expect(first4).toEqual(['wrong', 'wrong', 'wrong', 'wrong']);
            const fifth = await verify(c, wrong(challenge.code, 5));
            expect(fifth).toMatchObject({ verified: false, reason: 'too_many', shouldHandoff: true });
            const [burned] = await rows(c.conversationId);
            expect(burned.code).toBeNull();
            expect(Number(burned.verify_attempts)).toBe(5);
            expect(burned.superseded_at).not.toBeNull();
            const late = await verify(c, challenge.code);
            expect(late.verified).toBe(false);
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(false);
        });

        it('four wrong codes then the right one still verifies (the budget is exactly five)', async () => {
            const c = await customer();
            await request(c);
            const [challenge] = await active(c.conversationId);
            for (let attempt = 1; attempt <= 4; attempt += 1) await verify(c, wrong(challenge.code, attempt));
            expect(await verify(c, challenge.code)).toMatchObject({ verified: true });
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(true);
        });

        it('the code is single-use: once consumed it cannot verify again', async () => {
            const c = await customer();
            await request(c);
            const [challenge] = await active(c.conversationId);
            expect(await verify(c, challenge.code)).toMatchObject({ verified: true });
            // service level: the tool layer would replay its own ledger entry for identical args
            expect(await w.identity.verifyCode(c.conversationId, challenge.code)).toEqual({ ok: false, reason: 'expired' });
            expect((await rows(c.conversationId))[0]).toMatchObject({ code: null });
        });

        it('the right code in ANOTHER conversation of the same contact does not verify anything', async () => {
            const c = await customer();
            await request(c);
            const [challenge] = await active(c.conversationId);
            const otherConversation = await w.newConversation(c.contactId);
            await w.inbound(otherConversation, 'hola desde otra conversación');
            const other = { contactId: c.contactId, conversationId: otherConversation };
            expect(await verify(other, challenge.code)).toMatchObject({ verified: false, reason: 'expired' });
            expect(await w.identity.isVerified(otherConversation, c.contactId)).toBe(false);
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(false);
            // and the original challenge is untouched, still redeemable in its own conversation
            expect(await verify(c, challenge.code)).toMatchObject({ verified: true });
            // verified in A, the SAME contact is still unverified in B: the session is bound to the conversation
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(true);
            expect(await w.identity.isVerified(otherConversation, c.contactId)).toBe(false);
        });

        it('verification is bound to the contact: another contact is never reported verified', async () => {
            const c = await customer();
            await w.verify(c.conversationId, c.contactId);
            const intruder = await w.newContact();
            expect(await w.identity.isVerified(c.conversationId, intruder)).toBe(false);
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(true);
        });

        it('an expired challenge answers "expired", loses its code and cannot be redeemed', async () => {
            const c = await customer();
            await request(c);
            const [challenge] = await active(c.conversationId);
            await w.client.$executeRawUnsafe(
                `UPDATE public.chat_identity_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid`, challenge.id);
            expect(await verify(c, challenge.code)).toMatchObject({ verified: false, reason: 'expired', shouldHandoff: false });
            const [after] = await rows(c.conversationId);
            expect(after.code).toBeNull();
            expect(after.superseded_at).not.toBeNull();
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(false);
        });

        it('a verified session itself lapses after its window', async () => {
            const c = await customer();
            await w.verify(c.conversationId, c.contactId);
            await w.client.$executeRawUnsafe(
                `UPDATE public.chat_identity_challenges SET verified_at=NOW()-INTERVAL '2 hours',verified_expires_at=NOW()-INTERVAL '1 second' WHERE conversation_id=$1::uuid`, c.conversationId);
            expect(await w.identity.isVerified(c.conversationId, c.contactId)).toBe(false);
        });
    });
});
