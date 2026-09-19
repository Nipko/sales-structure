import { CopilotService, CopilotChatRequest } from './copilot.service';

/**
 * What Assist tells the model a save does, in the tenant's own change mode.
 *
 * Audit #62 (sep-2026): immediate saves became the default (owner decisions
 * D1/D15), yet the system prompt still said the proposal button "guarda un
 * borrador, sin publicarlo ni activarlo", the quality rule said a draft does
 * not resolve anything "hasta publicar la corrección", and the tour for an
 * inactive agent was described as "guardar, probar, revisar y publicar una
 * versión" — all three false for every tenant in the default mode, and all
 * three things the model repeats to the owner. The mode is read the way the
 * save path reads it (`directCommitMode`), and an unreadable mode is said to be
 * unreadable instead of guessed.
 */

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';

function createService(settings: unknown | Error) {
    const llmRouter = {
        execute: jest.fn().mockResolvedValue({
            content: 'Ayuda',
            routingDecision: { selectedModel: { id: 'test-model' } },
            usage: { totalTokens: 10 },
        }),
    };
    const prisma = {
        tenant: {
            findUnique: jest.fn(async () => {
                if (settings instanceof Error) throw settings;
                return { settings };
            }),
        },
    };
    const agentQuality = {
        getOverview: jest.fn().mockResolvedValue({
            generatedAt: '2026-09-18T12:00:00.000Z',
            agent: { id: AGENT_ID, name: 'Valentina', version: 2, isActive: false, updatedAt: '2026-09-18T10:00:00.000Z' },
            status: 'configuration_incomplete',
            nextMilestone: 'complete_configuration',
            preparation: {
                status: 'blocked', criticalBlockers: ['agent_active'], score: 80, passed: 4, applicable: 5,
                dimensions: [{ dimension: 'business_scope', score: 80, status: 'blocked', passed: 0, applicable: 1,
                    checks: [{ code: 'agent_active', dimension: 'business_scope', status: 'fail', critical: true, weight: 6, href: `/admin/agent/${AGENT_ID}?focus=active` }] }],
            },
            tested: { status: 'unknown', stale: false, staleReasons: [], score: null, latestEval: null, latestSimulation: null },
            production: { status: 'insufficient_evidence', sampleSize: 0, minimumSample: 20, periodDays: 30, metrics: [], topIssues: [] },
            recommendations: [],
        }),
        getTenantChannelSnapshot: jest.fn().mockResolvedValue({ generatedAt: '2026-09-18T12:00:00.000Z', availability: 'known', total: 0, channels: [] }),
    };
    const service = new CopilotService(
        {} as any, prisma as any, {} as any, llmRouter as any, {} as any, {} as any,
        { getVerticalConfig: jest.fn().mockResolvedValue(null) } as any,
        null as any, agentQuality as any, { getSignalForAssistant: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'buildPlanContext').mockResolvedValue('');
    // The agent article is what makes the agent tours available this turn.
    jest.spyOn(service as any, 'searchKb').mockReturnValue([{
        id: 'agentes-ia', locale: 'es', title: 'Agentes', routes: ['/admin/agent'], roles: ['tenant_admin'],
        keywords: [], body: 'Contenido de ayuda.',
    }]);
    return { service, llmRouter, prisma };
}

const request = (): CopilotChatRequest => ({
    message: '¿Cómo enciendo a mi agente?',
    history: [],
    target: { kind: 'agent_quality', agentId: AGENT_ID },
    context: { tenantId: TENANT_ID, userName: 'Dueña', userRole: 'tenant_admin', locale: 'es', page: `/admin/agent/${AGENT_ID}` },
});

async function promptFor(settings: unknown | Error): Promise<string> {
    const { service, llmRouter } = createService(settings);
    await service.chat(request());
    return llmRouter.execute.mock.calls[0][0].systemPrompt as string;
}

const RETIRED_PIPELINE = /guarda un borrador, sin publicarlo|guardar, probar, revisar y publicar una versión|guardar un borrador no resuelve sus pendientes hasta publicar la corrección/;

describe('Assist describes a save in the tenant\'s change mode', () => {
    it('immediate mode (the default, and a tenant with no setting): a save is live and the switch turns the agent on', async () => {
        for (const settings of [{}, { agentReviewMode: 'immediate' }, null]) {
            const prompt = await promptFor(settings);
            expect(prompt).not.toMatch(RETIRED_PIPELINE);
            expect(prompt).toContain('Guardar y aplicar, que aplica el cambio de inmediato');
            expect(prompt).toContain('el interruptor Estado del editor lo enciende o apaga al instante');
            expect(prompt).toContain('- publish_agent_revision — dónde está el interruptor que enciende o apaga al agente');
            expect(prompt).toContain('No hables de borradores, versiones ni publicación.');
        }
    });

    it('reviewed mode keeps the pipeline, because there it is true', async () => {
        const prompt = await promptFor({ agentReviewMode: 'reviewed' });
        expect(prompt).toContain('el botón guarda un borrador, sin publicarlo ni activarlo');
        expect(prompt).toContain('guardar un borrador no resuelve sus pendientes hasta publicar la corrección');
        expect(prompt).toContain('- publish_agent_revision — cómo guardar un borrador, probarlo, revisarlo y publicar la versión que enciende al agente');
        expect(prompt).not.toContain('Guardar y aplicar');
    });

    it('says the mode could not be read rather than guessing one', async () => {
        const prompt = await promptFor(new Error('database unavailable'));
        expect(prompt).not.toMatch(RETIRED_PIPELINE);
        expect(prompt).not.toContain('Guardar y aplicar');
        expect(prompt).toContain('No se pudo leer si esta cuenta aplica los cambios del agente');
        // The tour line falls back to the one sentence true in both modes.
        expect(prompt).toContain('- publish_agent_revision — dónde encender o apagar el agente\n');
    });

    it('reads the mode from the tenant the request is authenticated for, once', async () => {
        const { service, prisma } = createService({});
        await service.chat(request());
        expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: TENANT_ID }, select: { settings: true } });
    });

    it('describes every mode-dependent tour for both modes, and each one differently', () => {
        for (const tour of ['publish_agent_revision', 'run_agent_tests'] as const) {
            const immediate = CopilotService.guidedTourDescription(tour, 'immediate');
            const reviewed = CopilotService.guidedTourDescription(tour, 'reviewed');
            expect(immediate).not.toBe(reviewed);
            expect(immediate).not.toMatch(/publica|borrador|revis/i);
        }
        // A tour whose walk does not depend on the mode reads the same in both.
        expect(CopilotService.guidedTourDescription('knowledge_base', 'reviewed'))
            .toBe(CopilotService.guidedTourDescription('knowledge_base', 'immediate'));
    });

    it('gives the model no voseo to mirror', async () => {
        // Same list as the help's own voseo check: forms that are voseo and nothing else.
        const voseo = /(?:^|[^\wáéíóúñ])(?:vos|podés|tenés|querés|sabés|necesitás|probá|conectá|revisá|agregá|confirmá|mirá|tocá|pulsá|guardá|entrá|hacé|poné|decí|decilo|preguntá|pedí)(?![\wáéíóúñ])/i;
        for (const settings of [{}, { agentReviewMode: 'reviewed' }, new Error('down')]) {
            const prompt = await promptFor(settings);
            expect(prompt.split('\n').filter((line) => voseo.test(line))).toEqual([]);
        }
    });
});
