import { BadRequestException, ConflictException } from '@nestjs/common';
import { CrmController } from './crm.controller';

describe('CrmController pipeline-stage identity guard', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const stageId = '22222222-2222-4222-8222-222222222222';

    function createController(usage: { opportunity_count: number; deal_count: number }) {
        const pipelineId = '33333333-3333-4333-8333-333333333333';
        const query = jest.fn(async (sql: string, _params: any[] = []) => {
            if (sql.includes('SELECT id FROM pipelines')) return [{ id: pipelineId }];
            if (sql.includes('AS has_orphans')) return [{ has_orphans: false }];
            if (sql.includes('SELECT slug, is_terminal')) {
                return [{ slug: 'consulta', is_terminal: false, terminal_outcome: null, default_probability: 10 }];
            }
            if (sql.includes('AS opportunity_count')) return [usage];
            return [];
        });
        const prisma: any = {
            $queryRaw: jest.fn().mockResolvedValue([{ schema_name: 'tenant_contract' }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
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
        return { controller, prisma, query };
    }

    it.each([
        { usage: { opportunity_count: 1, deal_count: 0 }, referent: 'opportunity' },
        { usage: { opportunity_count: 0, deal_count: 1 }, referent: 'deal' },
    ])('blocks slug/outcome mutation while the stage is used by a $referent', async ({ usage }) => {
        const { controller, query } = createController(usage);

        await expect(controller.updatePipelineStage(tenantId, stageId, { slug: 'renamed' }))
            .rejects.toBeInstanceOf(ConflictException);

        expect(query.mock.calls.some(([sql]: [string]) =>
            sql.startsWith('UPDATE pipeline_stages SET'),
        )).toBe(false);
    });

    it('allows a stage identity change when no opportunity or deal references it', async () => {
        const { controller, query } = createController({ opportunity_count: 0, deal_count: 0 });

        await controller.updatePipelineStage(tenantId, stageId, { slug: 'renamed' });

        const update = query.mock.calls.find(([sql]: [string]) =>
            sql.startsWith('UPDATE pipeline_stages SET'),
        );
        const updateParams = update?.[1] || [];
        expect(update?.[0]).toContain('AND tenant_id = $');
        expect(updateParams.at(-2)).toBe(tenantId);
        expect(updateParams.at(-1)).toBe('33333333-3333-4333-8333-333333333333');
    });
});

describe('CrmController atomic pipeline replacement', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const stageId = '22222222-2222-4222-8222-222222222222';

    function setup(options?: { failUpdate?: boolean }) {
        const query = jest.fn(async (sql: string, _params: any[] = []) => {
            if (sql.includes('SELECT id FROM pipelines')) {
                return [{ id: '33333333-3333-4333-8333-333333333333' }];
            }
            if (sql.includes('AS has_orphans')) return [{ has_orphans: false }];
            if (sql.includes('FROM pipeline_stages') && sql.includes('FOR UPDATE')) {
                return [{ id: stageId, slug: 'listo_cierre', is_terminal: false, terminal_outcome: null }];
            }
            if (sql.includes('AS opportunity_count')) {
                return [{ opportunity_count: 1, deal_count: 0 }];
            }
            if (options?.failUpdate && sql.includes('SET name =')) throw new Error('forced write failure');
            if (sql.includes('SELECT * FROM pipeline_stages')) {
                return [{ id: stageId, slug: 'listo_para_cierre', is_terminal: false, terminal_outcome: null }];
            }
            return [];
        });
        const prisma: any = {
            $queryRaw: jest.fn().mockResolvedValue([{ schema_name: 'tenant_contract' }]),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const throttle: any = { getPlanLimit: jest.fn().mockResolvedValue(15) };
        const noOp: any = {};
        const controller = new CrmController(
            noOp, noOp, noOp, noOp, noOp, noOp, noOp, noOp,
            noOp, noOp, noOp, noOp, prisma, throttle, noOp,
        );
        return { controller, prisma, query };
    }

    it('requires an explicit outcome for every terminal stage before opening a transaction', async () => {
        const { controller, prisma } = setup();

        await expect(controller.replacePipelineStages(tenantId, {
            stages: [{ name: 'Cerrada', is_terminal: true }],
        })).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('canonicalizes the legacy alias and preserves the referenced stage ID atomically', async () => {
        const { controller, prisma, query } = setup();

        const result = await controller.replacePipelineStages(tenantId, {
            stages: [{
                name: 'Listo para cierre',
                slug: 'listo_cierre',
                is_terminal: false,
                terminal_outcome: null,
            }],
        });

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(query.mock.calls.some(([sql]) => sql.includes("SET stage = 'listo_para_cierre'"))).toBe(true);
        expect(query.mock.calls.some(([sql]) => sql.includes('SET name ='))).toBe(true);
        expect(result.data[0].slug).toBe('listo_para_cierre');
    });

    it('surfaces a write failure from the single transaction instead of reporting a partial save', async () => {
        const { controller } = setup({ failUpdate: true });

        await expect(controller.replacePipelineStages(tenantId, {
            stages: [{ name: 'Listo para cierre', slug: 'listo_para_cierre', is_terminal: false }],
        })).rejects.toThrow('forced write failure');
    });
});
