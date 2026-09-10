import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { LearningController } from './learning.controller';

/**
 * What survives a learning decision.
 *
 * `created_by`, `published_by` and `retired_by` sit inside the tenant schema
 * next to the release they describe, and a retraction blanks that release. So
 * the decision most likely to be questioned later — who withdrew this, and how
 * much came out with it — was the one whose record disappeared along with the
 * data. The audit row lives in the public schema and carries no transcript, so
 * it outlives both the retraction and the erasure it may have to explain.
 */
describe('what survives a learning decision', () => {
    const tenantId = 'tenant-1', agentId = 'agent-1', releaseId = 'release-1';

    const build = (over: { learning?: any; create?: jest.Mock } = {}) => {
        const create = over.create ?? jest.fn(async () => ({ id: 'audit-1' }));
        const findMany = jest.fn(async (_args?: any) => [{ id: 'audit-1' }]);
        const learning = {
            publish: jest.fn(async () => ({ published: releaseId })),
            rollback: jest.fn(async () => ({ retired: releaseId, retractedReleases: 3 })),
            importInbox: jest.fn(async () => ({ sourceId: 'source-1' })),
            withdrawSource: jest.fn(async () => ({ withdrawn: 'source-1' })),
            ...over.learning,
        };
        const prisma = { auditLog: { create, findMany } } as any;
        return { controller: new LearningController(learning as any, prisma), learning, create, findMany };
    };

    const request = (user: Record<string, unknown>) => ({ user });
    const admin = request({ id: 'user-1' });
    const detailsOf = (create: jest.Mock) => create.mock.calls[0][0].data.details;

    it('records who published, against which release and at what traffic', async () => {
        const { controller, create } = build();
        await controller.publish(tenantId, agentId, releaseId, { trafficPercent: 25 }, admin);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toMatchObject({
            tenantId, userId: 'user-1', action: 'learning.release_published', resource: 'learning_release',
        });
        expect(detailsOf(create)).toMatchObject({ agentId, releaseId, trafficPercent: 25 });
    });

    it('records how much a rollback actually retracted', async () => {
        const { controller, create } = build();
        await controller.rollback(tenantId, agentId, releaseId, admin);
        // `retired_by` on the release says who. The descendants that came out
        // with it are counted nowhere else, and that row is about to be blanked.
        expect(detailsOf(create)).toMatchObject({ releaseId, retired: releaseId, retractedReleases: 3 });
        expect(create.mock.calls[0][0].data.action).toBe('learning.release_rolled_back');
    });

    it('names the real operator behind an impersonated session, without erasing the effective one', async () => {
        const { controller, create } = build();
        await controller.publish(tenantId, agentId, releaseId, { trafficPercent: 10 }, request({
            id: 'tenant-admin-9', isImpersonation: true, impersonatedBy: 'super-admin-3', impersonationSid: 'sid-7',
        }));
        // Recording the effective id alone would tell an auditor the customer's
        // own admin published this to themselves.
        expect(create.mock.calls[0][0].data.userId).toBe('tenant-admin-9');
        expect(detailsOf(create)).toMatchObject({
            viaImpersonation: true, performedBy: 'super-admin-3', impersonationSid: 'sid-7',
        });
    });

    it('never puts the customer words in the row that outlives their erasure', async () => {
        const { controller, create } = build();
        await controller.importInbox(tenantId, agentId, { conversationId: 'conversation-4' }, admin);
        const details = detailsOf(create);
        expect(details).toMatchObject({ agentId, kind: 'inbox', conversationId: 'conversation-4' });
        // Identifiers are erasable through their own tables; a transcript copied
        // into a public audit row would not be reachable by any of them.
        expect(JSON.stringify(details)).not.toMatch(/transcript|messages|content_text/i);
    });

    it('still reports a publication whose audit row could not be written', async () => {
        const create = jest.fn(async () => { throw new Error('audit table unavailable'); });
        const { controller, learning } = build({ create });
        // The publication already committed. Turning it into an error response
        // sends the operator back to publish a second time.
        await expect(controller.publish(tenantId, agentId, releaseId, { trafficPercent: 5 }, admin))
            .resolves.toMatchObject({ success: true });
        expect(learning.publish).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the action itself failed', async () => {
        const { controller, create } = build({
            learning: { publish: jest.fn(async () => { throw new Error('learning_release_not_evaluated'); }) },
        });
        await expect(controller.publish(tenantId, agentId, releaseId, { trafficPercent: 5 }, admin)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
    });

    it('asks the database for one agent instead of trimming a page afterwards', async () => {
        const { controller, findMany } = build();
        await controller.auditTrail(tenantId, agentId, '25');
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId, action: { startsWith: 'learning.' }, details: { path: ['agentId'], equals: agentId } },
            take: 25,
        }));
        // A caller cannot ask for an unbounded page, and a nonsense limit is a
        // default rather than a crash.
        await controller.auditTrail(tenantId, agentId, '5000');
        expect(findMany.mock.calls[1][0].take).toBe(200);
        await controller.auditTrail(tenantId, agentId, 'not-a-number');
        expect(findMany.mock.calls[2][0].take).toBe(50);
    });

    it('declares the audit route before anything that could swallow it', () => {
        // Nest matches in declaration order, so a `:param` GET declared earlier
        // would answer `/audit` with a lookup for a source called "audit".
        const names = Object.getOwnPropertyNames(LearningController.prototype).filter(name => name !== 'constructor');
        const paths = names.map(name => [name, Reflect.getMetadata(PATH_METADATA,
            (LearningController.prototype as any)[name])] as const);
        const audit = paths.findIndex(([, path]) => path === 'audit');
        expect(audit).toBeGreaterThanOrEqual(0);
        const shadowing = paths.slice(0, audit).filter(([, path]) => typeof path === 'string' && path.startsWith(':'));
        expect(shadowing).toEqual([]);
    });
});
