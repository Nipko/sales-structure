import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
    AGENT_CONTENT_OPERATION_HANDLERS,
} from './agent-content-operations';
import { AgentContentProposalService } from './agent-content-proposal.service';
import {
    AGENT_OPERATION_REGISTRY,
    isExecutableAgentOperation,
    validateAgentOperationInput,
} from '@parallext/shared';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin' };
const SUPERVISOR = { id: '55555555-5555-4555-8555-555555555555', role: 'tenant_supervisor' };
const SUPER_ADMIN = '66666666-6666-4666-8666-666666666666';
const FAQ = { title: '¿Hacen envíos?', content: 'Sí, a todo el país en 48 horas.' };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const detail = (error: any) => (typeof error?.getResponse === 'function' ? error.getResponse() : null) as any;

function harness(options: { knowledgeCount?: number; knowledgeLimit?: number } = {}) {
    const ledger: any[] = [];
    const knowledge: any[] = [];
    const legalTexts: any[] = [];
    const courses: any[] = [];
    const services: any[] = [];
    let knowledgeLimit = options.knowledgeLimit ?? 50;
    let existingKnowledge = options.knowledgeCount ?? 0;

    const query = async (sql: string, params: any[] = []): Promise<any[]> => {
        if (sql.includes('COUNT(*)::int AS c FROM knowledge_resources')) return [{ c: existingKnowledge + knowledge.length }];
        if (sql.includes('COUNT(*)::int AS c FROM services')) return [{ c: services.length }];
        if (sql.startsWith('SELECT id, title FROM knowledge_resources')) {
            const row = knowledge.find(item => item.id === params[0]);
            return row ? [{ id: row.id, title: row.title }] : [];
        }
        if (sql.startsWith('SELECT id, name FROM legal_text_versions')) {
            const row = legalTexts.find(item => item.id === params[0]);
            return row ? [{ id: row.id, name: row.name }] : [];
        }
        if (sql.startsWith('SELECT id, name FROM courses')) {
            const row = courses.find(item => item.id === params[0]);
            return row ? [{ id: row.id, name: row.name }] : [];
        }
        if (sql.startsWith('SELECT id, name FROM services')) {
            const row = services.find(item => item.id === params[0]);
            return row ? [{ id: row.id, name: row.name }] : [];
        }
        if (sql.includes('FROM agent_content_proposals WHERE requested_by')) {
            return clone(ledger.filter(row => row.requested_by === params[0] && row.request_key === params[1]));
        }
        if (sql.startsWith('SELECT * FROM agent_content_proposals WHERE id')) {
            return clone(ledger.filter(row => row.id === params[0]));
        }
        if (sql.startsWith('INSERT INTO agent_content_proposals')) {
            if (ledger.some(row => row.requested_by === params[1] && row.request_key === params[2])) return [];
            const row = {
                id: randomUUID(), operation: params[0], requested_by: params[1], request_key: params[2],
                digest: params[3], input: JSON.parse(params[4]), status: 'proposed',
                expires_at: new Date(Date.now() + 1_800_000).toISOString(),
                applied_at: null, applied_by: null, created_object_id: null,
            };
            ledger.push(row);
            return [clone(row)];
        }
        if (sql.includes("SET status='applied'")) {
            const row = ledger.find(item => item.id === params[0]);
            if (!row || row.status !== 'proposed' || new Date(row.expires_at).getTime() <= Date.now()) return [];
            Object.assign(row, { status: 'applied', applied_at: new Date().toISOString(), applied_by: params[1] });
            return [clone(row)];
        }
        if (sql.includes('SET created_object_id')) {
            const row = ledger.find(item => item.id === params[0]);
            if (row) row.created_object_id = params[1];
            return [];
        }
        throw new Error('Unhandled SQL: ' + sql);
    };

    const prisma: any = {
        getTenantSchemaName: jest.fn().mockResolvedValue('tenant_scope'),
        ensureCanonicalTables: jest.fn().mockResolvedValue(undefined),
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params?: any[]) => query(sql, params)),
        auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const throttle: any = {
        isFeatureEnabled: jest.fn().mockResolvedValue(true),
        enforcePlanLimit: jest.fn(async (_tenantId: string, limitKey: string, count: number) => {
            const max = limitKey === 'knowledgeArticles' ? knowledgeLimit : 100;
            if (count >= max) throw new ForbiddenException({ error: 'plan_limit_reached', limitKey, currentCount: count, maxAllowed: max });
        }),
    };
    const knowledgeService: any = {
        createResource: jest.fn(async (_schema: string, _tenantId: string, data: any) => {
            const row = { id: randomUUID(), title: data.title, type: data.type, content: data.content };
            knowledge.push(row);
            return row;
        }),
    };
    const compliance: any = {
        createLegalText: jest.fn(async (_schema: string, data: any) => {
            const row = { id: randomUUID(), name: data.name, type: data.type, active: data.active, version: 1 };
            legalTexts.push(row);
            return row;
        }),
        logComplianceAction: jest.fn().mockResolvedValue(undefined),
    };
    const catalog: any = {
        createCourse: jest.fn(async (_schema: string, data: any) => {
            const row = { id: randomUUID(), name: data.name };
            courses.push(row);
            return row;
        }),
    };
    const servicesService: any = {
        create: jest.fn(async (_schema: string, data: any) => {
            const row = { id: randomUUID(), name: data.name, durationType: data.durationType };
            services.push(row);
            return row;
        }),
    };

    return {
        service: new AgentContentProposalService(prisma, throttle, knowledgeService, compliance, catalog, servicesService),
        prisma, throttle, knowledgeService, compliance, catalog, servicesService,
        ledger, knowledge, legalTexts, courses, services,
        setKnowledgeLimit: (value: number) => { knowledgeLimit = value; },
        setExistingKnowledge: (value: number) => { existingKnowledge = value; },
    };
}

describe('registro de operaciones de Assist', () => {
    it('toda operación ejecutable tiene handler, y todo handler tiene operación', () => {
        const declared = AGENT_OPERATION_REGISTRY.filter(isExecutableAgentOperation).map(operation => operation.key).sort();
        expect(Object.keys(AGENT_CONTENT_OPERATION_HANDLERS).sort()).toEqual(declared);
    });

    it('una cuota de plan sin nada que contar sería un límite que nunca frena', () => {
        for (const operation of AGENT_OPERATION_REGISTRY.filter(isExecutableAgentOperation)) {
            if (operation.gate.kind !== 'plan_limit') continue;
            expect(typeof (AGENT_CONTENT_OPERATION_HANDLERS as any)[operation.key].count).toBe('function');
        }
    });

    it('nada ejecutable sale hacia afuera: canales, roles, publicación y pagos son ruta a pantalla', () => {
        const outward = ['channels', 'roles', 'publication', 'payments'];
        const executableOutward = AGENT_OPERATION_REGISTRY
            .filter(operation => operation.availability === 'executable' && outward.includes(operation.domain));
        expect(executableOutward).toEqual([]);
        for (const operation of AGENT_OPERATION_REGISTRY.filter(isExecutableAgentOperation)) {
            expect(operation.sideEffects).toBe('tenant_record_only');
            expect(operation.effect).toBe('create');
        }
    });

    it('cada ruta a pantalla dice por qué y a dónde', () => {
        for (const operation of AGENT_OPERATION_REGISTRY) {
            if (isExecutableAgentOperation(operation)) continue;
            expect(operation.reason).toBeTruthy();
            expect(operation.route.startsWith('/admin')).toBe(true);
        }
    });

    it('la validación tipada rechaza campos inventados en vez de descartarlos en silencio', () => {
        const result = validateAgentOperationInput('knowledge.faq.create', { ...FAQ, status: 'approved' });
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.violations).toEqual([{ field: 'status', rule: 'unknown_field' }]);
    });
});

describe('AgentContentProposalService.propose', () => {
    it('una operación fuera del whitelist nunca llega a un servicio', async () => {
        const kit = harness();
        await expect(kit.service.propose(TENANT, 'knowledge.faq.delete', FAQ, ADMIN))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(kit.knowledgeService.createResource).not.toHaveBeenCalled();
    });

    it('lo que Assist no hace se responde con el motivo y la pantalla', async () => {
        const kit = harness();
        const error = await kit.service.propose(TENANT, 'channels.account.connect', {}, ADMIN).catch(e => e);
        expect(detail(error)).toMatchObject({
            error: 'operation_not_executable', operation: 'channels.account.connect',
            reason: 'oauth_round_trip_required', route: '/admin/channels',
        });
    });

    it('la propuesta muestra que el objeto todavía no existe, en vez de un diff vacío', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        expect(proposal.preview.before).toBeNull();
        expect(proposal.preview.beforeState).toBe('does_not_exist');
        expect(proposal.preview.after).toEqual([
            { field: 'title', value: FAQ.title },
            { field: 'content', value: FAQ.content },
            { field: 'type', value: 'faq' },
        ]);
        expect(proposal.route).toBe('/admin/knowledge/faqs');
        expect(kit.knowledge).toHaveLength(0);
    });

    it('un input inválido devuelve violaciones tipadas, no una frase', async () => {
        const kit = harness();
        const error = await kit.service.propose(TENANT, 'agenda.service.create',
            { name: 'Corte', durationMinutes: 3 }, ADMIN).catch(e => e);
        expect(detail(error)).toMatchObject({ error: 'operation_input_invalid', operation: 'agenda.service.create' });
        expect(detail(error).violations).toEqual([{ field: 'durationMinutes', rule: 'out_of_range' }]);
    });

    it('la misma clave devuelve la misma propuesta; otra carga con la misma clave choca', async () => {
        const kit = harness();
        const first = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN, 'assist-key-0001');
        const again = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN, 'assist-key-0001');
        expect(again.id).toBe(first.id);
        expect(kit.ledger).toHaveLength(1);
        await expect(kit.service.propose(TENANT, 'knowledge.faq.create', { ...FAQ, title: 'Otra' }, ADMIN, 'assist-key-0001'))
            .rejects.toBeInstanceOf(ConflictException);
    });

    it('la cuota del plan frena antes de proponer, con el mismo código que la pantalla', async () => {
        const kit = harness({ knowledgeCount: 50, knowledgeLimit: 50 });
        const error = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN).catch(e => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(detail(error)).toMatchObject({ error: 'plan_limit_reached', limitKey: 'knowledgeArticles' });
        expect(kit.ledger).toHaveLength(0);
    });

    it('un rol no puede entrar por Assist a una tabla que su pantalla le niega', async () => {
        const kit = harness();
        const error = await kit.service.propose(TENANT, 'policies.legal_text.create',
            { name: 'Privacidad', type: 'privacy', text: 'Tratamos tus datos así.' }, SUPERVISOR).catch(e => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(detail(error)).toMatchObject({ error: 'operation_role_not_permitted', operation: 'policies.legal_text.create' });
        // La misma persona sí puede escribir una FAQ: el permiso es por operación.
        await expect(kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, SUPERVISOR)).resolves.toBeTruthy();
    });

    it('un tenant inexistente no deja rastro', async () => {
        const kit = harness();
        kit.prisma.getTenantSchemaName.mockResolvedValue(null);
        await expect(kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('AgentContentProposalService.apply', () => {
    it('crea el objeto, lo relee y audita al actor real de la impersonación', async () => {
        const kit = harness();
        const actor = { ...ADMIN, delegation: { viaImpersonation: true, performedBy: SUPER_ADMIN, impersonationSid: 'sid-1' } };
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, actor);
        const applied = await kit.service.apply(TENANT, proposal.id, proposal.digest, actor);

        expect(applied.outcome).toBe('created');
        expect(applied.verification).toBe('verified');
        expect(applied.object).toMatchObject({ label: FAQ.title, route: '/admin/knowledge/faqs' });
        expect(kit.knowledge).toHaveLength(1);
        expect(kit.knowledgeService.createResource).toHaveBeenCalledWith('tenant_scope', TENANT,
            { title: FAQ.title, type: 'faq', content: FAQ.content });

        const audit = kit.prisma.auditLog.create.mock.calls[0][0].data;
        expect(audit.action).toBe('assist.content_object_created');
        // El usuario efectivo es el admin del tenant; el super_admin real viaja al lado.
        expect(audit.userId).toBe(ADMIN.id);
        expect(audit.details).toMatchObject({ viaImpersonation: true, performedBy: SUPER_ADMIN, operation: 'knowledge.faq.create' });
    });

    it('aplicar dos veces crea UNO y el segundo intento dice que es una repetición', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        const first = await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        const second = await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);

        expect(first.outcome).toBe('created');
        expect(second.outcome).toBe('replayed');
        expect(second.object?.id).toBe(first.object?.id);
        expect(kit.knowledgeService.createResource).toHaveBeenCalledTimes(1);
        expect(kit.knowledge).toHaveLength(1);
        // La repetición no vuelve a auditar una creación que ya ocurrió.
        expect(kit.prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('un digest que no es el revisado no aplica nada', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        await expect(kit.service.apply(TENANT, proposal.id, 'a'.repeat(64), ADMIN))
            .rejects.toBeInstanceOf(ConflictException);
        expect(kit.knowledge).toHaveLength(0);
    });

    it('un input alterado bajo un digest viejo se detecta al aplicar', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        kit.ledger[0].input = { ...FAQ, content: 'Contenido cambiado después de la revisión.' };
        await expect(kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN))
            .rejects.toBeInstanceOf(ConflictException);
        expect(kit.knowledge).toHaveLength(0);
    });

    it('una propuesta vencida exige una revisión nueva', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        kit.ledger[0].expires_at = new Date(Date.now() - 1_000).toISOString();
        const error = await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN).catch(e => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect(detail(error)).toMatchObject({ error: 'operation_proposal_expired' });
        expect(kit.knowledge).toHaveLength(0);
    });

    it('la cuota se vuelve a mirar al aplicar, no se hereda de la revisión', async () => {
        const kit = harness({ knowledgeLimit: 50 });
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        kit.setExistingKnowledge(50);
        await expect(kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN))
            .rejects.toBeInstanceOf(ForbiddenException);
        expect(kit.knowledge).toHaveLength(0);
    });

    it('una propuesta consumida sin objeto no se reporta como verificada', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'knowledge.faq.create', FAQ, ADMIN);
        // Exactamente lo que deja un corte entre la reserva y el efecto.
        Object.assign(kit.ledger[0], { status: 'applied', created_object_id: null });
        const applied = await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        expect(applied.outcome).toBe('replayed');
        expect(applied.object).toBeNull();
        expect(applied.verification).toBe('unavailable');
        expect(applied.verificationReason).toBe('object_missing');
        expect(kit.knowledgeService.createResource).not.toHaveBeenCalled();
    });

    it('un texto legal nace inactivo: publicarlo es una decisión de una persona', async () => {
        const kit = harness();
        const input = { name: 'Política de privacidad', type: 'privacy' as const, text: 'Tratamos tus datos así.' };
        const proposal = await kit.service.propose(TENANT, 'policies.legal_text.create', input, ADMIN);
        expect(proposal.preview.after).toContainEqual({ field: 'active', value: false });
        await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        expect(kit.compliance.createLegalText).toHaveBeenCalledWith('tenant_scope',
            expect.objectContaining({ tenant_id: TENANT, active: false, type: 'privacy' }));
        expect(kit.compliance.logComplianceAction).toHaveBeenCalled();
    });

    it('un servicio de agenda se crea con duración fija y sin política de cobro', async () => {
        const kit = harness();
        const proposal = await kit.service.propose(TENANT, 'agenda.service.create',
            { name: 'Corte de pelo', durationMinutes: 45, price: 40000, currency: 'cop' }, ADMIN);
        await kit.service.apply(TENANT, proposal.id, proposal.digest, ADMIN);
        expect(kit.servicesService.create).toHaveBeenCalledWith('tenant_scope',
            expect.objectContaining({ name: 'Corte de pelo', durationMinutes: 45, durationType: 'fixed', currency: 'COP' }), TENANT);
        expect(kit.servicesService.create.mock.calls[0][1]).not.toHaveProperty('paymentPolicy');
    });
});

describe('AgentContentProposalService.listOperations', () => {
    it('devuelve un veredicto por operación, con la pantalla de las que Assist no hace', async () => {
        const kit = harness({ knowledgeCount: 50, knowledgeLimit: 50 });
        const listed = await kit.service.listOperations(TENANT, SUPERVISOR);
        const byKey = Object.fromEntries(listed.map(item => [item.key, item]));

        expect(byKey['knowledge.faq.create']).toMatchObject({ availability: 'blocked', reason: 'plan_limit_reached' });
        expect(byKey['policies.legal_text.create']).toMatchObject({ availability: 'blocked', reason: 'role_not_permitted' });
        expect(byKey['catalogue.course.create']).toMatchObject({ availability: 'executable', reason: null });
        expect(byKey['payments.rail.configure']).toMatchObject({
            availability: 'route_to_screen', reason: 'credentials_required', route: '/admin/settings/integrations/payments',
        });
        expect(byKey['publication.agent.publish']).toMatchObject({ availability: 'route_to_screen', reason: 'customer_facing_decision' });
        expect(byKey['roles.member.grant']).toMatchObject({ availability: 'route_to_screen', reason: 'privilege_decision' });
        expect(listed).toHaveLength(AGENT_OPERATION_REGISTRY.length);
    });

    it('sin schema del tenant no inventa disponibilidad', async () => {
        const kit = harness();
        kit.prisma.getTenantSchemaName.mockResolvedValue(null);
        const listed = await kit.service.listOperations(TENANT, ADMIN);
        expect(listed.find(item => item.key === 'knowledge.faq.create'))
            .toMatchObject({ availability: 'blocked', reason: 'gate_unavailable' });
    });
});
