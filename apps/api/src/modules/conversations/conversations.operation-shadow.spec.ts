import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { OPERATION_CLASSIFIER_FLAG } from '../throttle/feature-flags.service';

/**
 * PR4 — the operation classifier runs in SHADOW. With the flag on it writes one
 * `operation_shadow` trace step; it never changes the reply, the tools the turn
 * calls or what the model is offered. With the flag off it costs nothing.
 *
 * QA 8e7c45b1: «How much is the apartment you have for sale?» ran only the
 * automatic FAQ and the reply denied the price. The shadow step is how that gap
 * (required read never ran) gets measured before PR5 enforces it.
 */
const QUESTION = 'How much is the apartment you have for sale?';
const TOOLS = ['search_faqs', 'search_listings', 'get_listing_details'];

function fixture(flag: boolean, classifierContent = '{"operationKey":"listing_info","confidence":0.93}') {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 3, config_json: { language: 'en', industry: 'inmobiliaria', rag: { enabled: false }, llm: {} } });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: flag ? { featureFlags: { [OPERATION_CLASSIFIER_FLAG]: true } } : {} });
    publishTools(f, TOOLS);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        name === 'search_faqs' ? { faqs: [] } : { listings: [] });
    f.llmRouter.execute.mockImplementation(async (options: any) => options.task === 'classify'
        ? { content: classifierContent, routingDecision: { selectedModel: { id: 'gpt-4o-mini' } }, usage: { promptTokens: 50, completionTokens: 10 }, cost: 0 }
        : { content: 'Let me check that for you.', model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    return {
        f,
        async turn() {
            const result = await f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message: QUESTION, channelType: 'telegram' }, { agentSnapshot: undefined });
            const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
            toEvent.mockRestore();
            return { result, steps, shadow: steps.filter((s: any) => s.type === 'decision' && s.label === 'operation_shadow') };
        },
    };
}

const classifyCalls = (f: ReturnType<typeof agentTurnFixture>) => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task === 'classify');
const replyCalls = (f: ReturnType<typeof agentTurnFixture>) => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task !== 'classify');

describe('shadow operation classifier', () => {
    it('flag off: no classification and no trace step', async () => {
        const h = fixture(false);
        const { result, shadow } = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        expect(classifyCalls(h.f)).toHaveLength(0);
        expect(shadow).toEqual([]);
    });

    it('flag on: one trace step with the operation and whether its required reads ran', async () => {
        const h = fixture(true);
        const { result, shadow } = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        expect(classifyCalls(h.f)).toHaveLength(1);
        const request = classifyCalls(h.f)[0][0];
        expect(request).toMatchObject({ task: 'classify', temperature: 0, jsonMode: true });
        expect(request.traceContext.stage).toBe('operation_shadow');
        expect(shadow).toHaveLength(1);
        const metadata: any = shadow[0].metadata;
        expect(metadata).toMatchObject({ operationKey: 'listing_info', fallback: null, engineOwned: false });
        expect(metadata.requiredReads.map((r: any) => r.tool)).toEqual(['search_listings', 'get_listing_details']);
        const executed = h.f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]);
        for (const read of metadata.requiredReads) {
            expect(['called', 'auto', 'missing']).toContain(read.status);
            expect(read.status === 'missing').toBe(!executed.includes(read.tool));
        }
        expect(metadata.domainCues).toContain('listings');
    });

    it('never changes the reply, the tools executed or what the model is offered', async () => {
        const off = fixture(false);
        const offTurn = await off.turn();
        const on = fixture(true);
        const onTurn = await on.turn();
        expect(offTurn.result.reply).toBeTruthy();
        expect(onTurn.result.reply).toEqual(offTurn.result.reply);
        expect(onTurn.result.debug.runtimeError).toEqual(offTurn.result.debug.runtimeError);
        expect(on.f.toolExecutor.execute.mock.calls.map((c: any[]) => [c[3], c[4]]))
            .toEqual(off.f.toolExecutor.execute.mock.calls.map((c: any[]) => [c[3], c[4]]));
        const offered = (calls: any[][]) => calls.map(c => (c[0].tools || []).map((t: any) => t.name ?? t.function?.name));
        expect(offered(replyCalls(on.f))).toEqual(offered(replyCalls(off.f)));
    });

    it('a classifier failure is swallowed and traced as a fallback', async () => {
        const h = fixture(true, 'definitely not json');
        const { result, shadow } = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        expect(shadow[0].metadata).toMatchObject({ operationKey: 'none', fallback: 'invalid_output', requiredReads: [] });
    });

    it('a classifier that throws does not break the turn', async () => {
        const h = fixture(true);
        const reply = h.f.llmRouter.execute.getMockImplementation()!;
        h.f.llmRouter.execute.mockImplementation(async (options: any) => {
            if (options.task === 'classify') throw new Error('classifier provider down');
            return reply(options);
        });
        const { result, shadow } = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBeTruthy();
        expect(shadow[0].metadata).toMatchObject({ fallback: 'error' });
    });
});
