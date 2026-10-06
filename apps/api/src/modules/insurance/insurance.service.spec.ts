import { BadRequestException } from '@nestjs/common';
import { InsuranceService } from './insurance.service';

describe('InsuranceService contact integrity', () => {
    const schemaName = 'tenant_insurance';
    const planId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const plan = {
        id: planId,
        name: 'Plan Vida',
        insurance_type: 'life',
        monthly_premium_min: 100,
        monthly_premium_max: 100,
        currency: 'COP',
        is_active: true,
    };

    function buildService(query: jest.Mock, execute = jest.fn().mockResolvedValue([plan])) {
        const prisma = {
            executeInTenantSchema: execute,
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        return { service: new InsuranceService(prisma as any), prisma };
    }

    it('uses the quotable catalogue predicate without hiding drafts from administrators', async () => {
        const execute = jest.fn().mockResolvedValue([]);
        const { service } = buildService(jest.fn(), execute);

        await service.listPlans(schemaName, { quotableOnly: true });
        expect(execute.mock.calls[0][1]).toContain('monthly_premium_min > 0');
        expect(execute.mock.calls[0][1]).toContain("currency <> ''");

        await service.listPlans(schemaName);
        expect(execute.mock.calls[1][1]).not.toContain('monthly_premium_min > 0');
    });

    it.each([
        { ...plan, is_active: false },
        { ...plan, monthly_premium_min: null },
        { ...plan, monthly_premium_min: 0 },
        { ...plan, currency: '' },
    ])('refuses to persist a zero or unpriceable quote', async (invalidPlan) => {
        const query = jest.fn();
        const { service, prisma } = buildService(query, jest.fn().mockResolvedValue([invalidPlan]));

        await expect(service.createQuote(schemaName, { planId }))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'insurance_plan_not_quotable' }) });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects malformed contacts before quote or policy database work', async () => {
        const { service, prisma } = buildService(jest.fn());

        await expect(service.createQuote(schemaName, { planId, contactId: 'bad' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.createPolicy(schemaName, {
            policyNumber: 'P-1',
            contactId: 'bad',
            policyholderName: 'Ana',
            monthlyPremium: 100,
            startsAt: '2026-09-01',
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects a foreign contact before inserting a quote', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { service } = buildService(query);

        await expect(service.createQuote(schemaName, { planId, contactId }))
            .rejects.toThrow('contactId does not belong to this tenant');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO insurance_quotes'))).toBe(false);
    });

    it('rejects a foreign contact before inserting a policy', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { service } = buildService(query);

        await expect(service.createPolicy(schemaName, {
            policyNumber: 'P-1',
            contactId,
            policyholderName: 'Ana',
            monthlyPremium: 100,
            startsAt: '2026-09-01',
        })).rejects.toThrow('contactId does not belong to this tenant');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO insurance_policies'))).toBe(false);
    });

    it('persists the validated contact in quotes and policies', async () => {
        const quote = { id: '33333333-3333-4333-8333-333333333333', contact_id: contactId };
        const policy = { id: '44444444-4444-4444-8444-444444444444', contact_id: contactId };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('INSERT INTO insurance_quotes')) {
                expect(params?.[0]).toBe(contactId);
                return [quote];
            }
            if (sql.includes('INSERT INTO insurance_policies')) {
                expect(params?.[1]).toBe(contactId);
                return [policy];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(query);

        await expect(service.createQuote(schemaName, { planId, contactId }))
            .resolves.toMatchObject({ ...quote, plan_name: plan.name });
        await expect(service.createPolicy(schemaName, {
            policyNumber: 'P-2',
            contactId,
            policyholderName: 'Ana',
            monthlyPremium: 100,
            startsAt: '2026-09-01',
        })).resolves.toBe(policy);
        expect(query.mock.calls.filter(([sql]) => sql.includes('FROM contacts'))).toHaveLength(2);
    });
});


describe('InsuranceService applicant age', () => {
    const planId = '11111111-1111-4111-8111-111111111111';
    const ranged = {
        id: planId, name: 'Vida Plus', insurance_type: 'vida', monthly_premium_min: 50000, monthly_premium_max: 150000,
        currency: 'COP', min_age: 18, max_age: 60, is_active: true,
    };
    const build = (plan: any) => {
        const query = jest.fn().mockResolvedValue([{ id: 'q1', monthly_premium: 1, annual_premium: 12 }]);
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([plan]),
            transactionInTenantSchema: jest.fn(async (_s: string, cb: any) => cb(query)),
        };
        const service = new InsuranceService(prisma as any);
        jest.spyOn(service as any, 'confirmQuote').mockResolvedValue(undefined);
        return { service, prisma };
    };

    it.each([
        [82, 'insurance_applicant_age_out_of_range'], [61, 'insurance_applicant_age_out_of_range'], [17, 'insurance_applicant_age_out_of_range'],
        [undefined, 'insurance_applicant_age_required'], [null, 'insurance_applicant_age_required'],
        [-3, 'insurance_applicant_age_invalid'], [Number.NaN, 'insurance_applicant_age_invalid'], [200, 'insurance_applicant_age_invalid'],
        [' ', 'insurance_applicant_age_invalid'], [true, 'insurance_applicant_age_invalid'], ['abc', 'insurance_applicant_age_invalid'],
    ])('refuses age %p with %s and stores nothing', async (age, code) => {
        const { service, prisma } = build(ranged);
        await expect(service.createQuote('t', { planId, applicantAge: age as any }))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: code }) });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it.each([[18], [39], [60], ['45' as any]])('quotes age %p', async age => {
        const { service, prisma } = build(ranged);
        await service.createQuote('t', { planId, applicantAge: age });
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('asks for the age when the premium varies even if the plan has no age limits, and does not when nothing depends on it', async () => {
        const open = { ...ranged, min_age: null, max_age: null };
        await expect(build(open).service.createQuote('t', { planId }))
            .rejects.toMatchObject({ response: expect.objectContaining({ error: 'insurance_applicant_age_required' }) });
        const flat = { ...open, monthly_premium_max: 50000 };
        const { service, prisma } = build(flat);
        await service.createQuote('t', { planId });
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    });
});
