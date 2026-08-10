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
    };

    function buildService(query: jest.Mock, execute = jest.fn().mockResolvedValue([plan])) {
        const prisma = {
            executeInTenantSchema: execute,
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        return { service: new InsuranceService(prisma as any), prisma };
    }

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

