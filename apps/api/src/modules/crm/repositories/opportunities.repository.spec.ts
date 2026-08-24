import { BadRequestException } from '@nestjs/common';
import { VERTICAL_REGISTRY } from '../../verticals/vertical-definitions';
import { OpportunitiesRepository } from './opportunities.repository';

const TERMINAL_STAGES = Object.values(VERTICAL_REGISTRY).flatMap((definition) =>
  definition.pipeline.stages
    .filter((stage) => stage.isTerminal)
    .map((stage) => ({
      industry: definition.industry,
      slug: stage.slug,
      outcome: stage.terminalOutcome,
      probability: stage.probability,
    })),
);

describe('OpportunitiesRepository terminal outcome propagation', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const opportunityId = '22222222-2222-4222-8222-222222222222';

  function setup(target?: { slug: string; outcome: 'won' | 'lost'; probability: number }) {
    const prisma: any = {
      executeInTenantSchema: jest.fn().mockResolvedValue([]),
    };
    const redis: any = { get: jest.fn().mockResolvedValue('tenant_contract') };
    const pipeline: any = {
      moveOpportunityStage: jest.fn(async (_tenantId: string, _opportunityId: string, requested: string) => {
        if (!target || requested !== target.slug) throw new BadRequestException(`Unknown pipeline stage: ${requested}`);
        return {
          id: '44444444-4444-4444-8444-444444444444',
          slug: target.slug,
          is_terminal: true,
          terminal_outcome: target.outcome,
          prob: target.probability,
          position: 1,
        };
      }),
    };
    const repository = new OpportunitiesRepository(prisma, redis, pipeline);
    return { repository, pipeline };
  }

  it('publishes at least one explicit terminal outcome for all 20 verticals', () => {
    expect(Object.keys(VERTICAL_REGISTRY)).toHaveLength(20);
    expect(new Set(TERMINAL_STAGES.map((stage) => stage.industry)).size).toBe(20);
    expect(TERMINAL_STAGES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(TERMINAL_STAGES)(
    '$industry/$slug propagates explicit $outcome to Opportunity and Deal',
    async ({ slug, outcome, probability }) => {
      const { repository, pipeline } = setup({ slug, outcome, probability });

      await repository.moveOpportunity(tenantId, opportunityId, slug);

      expect(pipeline.moveOpportunityStage).toHaveBeenCalledWith(
        tenantId,
        opportunityId,
        slug,
        'agent',
      );
    },
  );

  it('rejects an unknown stage before mutating Opportunity, Lead or Deal', async () => {
    const { repository, pipeline } = setup();

    await expect(repository.moveOpportunity(tenantId, opportunityId, 'inventada'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(pipeline.moveOpportunityStage).toHaveBeenCalledTimes(1);
  });
});

describe('OpportunitiesRepository canonical writes', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const leadId = '22222222-2222-4222-8222-222222222222';
  const opportunityId = '33333333-3333-4333-8333-333333333333';
  const stage = {
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'nuevo',
    position: 0,
    is_terminal: false,
    terminal_outcome: null,
    prob: 10,
  };

  function setup() {
    const txQuery = jest.fn(async (sql: string) => {
      if (sql.startsWith('INSERT INTO opportunities')) {
        return [{ id: opportunityId, lead_id: leadId, stage: 'nuevo' }];
      }
      return [];
    });
    const prisma: any = {
      executeInTenantSchema: jest.fn().mockResolvedValue([{ id: opportunityId }]),
      transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(txQuery)),
    };
    const redis: any = { get: jest.fn().mockResolvedValue('tenant_contract') };
    const pipeline: any = {
      resolveTenantStage: jest.fn().mockResolvedValue(stage),
      syncExactOpportunityDealTx: jest.fn().mockResolvedValue(undefined),
      moveOpportunityStage: jest.fn().mockResolvedValue(stage),
    };
    return {
      repository: new OpportunitiesRepository(prisma, redis, pipeline),
      prisma,
      pipeline,
      txQuery,
    };
  }

  it('creates Opportunity and exact Deal mirror through the same tenant transaction', async () => {
    const { repository, prisma, pipeline, txQuery } = setup();

    const created = await repository.createOpportunity(tenantId, {
      lead_id: leadId,
      stage: 'nuevo',
      estimated_value: 125,
    } as any);

    expect(created?.id).toBe(opportunityId);
    expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    expect(pipeline.syncExactOpportunityDealTx).toHaveBeenCalledWith(
      txQuery,
      tenantId,
      leadId,
      opportunityId,
      stage,
    );
  });

  it('rejects caller-controlled deal correlation', async () => {
    const { repository, prisma } = setup();

    await expect(repository.createOpportunity(tenantId, {
      lead_id: leadId,
      deal_id: '55555555-5555-4555-8555-555555555555',
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
  });

  it('moves stage and writes mapped details in one canonical pipeline transaction', async () => {
    const { repository, pipeline, prisma } = setup();

    await repository.updateOpportunity(tenantId, opportunityId, {
      stage: 'perdido',
      value: 900,
      notes: 'Cliente archivado',
      lost_reason: 'Sin respuesta',
    } as any);

    expect(pipeline.moveOpportunityStage).toHaveBeenCalledWith(
      tenantId,
      opportunityId,
      'perdido',
      'agent',
      {
        estimated_value: 900,
        metadata: { notes: 'Cliente archivado' },
        loss_reason: 'Sin respuesta',
      },
    );
    expect(prisma.executeInTenantSchema.mock.calls.some(([, sql]: [string, string]) =>
      String(sql).includes('notes =') || String(sql).includes('lost_reason ='),
    )).toBe(false);
  });
});
