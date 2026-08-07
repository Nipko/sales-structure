import { ConflictException } from '@nestjs/common';
import { CrmController } from './crm.controller';

describe('CrmController pipeline-stage identity guard', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const stageId = '22222222-2222-4222-8222-222222222222';

    function createController(usage: { opportunity_count: number; deal_count: number }) {
        const prisma: any = {
            $queryRaw: jest.fn().mockResolvedValue([{ schema_name: 'tenant_contract' }]),
            executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
                if (query.includes('SELECT slug, is_terminal')) {
                    return [{ slug: 'consulta', is_terminal: false, terminal_outcome: null, default_probability: 10 }];
                }
                if (query.includes('AS opportunity_count')) return [usage];
                return [];
            }),
        };
        const noOp: any = {};
        const controller = new CrmController(
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            noOp,
            prisma,
            noOp,
            noOp,
        );
        return { controller, prisma };
    }

    it.each([
        { usage: { opportunity_count: 1, deal_count: 0 }, referent: 'opportunity' },
        { usage: { opportunity_count: 0, deal_count: 1 }, referent: 'deal' },
    ])('blocks slug/outcome mutation while the stage is used by a $referent', async ({ usage }) => {
        const { controller, prisma } = createController(usage);

        await expect(controller.updatePipelineStage(tenantId, stageId, { slug: 'renamed' }))
            .rejects.toBeInstanceOf(ConflictException);

        expect(prisma.executeInTenantSchema.mock.calls.some(([, query]: [string, string]) =>
            query.startsWith('UPDATE pipeline_stages'),
        )).toBe(false);
    });

    it('allows a stage identity change when no opportunity or deal references it', async () => {
        const { controller, prisma } = createController({ opportunity_count: 0, deal_count: 0 });

        await controller.updatePipelineStage(tenantId, stageId, { slug: 'renamed' });

        const update = prisma.executeInTenantSchema.mock.calls.find(([, query]: [string, string]) =>
            query.startsWith('UPDATE pipeline_stages'),
        );
        expect(update?.[1]).toContain('AND tenant_id = $');
        expect(update?.[2].at(-1)).toBe(tenantId);
    });
});
