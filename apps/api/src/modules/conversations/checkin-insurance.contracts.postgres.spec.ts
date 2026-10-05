import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';

/**
 * High-risk identity/ownership reads and writes of the vertical tools, on real PostgreSQL:
 *   - get_check_in_instructions (address + access code)
 *   - check_policy_status / list_my_claims (can send a real OTP)
 *   - file_claim (writes insurance_claims)
 * SMTP/SMS are counters; nothing leaves the process.
 */
(isolationUrl ? describe : describe.skip)('N3 check-in, insurance identity and claim contracts', () => {
    jest.setTimeout(120_000);
    let w: World;
    const SECRET_ADDRESS = 'Calle 10 # 5-20 apto 301';
    const SECRET_ACCESS = 'Codigo de la caja: 4821';
    beforeAll(async () => { w = await buildWorld('chk'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });
    beforeEach(() => { w.smtp.mockClear(); w.sms.mockClear(); });

    async function customer(verified: boolean, contact: { email?: string | null; phone?: string | null } = {}) {
        const contactId = await w.newContact(contact);
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Hola, necesito mi información');
        if (verified) await w.verify(conversationId, contactId);
        return { contactId, conversationId };
    }
    const transport = () => w.smtp.mock.calls.length + w.sms.mock.calls.length;
    const challenges = async (conversationId: string) => (await w.client.$queryRawUnsafe(
        `SELECT * FROM public.chat_identity_challenges WHERE conversation_id=$1::uuid`, conversationId)) as any[];

    describe('get_check_in_instructions releases address and access code only for a paid, active stay', () => {
        async function property() {
            const id = (await w.q(
                `INSERT INTO properties(id,name,address,check_in_time,check_out_time,check_in_instructions,house_rules)
                 VALUES(gen_random_uuid(),'Casa N3',$1,'15:00','11:00',$2,'Sin fiestas') RETURNING id::text AS id`,
                [SECRET_ADDRESS, SECRET_ACCESS]))[0].id;
            return id as string;
        }
        const book = (propertyId: string, contactId: string, status: string) => w.q(
            `INSERT INTO property_bookings(property_id,contact_id,check_in,check_out,status)
             VALUES($1::uuid,$2::uuid,CURRENT_DATE-1,CURRENT_DATE+2,$3)`, [propertyId, contactId, status]);
        const leaked = (result: any) => {
            const text = JSON.stringify(result);
            return text.includes(SECRET_ADDRESS) || text.includes(SECRET_ACCESS);
        };

        it('positive control: a verified guest with a confirmed stay today receives the instructions', async () => {
            const propertyId = await property();
            const c = await customer(true);
            await book(propertyId, c.contactId, 'confirmed');
            const result = await w.run(c.contactId, c.conversationId, 'get_check_in_instructions', { propertyId });
            expect(result).toMatchObject({ address: SECRET_ADDRESS, checkInInstructions: SECRET_ACCESS });
        });

        it('an unverified chat receives a verification challenge and no property data', async () => {
            const propertyId = await property();
            const c = await customer(false);
            await book(propertyId, c.contactId, 'confirmed');
            const result = await w.run(c.contactId, c.conversationId, 'get_check_in_instructions', { propertyId });
            expect(result).toMatchObject({ error: 'identity_verification_required' });
            expect(leaked(result)).toBe(false);
        });

        it.each(['cancelled', 'rejected'])('a %s stay releases nothing', async status => {
            const propertyId = await property();
            const c = await customer(true);
            await book(propertyId, c.contactId, status);
            const result = await w.run(c.contactId, c.conversationId, 'get_check_in_instructions', { propertyId });
            expect(result.error).toEqual(expect.stringContaining('no active booking'));
            expect(leaked(result)).toBe(false);
        });

        it('another guest\'s stay releases nothing', async () => {
            const propertyId = await property();
            const owner = await customer(true);
            await book(propertyId, owner.contactId, 'confirmed');
            const stranger = await customer(true);
            const result = await w.run(stranger.contactId, stranger.conversationId, 'get_check_in_instructions', { propertyId });
            expect(leaked(result)).toBe(false);
        });

        it('a stay that has not started (or already ended) releases nothing', async () => {
            const propertyId = await property();
            const c = await customer(true);
            await w.q(`INSERT INTO property_bookings(property_id,contact_id,check_in,check_out,status)
                       VALUES($1::uuid,$2::uuid,CURRENT_DATE+5,CURRENT_DATE+7,'confirmed'),
                             ($1::uuid,$2::uuid,CURRENT_DATE-9,CURRENT_DATE-7,'confirmed')`, [propertyId, c.contactId]);
            expect(leaked(await w.run(c.contactId, c.conversationId, 'get_check_in_instructions', { propertyId }))).toBe(false);
        });

    });

    describe('check_policy_status / list_my_claims and the real OTP', () => {
        async function policy(contactId: string, number = `POL-${Math.random().toString(36).slice(2, 8)}`) {
            await w.q(`INSERT INTO insurance_policies(policy_number,contact_id,policyholder_name,monthly_premium,starts_at)
                       VALUES($1,$2::uuid,'Titular QA',50000,CURRENT_DATE-30)`, [number, contactId]);
            return number;
        }

        it('an unverified chat triggers exactly ONE out-of-band code across repeated calls', async () => {
            const c = await customer(false);
            const number = await policy(c.contactId);
            const first = await w.run(c.contactId, c.conversationId, 'check_policy_status', { policyNumber: number });
            expect(first).toMatchObject({ error: 'identity_verification_required' });
            expect(JSON.stringify(first)).not.toContain('Titular QA');
            await w.run(c.contactId, c.conversationId, 'check_policy_status', { policyNumber: number });
            await w.run(c.contactId, c.conversationId, 'list_my_claims', {});
            expect(transport()).toBe(1);
            expect((await challenges(c.conversationId)).filter(r => !r.superseded_at)).toHaveLength(1);
        });

        it('a verified owner reads the policy; another contact\'s policy number reveals nothing', async () => {
            const owner = await customer(true);
            const number = await policy(owner.contactId);
            expect(await w.run(owner.contactId, owner.conversationId, 'check_policy_status', { policyNumber: number }))
                .toMatchObject({ policyNumber: number, policyholderName: 'Titular QA' });
            const stranger = await customer(true);
            const foreign = await w.run(stranger.contactId, stranger.conversationId, 'check_policy_status', { policyNumber: number });
            expect(JSON.stringify(foreign)).not.toContain('Titular QA');
            expect(foreign.policyNumber).toBeUndefined();
        });

    });

    describe('file_claim is ledger-idempotent inside one conversation', () => {
        const claim = { incidentType: 'collision', incidentAt: '2026-09-30', description: 'Choque leve en la 80', claimedAmount: 1500000 };
        async function ready() {
            const c = await customer(true);
            const number = `POL-${Math.random().toString(36).slice(2, 8)}`;
            await w.q(`INSERT INTO insurance_policies(policy_number,contact_id,policyholder_name,monthly_premium,starts_at)
                       VALUES($1,$2::uuid,'Titular QA',50000,CURRENT_DATE-30)`, [number, c.contactId]);
            const policyId = (await w.q('SELECT id::text AS id FROM insurance_policies WHERE policy_number=$1', [number]))[0].id;
            return { ...c, number, policyId };
        }
        const claimsOf = (policyId: string) => w.q('SELECT * FROM insurance_claims WHERE policy_id=$1::uuid', [policyId]);

        it('needs confirmation first; after "sí" it files once and a replay does not file again', async () => {
            const c = await ready();
            const args = { policyNumber: c.number, ...claim };
            const challenge = await w.run(c.contactId, c.conversationId, 'file_claim', args);
            expect(challenge).toMatchObject({ error: 'confirmation_required' });
            expect(await claimsOf(c.policyId)).toHaveLength(0);
            await w.inbound(c.conversationId, 'Sí, confirmo');
            const filed = await w.run(c.contactId, c.conversationId, 'file_claim', args);
            expect(filed).toMatchObject({ status: 'submitted', shouldHandoff: true });
            expect(await claimsOf(c.policyId)).toHaveLength(1);
            await w.run(c.contactId, c.conversationId, 'file_claim', args);
            expect(await claimsOf(c.policyId)).toHaveLength(1);
        });
    });
});
