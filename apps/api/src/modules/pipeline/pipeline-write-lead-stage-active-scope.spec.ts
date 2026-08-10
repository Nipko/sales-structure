import { PipelineService, TenantStageMapping } from './pipeline.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const ACTIVE_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_ACTIVE_ID = '44444444-4444-4444-8444-444444444444';
const CLOSED_ID = '55555555-5555-4555-8555-555555555555';
const PIPELINE_ID = '66666666-6666-4666-8666-666666666666';
const SCHEMA = 'tenant_active_scope';

const stages: TenantStageMapping[] = [
    {
        id: '77777777-7777-4777-8777-777777777777',
        pipeline_id: PIPELINE_ID,
        name: 'Calificado',
        slug: 'calificado',
        position: 0,
        is_terminal: false,
        terminal_outcome: null,
        transition_rules: [],
        prob: 25,
    },
    {
        id: '88888888-8888-4888-8888-888888888888',
        pipeline_id: PIPELINE_ID,
        name: 'Reservado',
        slug: 'reservado',
        position: 1,
        is_terminal: false,
        terminal_outcome: null,
        transition_rules: [{ type: 'appointment_required' }],
        prob: 75,
    },
    {
        id: '99999999-9999-4999-8999-999999999999',
        pipeline_id: PIPELINE_ID,
        name: 'Ganado',
        slug: 'ganado',
        position: 2,
        is_terminal: true,
        terminal_outcome: 'won',
        transition_rules: [],
        prob: 100,
    },
];

type OpportunityRow = {
    id: string;
    stage: string;
    won_at: Date | null;
    lost_at: Date | null;
};

function buildHarness(opportunities: OpportunityRow[]) {
    const txQueries: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
        txQueries.push({ sql, params });
        if (sql.includes('FROM opportunities') && sql.includes('FOR UPDATE')) {
            return opportunities;
        }
        return [];
    });
    const prisma = {
        executeInTenantSchema: jest.fn(),
        transactionInTenantSchema: jest.fn(
            async (_schema: string, callback: (txQuery: typeof query) => Promise<unknown>) => callback(query),
        ),
    };
    const service = new PipelineService(
        prisma as any,
        { get: jest.fn() } as any,
        { emit: jest.fn() } as any,
        {} as any,
        {} as any,
    );

    (service as any).getTenantSchema = jest.fn().mockResolvedValue(SCHEMA);
    (service as any).ensurePipelinesTables = jest.fn().mockResolvedValue(undefined);
    (service as any).migrateToMultiPipeline = jest.fn().mockResolvedValue(PIPELINE_ID);
    (service as any).getTenantStageCatalog = jest.fn().mockResolvedValue(stages);
    (service as any).resolveTenantStage = jest.fn().mockResolvedValue(stages[1]);
    (service as any).syncExactOpportunityDealTx = jest.fn().mockResolvedValue(undefined);
    const evaluateRulesForLeadTx = jest.fn().mockResolvedValue(undefined);
    (service as any).evaluateRulesForLeadTx = evaluateRulesForLeadTx;

    return { service, txQueries, evaluateRulesForLeadTx };
}

describe('PipelineService.writeLeadStage active opportunity rule scope', () => {
    const active = (id: string): OpportunityRow => ({
        id,
        stage: 'calificado',
        won_at: null,
        lost_at: null,
    });
    const closed: OpportunityRow = {
        id: CLOSED_ID,
        stage: 'ganado',
        won_at: new Date('2026-08-01T12:00:00.000Z'),
        lost_at: null,
    };

    it('selects the sole active opportunity when closed history also exists', async () => {
        const { service, txQueries, evaluateRulesForLeadTx } = buildHarness([
            closed,
            active(ACTIVE_ID),
        ]);

        await expect(service.writeLeadStage(TENANT_ID, LEAD_ID, 'reservado', {
            enforceTransitionRules: true,
        })).resolves.toMatchObject({ updatedOpportunities: 1 });

        expect(evaluateRulesForLeadTx).toHaveBeenCalledWith(
            expect.any(Function),
            TENANT_ID,
            LEAD_ID,
            [{ type: 'appointment_required' }],
            ACTIVE_ID,
        );
        const opportunityUpdates = txQueries.filter(({ sql }) => sql.includes('UPDATE opportunities'));
        expect(opportunityUpdates).toHaveLength(1);
        expect(opportunityUpdates[0].params).toEqual(['reservado', ACTIVE_ID]);
    });

    it('does not infer exact ownership when two opportunities are active', async () => {
        const { service, evaluateRulesForLeadTx } = buildHarness([
            active(ACTIVE_ID),
            active(SECOND_ACTIVE_ID),
            closed,
        ]);

        await expect(service.writeLeadStage(TENANT_ID, LEAD_ID, 'reservado', {
            enforceTransitionRules: true,
        })).resolves.toMatchObject({ updatedOpportunities: 2 });

        expect(evaluateRulesForLeadTx).toHaveBeenCalledWith(
            expect.any(Function),
            TENANT_ID,
            LEAD_ID,
            [{ type: 'appointment_required' }],
            null,
        );
    });

    it('does not infer a closed historical opportunity as current ownership', async () => {
        const { service, txQueries, evaluateRulesForLeadTx } = buildHarness([closed]);

        await expect(service.writeLeadStage(TENANT_ID, LEAD_ID, 'reservado', {
            enforceTransitionRules: true,
        })).resolves.toMatchObject({ updatedOpportunities: 0 });

        expect(evaluateRulesForLeadTx).toHaveBeenCalledWith(
            expect.any(Function),
            TENANT_ID,
            LEAD_ID,
            [{ type: 'appointment_required' }],
            null,
        );
        expect(txQueries.some(({ sql }) => sql.includes('UPDATE opportunities'))).toBe(false);
    });
});
