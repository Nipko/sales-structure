import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AGENT_OPERATION_REGISTRY, dashboardRoleCanOpen, getAgentOperation } from '@parallext/shared';
import { AgentContentProposalService } from './agent-content-proposal.service';
import { CopilotService, type CopilotChatRequest } from './copilot.service';

const TENANT = '11111111-1111-4111-8111-111111111111';

/**
 * Assist asking the path that decides, instead of deciding again.
 *
 * Assist had its own answer to "can this account do this": the caller's role,
 * plus `verticalConfig.effectiveCapabilities` — the subtype manifest snapshot
 * written at provisioning. That list knows nothing about the plan, the agent's
 * own toggles, whether the data behind a tool exists, or whether a provider is
 * answering; and the prompt introduced it as "autoritativo", beside the shared
 * diagnosis, which knows all of it. Two lists, one account, and the confident
 * one was the one that knew least.
 *
 * The cost was not abstract. `knowledge.faq.create` is gated by the
 * `knowledgeArticles` plan limit, which Assist's copy of the rule did not
 * consult — so a tenant sitting on that limit was told Assist could prepare a
 * FAQ, wrote one in the chat, and got a 403 from `enforcePlanLimit` afterwards.
 *
 * These cases wire the REAL `AgentContentProposalService` into the REAL
 * `CopilotService`, because the defect lived in the seam between them and a
 * stubbed verdict is exactly the thing that agreed with itself.
 */
/** The operations the prompt actually offers to prepare, as a list. */
function offered(prompt: string): readonly string[] {
    const marker = 'puedes preparar la creación de: ';
    const start = prompt.indexOf(marker);
    if (start < 0) return [];
    // Cut at the sentence that follows, not at the first full stop: every
    // operation key contains full stops of its own.
    const rest = prompt.slice(start + marker.length);
    const end = rest.indexOf('. Solo prepara');
    return rest.slice(0, end < 0 ? undefined : end).split(',').map(entry => entry.trim()).filter(Boolean);
}

describe('Assist and the one capability list', () => {
    function harness(options: {
        role?: string;
        knowledgeUsed?: number;
        knowledgeLimit?: number;
        capabilities?: string[];
    } = {}) {
        const role = options.role ?? 'tenant_admin';
        const limit = options.knowledgeLimit ?? 50;
        const used = options.knowledgeUsed ?? 0;
        const capabilities = options.capabilities ?? ['appointment_booking', 'course_enrollment', 'faq_search'];

        const prisma: any = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_scope'),
            ensureCanonicalTables: jest.fn().mockResolvedValue(undefined),
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('COUNT(*)::int AS c FROM knowledge_resources')) return [{ c: used }];
                if (sql.includes('COUNT(*)::int AS c FROM services')) return [{ c: 0 }];
                return [];
            }),
        };
        const throttle: any = {
            isFeatureEnabled: jest.fn().mockResolvedValue(true),
            // The live limit, enforced exactly as the propose path enforces it.
            enforcePlanLimit: jest.fn(async (_tenant: string, limitKey: string, count: number) => {
                const max = limitKey === 'knowledgeArticles' ? limit : 100;
                if (count >= max) {
                    throw new ForbiddenException({ error: 'plan_limit_reached', limitKey, maxAllowed: max });
                }
            }),
        };
        const verticals: any = {
            getVerticalConfig: jest.fn(async () => ({
                industry: 'salud', subType: 'clinica_general', effectiveCapabilities: [...capabilities],
            })),
        };
        const operations = new AgentContentProposalService(
            prisma, throttle, {} as any, {} as any, {} as any, {} as any, verticals);
        const llmRouter = {
            execute: jest.fn().mockResolvedValue({
                content: 'Ayuda', routingDecision: { selectedModel: { id: 'test-model' } },
                usage: { totalTokens: 10 },
            }),
        };
        const service = new CopilotService(
            {} as any, {} as any, {} as any, llmRouter as any, {} as any, {} as any,
            verticals, null as any, null as any, null as any, null as any, null as any, operations);
        jest.spyOn(service as any, 'searchKb').mockReturnValue([]);
        jest.spyOn(service as any, 'buildChannelContext').mockResolvedValue('');
        jest.spyOn(service as any, 'buildPlanContext').mockResolvedValue('');

        const request: CopilotChatRequest = {
            message: '¿Podés crear una pregunta frecuente?',
            history: [],
            context: {
                tenantId: TENANT, userName: 'Dueña', userRole: role as any, locale: 'es',
                page: '/admin', actorId: randomUUID(),
            } as any,
        };
        const prompt = async () => {
            await service.chat(request);
            return String(llmRouter.execute.mock.calls.at(-1)![0].systemPrompt);
        };
        return { service, operations, verticals, throttle, llmRouter, request, prompt };
    }

    it('does not offer a creation the plan limit would refuse', async () => {
        // The reproduction. Role allows it, the vertical allows it, and the
        // plan does not — which is the dimension Assist's own copy of the rule
        // could not see.
        const kit = harness({ knowledgeUsed: 50, knowledgeLimit: 50 });
        const prompt = await kit.prompt();
        // The offer list itself, not the whole prompt: the operation is still
        // named further down, as the write that does not close `tool_faqs`.
        expect(offered(prompt)).not.toContain('knowledge.faq.create');
        expect(offered(prompt)).toContain('agenda.service.create');
        expect(prompt).toContain('knowledge.faq.create (el plan actual ya llegó a su límite para esto)');
        // And the refusal it explains is the one the propose path would give.
        await expect(kit.operations.propose(TENANT, 'knowledge.faq.create',
            { title: '¿Hacen envíos?', content: 'Sí, a todo el país.' },
            { id: kit.request.context.actorId!, role: 'tenant_admin' }))
            .rejects.toMatchObject({ response: { error: 'plan_limit_reached' } });
    });

    it('offers the same creation when the plan has room', async () => {
        const kit = harness({ knowledgeUsed: 3, knowledgeLimit: 50 });
        const prompt = await kit.prompt();
        expect(prompt).toContain('CREACIÓN ASISTIDA');
        expect(prompt).toContain('knowledge.faq.create');
        expect(prompt).not.toContain('knowledge.faq.create (');
    });

    it('gives one answer to "can you" and to being asked for it', async () => {
        // Not a restatement of the case above: this walks every operation the
        // registry declares and checks the prompt's two partitions against the
        // enforcing service's verdicts, key by key.
        const kit = harness({ knowledgeUsed: 50, knowledgeLimit: 50, capabilities: ['faq_search'] });
        const prompt = await kit.prompt();
        const verdicts = await kit.operations.listOperations(TENANT,
            { id: kit.request.context.actorId!, role: 'tenant_admin' });
        expect(verdicts).toHaveLength(AGENT_OPERATION_REGISTRY.length);
        for (const verdict of verdicts) {
            if (verdict.availability === 'executable') {
                expect(prompt).toContain(verdict.key);
                expect(prompt).not.toContain(`${verdict.key} (`);
            }
            if (verdict.availability === 'blocked') {
                expect(prompt).toContain(`${verdict.key} (`);
                expect(prompt).not.toContain(`${verdict.key} → `);
            }
            if (verdict.availability === 'route_to_screen') {
                const route = getAgentOperation(verdict.key)!.route;
                if (dashboardRoleCanOpen(route, 'tenant_admin')) {
                    expect(prompt).toContain(`${verdict.key} → ${route}`);
                }
            }
        }
    });

    it('never prints a route the authenticated role cannot open', async () => {
        for (const role of ['tenant_admin', 'tenant_supervisor', 'tenant_agent']) {
            const prompt = await harness({ role }).prompt();
            for (const definition of AGENT_OPERATION_REGISTRY) {
                if (dashboardRoleCanOpen(definition.route, role)) continue;
                expect(prompt).not.toContain(`${definition.key} → ${definition.route}`);
            }
        }
    });

    it('keeps the route check honest even if the verdict source ever said yes', async () => {
        // The case above cannot fail today: every routed operation's route is
        // openable by every role the registry says decides it, so the role
        // filter already removes all of them and the reachability filter never
        // has anything to do. Which means it was untested — a guard nothing
        // exercises is a guard nobody notices breaking.
        //
        // So this drives it: a verdict that says `route_to_screen` for
        // `roles.member.grant` to an inbox agent, whose route `/admin/users`
        // that role cannot open. Assist must name the operation and withhold
        // the route, rather than trust the verdict about a screen.
        const kit = harness({ role: 'tenant_agent' });
        jest.spyOn(kit.operations, 'listOperations').mockResolvedValue([
            { key: 'roles.member.grant', domain: 'roles', route: '/admin/users',
                availability: 'route_to_screen', reason: 'privilege_decision' },
        ] as any);
        const prompt = await kit.prompt();
        expect(dashboardRoleCanOpen('/admin/users', 'tenant_agent')).toBe(false);
        expect(prompt).not.toContain('/admin/users');
        expect(prompt).toContain('roles.member.grant');
        expect(prompt).toContain('este rol NO puede abrir');
    });

    it('is not carrying a role that decides an operation it cannot reach', async () => {
        // The other half, and the one that will actually catch a change: every
        // routed operation's screen must be openable by every role the registry
        // says decides it. A new pair that breaks this turns a handoff into a
        // redirect, and it is cheaper to fail here than in the panel.
        const mismatched = AGENT_OPERATION_REGISTRY.flatMap(definition => definition.roles
            .filter(role => role !== 'super_admin')
            .filter(role => !dashboardRoleCanOpen(definition.route, role))
            .map(role => `${definition.key} decided by ${role}, whose panel cannot open ${definition.route}`));
        expect(mismatched).toEqual([]);
    });

    it('does not send a supervisor to the screen that grants roles', async () => {
        // `roles.member.grant` is declared for super_admin and tenant_admin. The
        // enforcing service used to return it as `route_to_screen` for
        // everybody, because "Assist will never run it" was read as "so there is
        // nothing to judge" — and only Assist's own copy of the filter kept a
        // supervisor from being sent there.
        const prompt = await harness({ role: 'tenant_supervisor' }).prompt();
        expect(prompt).not.toContain('roles.member.grant → ');
        expect(prompt).toContain('roles.member.grant (la decide otro rol');
    });

    it('keeps no capability array of its own in the prompt', async () => {
        const prompt = await harness().prompt();
        expect(prompt).not.toContain('effectiveCapabilities');
        expect(prompt).not.toContain('appointment_booking');
        expect(prompt).not.toContain('CONTEXTO VERTICAL EFECTIVO');
        // What survives is the business, which orients an example and grants
        // nothing.
        expect(prompt).toContain('"industry":"salud"');
        expect(prompt).toContain('"subType":"clinica_general"');
        expect(prompt).toContain('Esto NO es una lista de capacidades');
    });

    it('explains a vertical screen this business does not have instead of offering it', async () => {
        const prompt = await harness({ capabilities: ['restaurant_ordering', 'faq_search'] }).prompt();
        expect(prompt).toContain('agenda.appointment.book (no forma parte de las capacidades de este rubro)');
        expect(prompt).not.toContain('agenda.appointment.book → ');
        // And a transversal screen is untouched by the vertical: losing the
        // agenda cannot cost the owner the channels screen.
        expect(prompt).toContain('channels.account.connect → /admin/channels');
    });

    it('offers nothing sensitive when the verdicts could not be read', async () => {
        const kit = harness();
        jest.spyOn(kit.operations, 'listOperations').mockRejectedValue(new Error('gate down'));
        const prompt = await kit.prompt();
        expect(prompt).toContain('No se pudo leer qué operaciones permite esta cuenta');
        for (const definition of AGENT_OPERATION_REGISTRY) {
            expect(prompt).not.toContain(`${definition.key} → `);
        }
        expect(prompt).not.toContain('CREACIÓN ASISTIDA');
    });

    it('fails closed for a caller with no identity, rather than listing everything', async () => {
        const kit = harness();
        delete (kit.request.context as any).actorId;
        const prompt = await kit.prompt();
        expect(prompt).toContain('No se pudo leer qué operaciones permite esta cuenta');
        expect(prompt).not.toContain('CREACIÓN ASISTIDA');
    });
});
