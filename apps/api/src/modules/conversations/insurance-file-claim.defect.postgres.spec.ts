import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';

/**
 * DEFECT SPEC (kept red on purpose) - file_claim is not idempotent beyond one conversation.
 *
 * Promise: the same incident on the same policy is filed once. The central ledger only
 * deduplicates identical calls within one conversation (and CONFIRMATION_TTL_MS); the domain
 * writer InsuranceService.fileClaim (insurance.service.ts:372-395) has no natural key, so a
 * customer who comes back in a new conversation and the agent re-files the same incident
 * creates a second claim. Also the claim number `C-${Date.now().toString(36)}` is not unique:
 * two filings in the same millisecond share a number and the column has no UNIQUE constraint.
 */
(isolationUrl ? describe : describe.skip)('DEFECT N3: insurance file_claim idempotency', () => {
    jest.setTimeout(120_000);
    let w: World;
    const claim = { incidentType: 'collision', incidentAt: '2026-09-30', description: 'Choque leve en la 80', claimedAmount: 1500000 };
    beforeAll(async () => { w = await buildWorld('clm'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });

    async function policyOwner() {
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Quiero radicar un siniestro');
        await w.verify(conversationId, contactId);
        const number = `POL-${Math.random().toString(36).slice(2, 8)}`;
        await w.q(`INSERT INTO insurance_policies(policy_number,contact_id,policyholder_name,monthly_premium,starts_at)
                   VALUES($1,$2::uuid,'Titular QA',50000,CURRENT_DATE-30)`, [number, contactId]);
        const policyId = (await w.q('SELECT id::text AS id FROM insurance_policies WHERE policy_number=$1', [number]))[0].id;
        return { contactId, conversationId, number, policyId };
    }
    const claimsOf = (policyId: string) => w.q('SELECT claim_number,incident_type,description FROM insurance_claims WHERE policy_id=$1::uuid', [policyId]);

    it('the same incident re-filed from a new conversation of the same verified customer creates one claim', async () => {
        const c = await policyOwner();
        const args = { policyNumber: c.number, ...claim };
        await w.run(c.contactId, c.conversationId, 'file_claim', args);
        await w.inbound(c.conversationId, 'Sí, confirmo');
        expect(await w.run(c.contactId, c.conversationId, 'file_claim', args)).toMatchObject({ status: 'submitted' });

        const second = await w.newConversation(c.contactId);
        await w.inbound(second, 'Hola otra vez, ¿radicaste mi siniestro?');
        await w.verify(second, c.contactId);
        await w.run(c.contactId, second, 'file_claim', args);
        await w.inbound(second, 'Sí, confirmo');
        await w.run(c.contactId, second, 'file_claim', args);

        expect((await claimsOf(c.policyId)).length).toBe(1);
    });

    async function serviceWith(prisma: any) {
        const { InsuranceService } = await import('../insurance/insurance.service');
        const service: any = Object.create(InsuranceService.prototype);
        service.prisma = prisma;
        return service;
    }

    it('concurrent filings of the same incident serialize on the per-policy lock (forced interleaving)', async () => {
        const c = await policyOwner();
        // Barrier right after the existence SELECT: without the lock both callers
        // pass it with no row and both insert. With the lock the second caller
        // cannot even reach the SELECT until the first has committed.
        let arrived = 0;
        let release: () => void = () => undefined;
        const both = new Promise<void>(resolve => { release = resolve; });
        const prisma = Object.create(w.prisma);
        prisma.transactionInTenantSchema = (schema: string, fn: any, opts?: any) =>
            w.prisma.transactionInTenantSchema(schema, async (query: any) => fn(async (sql: string, params?: any[]) => {
                const rows = await query(sql, params);
                if (/FROM insurance_claims/.test(sql) && /SELECT/.test(sql)) {
                    arrived += 1;
                    if (arrived >= 2) release();
                    await Promise.race([both, new Promise(resolve => setTimeout(resolve, 1500))]);
                }
                return rows;
            }), opts);
        const service = await serviceWith(prisma);
        const data = { policyId: c.policyId, incidentType: 'collision', incidentAt: '2026-09-29', description: 'Choque' };
        await Promise.all([service.fileClaim(w.schema, data), service.fileClaim(w.schema, data)]);
        expect((await claimsOf(c.policyId)).length).toBe(1);
    });

    it('without incidentType the same normalized description within 24h is the same claim', async () => {
        const c = await policyOwner();
        const service = await serviceWith(w.prisma);
        const first = await service.fileClaim(w.schema, { policyId: c.policyId, description: 'Me robaron el  CELULAR' });
        const second = await service.fileClaim(w.schema, { policyId: c.policyId, description: '  me robaron el celular ' });
        const other = await service.fileClaim(w.schema, { policyId: c.policyId, description: 'Otro siniestro distinto' });
        expect({ sameId: second.id === first.id, flagged: second.alreadyFiled === true, otherNew: other.id !== first.id })
            .toEqual({ sameId: true, flagged: true, otherNew: true });
        expect((await claimsOf(c.policyId)).length).toBe(2);
    });

    it('rejects non-string fields with a 400 instead of crashing, and the HTTP POST reports a repeat as 200 alreadyFiled', async () => {
        const c = await policyOwner();
        const service = await serviceWith(w.prisma);
        await expect(service.fileClaim(w.schema, { policyId: c.policyId, incidentType: 42 as any })).rejects.toMatchObject({ status: 400 });
        const { InsuranceController } = await import('../insurance/insurance.controller');
        const controller: any = Object.create(InsuranceController.prototype);
        controller.service = service;
        controller.prisma = { getTenantSchemaName: async () => w.schema };
        const res = { status: jest.fn() };
        const body = { policyId: c.policyId, incidentType: 'theft', incidentAt: '2026-09-28', description: 'Hurto' };
        const first = await controller.fileClaim(w.tenantId, body, res);
        const second = await controller.fileClaim(w.tenantId, body, res);
        expect({ firstFlag: first.alreadyFiled, secondFlag: second.alreadyFiled, secondId: second.data.id === first.data.id, status200: res.status.mock.calls })
            .toEqual({ firstFlag: undefined, secondFlag: true, secondId: true, status200: [[200]] });
    });

    it('two claims filed in the same millisecond get distinct claim numbers', async () => {
        const c = await policyOwner();
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
        try {
            const { InsuranceService } = await import('../insurance/insurance.service');
            const service: any = Object.create(InsuranceService.prototype);
            service.prisma = w.prisma;
            await Promise.all([
                service.fileClaim(w.schema, { policyId: c.policyId, incidentType: 'theft', description: 'A' }),
                service.fileClaim(w.schema, { policyId: c.policyId, incidentType: 'fire', description: 'B' }),
            ]);
        } finally { now.mockRestore(); }
        const numbers = (await claimsOf(c.policyId)).map(r => r.claim_number);
        expect({ filed: numbers.length, distinct: new Set(numbers).size }).toEqual({ filed: 2, distinct: 2 });
    });
});
