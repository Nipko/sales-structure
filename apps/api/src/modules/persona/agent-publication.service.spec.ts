import { AgentPublicationService } from './agent-publication.service';
import * as entitlementUtil from '../../common/utils/subscription-entitlement.util';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

const tenantId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const candidateId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const superId = '55555555-5555-4555-8555-555555555555';
const schemaName = 'tenant_publication';

const admin = { id: actorId, role: 'tenant_admin' };
const supervisor = { id: actorId, role: 'tenant_supervisor' };

const receipt = { id: 'pub-1', agentId, kind: 'publish' as const, operationalVersion: 8,
    operationalHash: 'b'.repeat(64), idempotentReplay: false };

const publishBody: any = { expectedOperationalVersion: 7, expectedOperationalHash: 'a'.repeat(64),
    requestKey: 'req-1', expectedCandidateVersion: 2, evidenceHash: 'c'.repeat(64), activation: 'preserve' };

/**
 * ═══ LA PUERTA QUE LA PRIMITIVA SE NEGABA A SER ═══
 *
 * `AgentPublicationStore` lo dice de sí mismo: no es un endpoint, y quien lo
 * exponga tiene que aportar las comprobaciones vivas. Nadie las aportaba, así
 * que un candidato revisado y aprobado no tenía cómo llegar al agente que
 * atiende clientes.
 *
 * Lo que se prueba acá es exactamente esa capa: quién puede pedirlo, qué se
 * vuelve a comprobar en el instante del efecto, y qué pasa después del COMMIT.
 * Las garantías transaccionales del primitivo ya las fija su propia suite con
 * PostgreSQL real.
 */
describe('AgentPublicationService', () => {
    function harness(options: {
        access?: { allowed: boolean; error?: string };
        entitlementError?: Error;
        manifestError?: Error;
        cacheFails?: boolean;
        auditFails?: boolean;
        replay?: boolean;
        notifyFails?: boolean;
    } = {}) {
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM public.tenants')) return [{ id: tenantId, industry: 'otro', settings: {} }];
            if (sql.includes('FROM agent_personas')) return [{ id: agentId, version: 7 }];
            if (sql.includes('agent_publication_heads')) return [];
            if (sql.includes('agent_publication_events')) return [];
            return [];
        });
        const prisma: any = {
            getTenantSchemaName: jest.fn(async () => schemaName),
            ensureCanonicalTables: jest.fn(async () => undefined),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(query)),
            auditLog: { create: jest.fn(async () => {
                if (options.auditFails) throw new Error('audit unavailable');
                return {};
            }) },
        };
        const persona: any = { invalidatePersonaResolutionCaches: jest.fn(async () => {
            if (options.cacheFails) throw new Error('redis unavailable');
        }) };
        const drafts: any = { assertConfigurationEntitlement: jest.fn(async () => {
            if (options.entitlementError) throw options.entitlementError;
        }) };
        const revisions: any = { assertCurrent: jest.fn(async () => {
            if (options.manifestError) throw options.manifestError;
        }) };
        const events: any = { emit: jest.fn(() => {
            if (options.notifyFails) throw new Error('listener exploded');
            return true;
        }) };
        const service = new AgentPublicationService(prisma, persona, drafts, revisions, events);
        const store = (service as any).store;
        const settled = { ...receipt, idempotentReplay: !!options.replay };
        store.ensure = jest.fn(async () => undefined);
        store.publish = jest.fn(async () => settled);
        store.rollback = jest.fn(async () => ({ ...settled, kind: 'rollback' as const }));
        jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

        // El módulo, no un `require` en línea: `jest.spyOn` necesita el objeto y
        // un import de namespace lo da. Se llama `entitlementUtil` porque el
        // espía local ya ocupaba `entitlement`.
        const entitlement = jest.spyOn(
            entitlementUtil, 'resolveTenantSubscriptionAccess')
            .mockResolvedValue(options.access ?? { allowed: true } as any);
        return { service, prisma, persona, drafts, revisions, store, query, entitlement, events };
    }
    afterEach(() => jest.restoreAllMocks());

    describe('quién puede pedirlo', () => {
        it('un supervisor lee la historia pero no publica ni revierte', async () => {
            const h = harness();
            await expect(h.service.history(tenantId, agentId, supervisor)).resolves.toBeDefined();
            for (const call of [
                h.service.publish(tenantId, agentId, candidateId, publishBody, supervisor),
                h.service.rollback(tenantId, agentId, { ...publishBody, expectedPublicationId: candidateId }, supervisor),
            ]) await expect(call).rejects.toMatchObject({ response: { error: 'agent_publication_admin_required' } });
            expect(h.store.publish).not.toHaveBeenCalled();
        });

        it('rechaza un alcance que no son identificadores, antes de tocar la base', async () => {
            const h = harness();
            await expect(h.service.publish('not-a-uuid', agentId, candidateId, publishBody, admin))
                .rejects.toMatchObject({ response: { error: 'agent_publication_scope_invalid' } });
            await expect(h.service.publish(tenantId, agentId, candidateId, publishBody, { id: 'x', role: 'tenant_admin' }))
                .rejects.toMatchObject({ response: { error: 'agent_publication_scope_invalid' } });
            expect(h.prisma.getTenantSchemaName).not.toHaveBeenCalled();
        });
    });

    describe('lo que se comprueba en el instante del efecto', () => {
        // Un snapshot realmente sellado, con el helper que lo sella. Uno armado
        // a mano se cae antes en la comprobación de integridad y no llegaría a
        // ejercitar nada de esta capa. El manifiesto entero tiene su propia
        // suite; acá importa el orden y a quién se delega.
        const snapshot: any = evaluationSnapshot(tenantId, agentId, { version: 7, config_json: { persona: { name: 'Maya' } } });

        it('sella el snapshot contra el tenant y el agente de LA PETICIÓN', async () => {
            // Comparar el snapshot consigo mismo pasaría siempre, incluso con uno
            // sellado para otro tenant. La comprobación tiene que usar el alcance
            // pedido, y este caso es lo único que separa las dos versiones.
            const h = harness();
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            await expect(checks.assertCandidateCurrent({ ...snapshot, tenantId: superId }))
                .rejects.toThrow('agent_snapshot_scope_mismatch');
            expect(h.revisions.assertCurrent).not.toHaveBeenCalled();
        });

        it('exige un manifiesto y lo comprueba contra el estado vigente', async () => {
            const h = harness({ manifestError: new Error('evaluation_dependencies_changed:runtime.model_routing') });
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            await expect(checks.assertCandidateCurrent(undefined))
                .rejects.toMatchObject({ response: { error: 'evaluation_revision_manifest_required' } });
            await expect(checks.assertCandidateCurrent(snapshot))
                .rejects.toThrow('evaluation_dependencies_changed:runtime.model_routing');
        });

        it('lee el tenant en la MISMA query que sostiene el bloqueo del primitivo', async () => {
            // Leerlo por otra conexión permitiría que un cambio de plan confirmara
            // al lado de la publicación sin que ninguna de las dos lo viera.
            const h = harness();
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            const scoped = jest.fn(async () => [{ id: tenantId, industry: 'salud', settings: { verticalConfig: {} } }]);
            await checks.assertCurrentPrerequisites(scoped, { tenantId, agentId, operational: { version: 7 }, body: {} });
            expect(scoped).toHaveBeenCalled();
            expect(h.drafts.assertConfigurationEntitlement.mock.calls[0][3]).toMatchObject({ industry: 'salud' });
        });

        it('detiene la publicación cuando la suscripción ya no permite escribir', async () => {
            const h = harness({ access: { allowed: false, error: 'subscription_past_due' } });
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            await expect(checks.assertCurrentPrerequisites(h.query, { tenantId, agentId, operational: {}, body: {} }))
                .rejects.toMatchObject({ response: { error: 'agent_publication_subscription_restricted' } });
            expect(h.drafts.assertConfigurationEntitlement).not.toHaveBeenCalled();
        });

        it('rechaza un alcance distinto al de la petición en vez de mezclar identidades', async () => {
            // El primitivo pasa el mismo tenant que capturó este closure. Mezclar
            // las dos fuentes leería el plan de un tenant mientras habilita la
            // configuración de otro el día que dejen de coincidir.
            const h = harness();
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            for (const scope of [{ tenantId: superId, agentId }, { tenantId, agentId: superId }]) {
                await expect(checks.assertCurrentPrerequisites(h.query, { ...scope, operational: {}, body: {} }))
                    .rejects.toMatchObject({ response: { error: 'agent_publication_scope_mismatch' } });
            }
            expect(h.drafts.assertConfigurationEntitlement).not.toHaveBeenCalled();
        });

        it('propaga la denegación de capacidad tal cual, sin convertirla en otro error', async () => {
            const blocked: any = new Error('configuration_capability_blocked');
            const h = harness({ entitlementError: blocked });
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            const checks = h.store.publish.mock.calls[0][3];
            await expect(checks.assertCurrentPrerequisites(h.query, { tenantId, agentId, operational: {}, body: {} }))
                .rejects.toBe(blocked);
        });

        it('la reversión comprueba los prerequisitos vigentes, no sólo el head', async () => {
            const h = harness();
            await h.service.rollback(tenantId, agentId, { ...publishBody, expectedPublicationId: candidateId }, admin);
            expect(typeof h.store.rollback.mock.calls[0][3].assertCurrentPrerequisites).toBe('function');
        });
    });

    describe('después del COMMIT', () => {
        it('invalida la caché y audita al actor real de una impersonación', async () => {
            const h = harness();
            await h.service.publish(tenantId, agentId, candidateId, publishBody,
                { id: superId, role: 'super_admin', isImpersonation: true, impersonatedBy: superId } as any);
            expect(h.persona.invalidatePersonaResolutionCaches).toHaveBeenCalledWith(tenantId);
            const audit = h.prisma.auditLog.create.mock.calls[0][0].data;
            expect(audit).toMatchObject({ tenantId, action: 'agent.publication.publish', resource: `agent:${agentId}` });
            expect(audit.userId).toBe(superId);
            expect(audit.details).toMatchObject({ publicationId: 'pub-1', operationalVersion: 8, candidateId });
        });

        it('no pierde una publicación confirmada porque la caché o la auditoría fallen', async () => {
            // Las dos ocurren DESPUÉS del COMMIT. Una caché vieja caduca sola; una
            // publicación perdida no vuelve, y el llamador ya no puede reintentar
            // porque su clave de idempotencia devolvería el mismo recibo.
            for (const options of [{ cacheFails: true }, { auditFails: true }]) {
                const h = harness(options);
                await expect(h.service.publish(tenantId, agentId, candidateId, publishBody, admin))
                    .resolves.toMatchObject({ id: 'pub-1' });
            }
        });
    });

    describe('la historia es la mitad observable', () => {
        it('avisa que la configuración cambió, que era lo que nadie emitía', async () => {
            // `agent.config.updated` tenía dos oyentes y ningún emisor: el eval
            // gate automático y la reconciliación de señales de calidad llevaban
            // dormidos desde que la edición se movió al flujo de borrador.
            const h = harness();
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            expect(h.events.emit).toHaveBeenCalledWith('agent.config.updated', expect.objectContaining({
                tenantId, agentId, changed: 'agent_publication_publish', publicationId: 'pub-1',
                operationalVersion: 8,
            }));
        });

        it('también avisa cuando lo que cambió fue una reversión', async () => {
            const h = harness();
            await h.service.rollback(tenantId, agentId, { ...publishBody, expectedPublicationId: candidateId }, admin);
            expect(h.events.emit).toHaveBeenCalledWith('agent.config.updated',
                expect.objectContaining({ changed: 'agent_publication_rollback' }));
        });

        it('no vuelve a avisar por una repetición idempotente', async () => {
            // Repetir la caché y la auditoría es inocuo; repetir el aviso gasta
            // el presupuesto diario de evaluación del tenant en nada.
            const h = harness({ replay: true });
            await h.service.publish(tenantId, agentId, candidateId, publishBody, admin);
            expect(h.events.emit).not.toHaveBeenCalled();
            expect(h.persona.invalidatePersonaResolutionCaches).toHaveBeenCalled();
        });

        it('no pierde una publicación confirmada porque un oyente reviente', async () => {
            const h = harness({ notifyFails: true });
            await expect(h.service.publish(tenantId, agentId, candidateId, publishBody, admin))
                .resolves.toMatchObject({ id: 'pub-1' });
        });

        it('acota el límite y no devuelve los cuerpos de configuración', async () => {
            const h = harness();
            await h.service.history(tenantId, agentId, admin, 5000);
            const events = h.query.mock.calls.find(call => String(call[0]).includes('FROM agent_publication_events'));
            expect(events![1]).toEqual([agentId, 20]);
            // `before_body`/`after_body` no salen: la historia dice qué pasó y
            // permite nombrar el destino de una reversión; la configuración se
            // lee en el editor.
            expect(String(events![0])).not.toContain('before_body');
            expect(String(events![0])).not.toContain('after_body');
        });

        it('acepta un límite razonable tal cual', async () => {
            const h = harness();
            await h.service.history(tenantId, agentId, admin, 7);
            const events = h.query.mock.calls.find(call => String(call[0]).includes('FROM agent_publication_events'));
            expect(events![1]).toEqual([agentId, 7]);
        });
    });
});
