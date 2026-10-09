import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { InsuranceService } from '../insurance/insurance.service';
import { READINESS } from '../verticals/vertical-readiness.service';

/**
 * While a family is read-only (its catalogue is empty, `catalogReadGroups`), the readers are published without the
 * family's readiness. An offer without a price must not slip through that door: a stay with no nightly rate and an
 * insurance plan with no premium are not offers the agent can quote, and readiness itself never counted them as rows.
 * The readers apply the SAME price predicate readiness uses, so «the catalogue has rows» and «the agent may show it»
 * cannot disagree.
 */
describe('read-only families never show an offer without a price', () => {
    const schemaName = 'tenant_priced';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';

    function harness() {
        const queries: string[] = [];
        const prisma = {
            $queryRawUnsafe: jest.fn(async (sql: string) => { queries.push(sql); return []; }),
            $executeRawUnsafe: jest.fn(),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const insuranceService = { listPlans: jest.fn().mockResolvedValue([]) };
        const control = {
            preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
            complete: jest.fn().mockResolvedValue(undefined),
            fail: jest.fn().mockResolvedValue(undefined),
        };
        const dependencies: any[] = Array(32).fill({});
        dependencies[0] = prisma; dependencies[15] = insuranceService; dependencies[21] = control;
        const executor = new (AIToolExecutorService as any)(...dependencies) as AIToolExecutorService;
        for (const level of ['log', 'warn', 'error']) jest.spyOn((executor as any).logger, level).mockImplementation(() => undefined);
        const run = (tool: string, args: Record<string, any>) =>
            executor.execute(schemaName, tenantId, contactId, tool, args, undefined, { authority: authorityFor(tool) });
        return { run, queries, insuranceService };
    }

    it('list_properties selects only properties with a nightly rate', async () => {
        const h = harness();
        const result = await h.run('list_properties', { guests: 2 });
        const sql = h.queries.find(query => query.includes('.properties'))!;
        expect(sql).toContain('night_price IS NOT NULL');
        expect(sql).toContain('night_price > 0');
        expect(sql).toContain('is_active = true');
        expect(result.catalog_empty).toBe(true); // the empty-catalogue answer, not an error
    });

    it('get_insurance_plans asks only for quotable plans', async () => {
        const h = harness();
        const result = await h.run('get_insurance_plans', {});
        expect(h.insuranceService.listPlans).toHaveBeenCalledWith(schemaName, expect.objectContaining({ quotableOnly: true }));
        expect(result.catalog_empty).toBe(true);
    });

    it('the quotable predicate requires a positive premium and a currency, the same as readiness', async () => {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        await new InsuranceService(prisma as any).listPlans(schemaName, { quotableOnly: true });
        const sql = String(prisma.executeInTenantSchema.mock.calls[0][1]);
        expect(sql).toContain('monthly_premium_min IS NOT NULL AND monthly_premium_min > 0');
        expect(sql).toContain("currency IS NOT NULL AND currency <> ''");
        expect(READINESS.insurance_plans!.where).toContain('monthly_premium_min IS NOT NULL');
        expect(READINESS.insurance_plans!.where).toContain('monthly_premium_min > 0');
        expect(READINESS.properties!.where).toContain('night_price IS NOT NULL AND night_price > 0');
    });
});
