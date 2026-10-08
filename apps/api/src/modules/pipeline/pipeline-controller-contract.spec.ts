import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BadRequestException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PipelineController } from './pipeline.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PIPELINE_ID = '22222222-2222-4222-8222-222222222222';
// RequestMethod enum: GET=0 POST=1 PUT=2 DELETE=3
const VERB = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

function routes(): Array<{ verb: string; path: string; handler: string }> {
    const proto = PipelineController.prototype as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
        .map((name) => {
            const fn = proto[name] as object;
            return {
                verb: VERB[Reflect.getMetadata(METHOD_METADATA, fn)],
                path: Reflect.getMetadata(PATH_METADATA, fn),
                handler: name,
            };
        })
        .filter((r) => r.verb && typeof r.path === 'string');
}

function patternFor(path: string): RegExp {
    return new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}$`);
}

function rolesFor(handler: string): string[] {
    const fn = (PipelineController.prototype as unknown as Record<string, object>)[handler];
    return Reflect.getMetadata(ROLES_KEY, fn) ?? [];
}

function buildController() {
    const pipelineService = {
        listPipelines: jest.fn().mockResolvedValue([{ id: PIPELINE_ID, is_default: true }]),
        createPipeline: jest.fn().mockResolvedValue({ id: PIPELINE_ID }),
        updatePipeline: jest.fn().mockResolvedValue({ success: true }),
        deletePipeline: jest.fn().mockResolvedValue({ success: true }),
        getKanban: jest.fn().mockResolvedValue({ stages: [] }),
    };
    const controller = new PipelineController(pipelineService as any, {} as any);
    return { controller, pipelineService };
}

describe('PipelineController exposes the multi-pipeline routes the dashboard calls', () => {
    it('serves GET/POST/PUT/DELETE pipelines/:tenantId[/:pipelineId]', () => {
        const table = routes().map((r) => `${r.verb} ${r.path}`);
        expect(table).toEqual(expect.arrayContaining([
            'GET pipelines/:tenantId',
            'POST pipelines/:tenantId',
            'PUT pipelines/:tenantId/:pipelineId',
            'DELETE pipelines/:tenantId/:pipelineId',
        ]));
    });

    it('every /pipeline/... URL the dashboard api client builds resolves to a controller route', () => {
        const source = readFileSync(
            resolve(__dirname, '..', '..', '..', '..', 'dashboard', 'src', 'lib', 'api.ts'),
            'utf8',
        );
        const calls = [...source.matchAll(/api(Get|Post|Put|Delete)\(\s*`\/pipeline\/([^`?]*)/g)].map((m) => ({
            verb: m[1].toUpperCase(),
            // `${tenantId}` / `${dealId}` placeholders become path params.
            path: m[2].replace(/\$\{[^}]+\}/g, ':p'),
        }));
        expect(calls.length).toBeGreaterThan(5);

        const table = routes();
        const orphans = calls.filter((call) =>
            !table.some((route) => route.verb === call.verb && patternFor(route.path).test(call.path.replace(/:p/g, 'x'))),
        );
        expect(orphans).toEqual([]);
    });

    it('lets every inbox role read pipelines but only admins/supervisors mutate them', () => {
        expect(rolesFor('listPipelines')).toEqual([]);
        for (const handler of ['createPipeline', 'updatePipeline', 'deletePipeline']) {
            expect(rolesFor(handler)).toEqual(['tenant_admin', 'tenant_supervisor']);
        }
    });

    it('delegates to the plan-limited, tenant-scoped service and forwards pipelineId to the kanban', async () => {
        const { controller, pipelineService } = buildController();

        await expect(controller.listPipelines(TENANT_ID)).resolves.toEqual({
            success: true,
            data: [{ id: PIPELINE_ID, is_default: true }],
        });
        await controller.createPipeline(TENANT_ID, { name: '  Renovaciones ', description: 'x' });
        expect(pipelineService.createPipeline).toHaveBeenCalledWith(TENANT_ID, { name: 'Renovaciones', description: 'x' });
        await controller.updatePipeline(TENANT_ID, PIPELINE_ID, { name: 'Nuevo nombre' });
        expect(pipelineService.updatePipeline).toHaveBeenCalledWith(TENANT_ID, PIPELINE_ID, {
            name: 'Nuevo nombre',
            description: undefined,
        });
        await controller.deletePipeline(TENANT_ID, PIPELINE_ID);
        expect(pipelineService.deletePipeline).toHaveBeenCalledWith(TENANT_ID, PIPELINE_ID);
        await controller.getKanban(TENANT_ID, PIPELINE_ID);
        expect(pipelineService.getKanban).toHaveBeenCalledWith(TENANT_ID, PIPELINE_ID);
    });

    it('rejects a blank or oversized pipeline name before touching the service', async () => {
        const { controller, pipelineService } = buildController();
        await expect(controller.createPipeline(TENANT_ID, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.createPipeline(TENANT_ID, { name: 'x'.repeat(121) })).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.updatePipeline(TENANT_ID, PIPELINE_ID, { name: '' })).rejects.toBeInstanceOf(BadRequestException);
        expect(pipelineService.createPipeline).not.toHaveBeenCalled();
        expect(pipelineService.updatePipeline).not.toHaveBeenCalled();
    });
});
