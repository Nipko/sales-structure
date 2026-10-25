import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_TOURS_FLAG } from '../throttle/feature-flags.service';
import { lexicalRequiredReadsOperation } from './runtime/operation-lexical-cues';
import { pickReceiptId, requiredReadsGate, requiredReadsPlan } from './runtime/required-reads.runner';
import { PACKAGE_FIELD_AUTHORITY, PACKAGE_LANGUAGES_NOTE, packageLanguages } from './package-structured-fields';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * F4300-32 (production 2026-10-24, travel QA tenant, `agentRuntime.requiredReads.tours` on). tour_packages.languages: «Spark QA
 * Tour» ['es'], «Tour QA Aurora» [].
 *  - «en qué idiomas es el Spark QA Tour?» ran only search_faqs / search_packages (no get_package_details) and answered that it has
 *    no information; «em que idiomas é o Tour QA Aurora?» was answered «espanhol» (invented);
 *  - «when is the next departure of the Spark tour?» did not read get_package_details: the customer did not say «QA», so the
 *    search receipt named no package.
 * Fixed: a language question about a tour is `package_info` (search_packages + get_package_details); a two-letter word of a name
 * may go unsaid when its longer words are all said; the readers give `languages: 'not_registered'` for an empty list, with a note.
 */
const SPARK = '33333333-3333-4333-8333-333333333333';
const AURORA = '44444444-4444-4444-8444-444444444444';
const SPARK_NAME = 'Spark QA Tour 20261018T2140Z';
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const row = (id: string, name: string, languages: string[] | 'not_registered') => ({ id, name, description: 'Experiencia ficticia de QA.',
    duration: '4 hours', price: 125, currency: 'EUR', priceStatus: 'confirmed', languages });
const PACKAGES = [row(SPARK, SPARK_NAME, ['es']), row(AURORA, 'Tour QA Aurora', 'not_registered')];
const TOUR_TOOLS = ['search_faqs', 'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'cancel_tour_booking', 'list_my_tour_bookings'];

const LANGUAGE_QUESTIONS: Array<[string, string]> = [
    ['en qué idiomas es el Spark QA Tour?', SPARK],
    ['em que idiomas é o Tour QA Aurora?', AURORA],
    ['what languages is the Spark QA Tour guided in?', SPARK],
    ['en quelle langue est le Spark QA Tour ?', SPARK],
    ['is the Tour QA Aurora in English?', AURORA],
];

describe('packageLanguages: an empty list is "not_registered"', () => {
    it('lists stay as written; empty, null, blank or malformed is not_registered', () => {
        expect(packageLanguages(['es'])).toEqual(['es']);
        expect(packageLanguages(['es', ' en ', 'es', ''])).toEqual(['es', 'en']);
        expect(packageLanguages('["fr"]')).toEqual(['fr']);
        expect(packageLanguages([])).toBe('not_registered');
        expect(packageLanguages(null)).toBe('not_registered');
        expect(packageLanguages('[]')).toBe('not_registered');
        expect(packageLanguages({})).toBe('not_registered');
        expect(PACKAGE_LANGUAGES_NOTE).toMatch(/Never guess one/);
        expect(PACKAGE_FIELD_AUTHORITY).toMatch(/languages are the configured values/);
    });
});

describe('the readers: languages are given, an empty list is said as not registered', () => {
    function executor() {
        const toursService = { searchPackages: jest.fn(), getPackage: jest.fn(), listInventory: jest.fn().mockResolvedValue([]) };
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn(), executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        const control = { preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }), complete: jest.fn(), fail: jest.fn() };
        const service = new AIToolExecutorService(
            prisma as any, {} as any, { emit: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            toursService as any, {} as any, {} as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            control as any, {} as any, {} as any,
        );
        const run = (tool: string, args: Record<string, any>) => service.execute('tenant_qa', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222', tool, args, undefined, { authority: authorityFor(tool) });
        return { toursService, run };
    }
    const DB = (id: string, name: string, languages: unknown) => ({ id, name, duration_type: 'hours', duration_value: 4, price: 125, currency: 'EUR', is_active: true, languages });

    it('search_packages', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([DB(SPARK, SPARK_NAME, ['es']), DB(AURORA, 'Tour QA Aurora', [])]);
        const search = await h.run('search_packages', {});
        expect(search.packages.map((p: any) => p.languages)).toEqual([['es'], 'not_registered']);
        expect(search.languagesNote).toBe(PACKAGE_LANGUAGES_NOTE);
    });

    it('get_package_details', async () => {
        const h = executor();
        h.toursService.getPackage.mockResolvedValue(DB(AURORA, 'Tour QA Aurora', []));
        const details = await h.run('get_package_details', { packageId: AURORA });
        expect(details.languages).toBe('not_registered');
        expect(details.languagesNote).toBe(PACKAGE_LANGUAGES_NOTE);
        h.toursService.getPackage.mockResolvedValue(DB(SPARK, SPARK_NAME, ['es']));
        expect((await h.run('get_package_details', { packageId: SPARK })).languages).toEqual(['es']);
    });
});

describe('the cues and the package named', () => {
    const ref = { tool: 'search_packages', container: 'packages', field: 'id' };

    it.each(LANGUAGE_QUESTIONS)('«%s» is package_info, which reads the details of the package named', (text, id) => {
        const cue = lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS);
        expect(cue).toBe('package_info');
        const gate = requiredReadsGate({ version: 1, operationKey: 'ask_question', confidence: 0.9, fallback: null, candidates: [], latencyMs: 5 }, 'tours', cue);
        expect(gate).toMatchObject({ run: true, pilot: 'tours', source: 'lexical_cue' });
        expect(gate.run && requiredReadsPlan(gate.operation, {}).map(r => r.tool)).toEqual(['search_packages', 'get_package_details']);
        expect(pickReceiptId({ packages: PACKAGES }, ref, text)).toEqual({ id });
    });

    it('a language question that is not about a tour is no tour read', () => {
        expect(lexicalRequiredReadsOperation('¿en qué idiomas atienden?', 'tours', TOUR_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('do you speak English?', 'tours', TOUR_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('¿los guías hablan otros idiomas?', 'tours', TOUR_TOOLS)).toBe('package_info');
    });

    it.each([
        'when is the next departure of the Spark tour?',
        'what is the departure time of the Spark tour?',
        '¿cuándo es la próxima salida del tour Spark?',
    ])('«%s» owes the departures of «Spark QA Tour 20261018T2140Z» (the «QA» is not said)', text => {
        expect(lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS)).toBe('package_availability');
        expect(pickReceiptId({ packages: PACKAGES }, ref, text)).toEqual({ id: SPARK });
    });

    it('a short word may go unsaid only when two longer words are said', () => {
        expect(pickReceiptId({ packages: PACKAGES }, ref, 'cupos para el Spark?')).toEqual({ reason: 'ambiguous_receipt' });
        expect(pickReceiptId({ packages: PACKAGES }, ref, 'next departure of the tour?')).toEqual({ reason: 'ambiguous_receipt' });
        const twins = { packages: [...PACKAGES, row('77777777-7777-4777-8777-777777777777', 'Spark QA Tour 20261019T1000Z', ['en'])] };
        expect(pickReceiptId(twins, ref, 'when is the next departure of the Spark tour?')).toEqual({ reason: 'ambiguous_receipt' });
    });
});

describe('through the Agent Test turn: travel, flag on', () => {
    function fixture() {
        const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
        const f = agentTurnFixture({ featureFlags });
        f.contract.subtypeProfileId = 'turismo/tours';
        f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
            language: 'es', industry: 'turismo', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
        } });
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'turismo', subType: 'tours' });
        f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_TOURS_FLAG]: true } } });
        publishTools(f, TOUR_TOOLS);
        const results: Record<string, (args: any) => any> = {
            search_faqs: () => ({ faqs: [] }),
            search_packages: () => ({ packages: PACKAGES, fieldAuthority: PACKAGE_FIELD_AUTHORITY, languagesNote: PACKAGE_LANGUAGES_NOTE }),
            get_package_details: args => {
                const found = PACKAGES.find(p => p.id === args.packageId);
                return found ? { ...found, upcomingDepartures: [], fieldAuthority: PACKAGE_FIELD_AUTHORITY, languagesNote: PACKAGE_LANGUAGES_NOTE } : { error: 'package_not_found' };
            },
        };
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
            results[name] ? results[name](args) : { error: `unexpected tool ${name}` });
        // A stand-in model that answers ONLY from the details it was given, and otherwise says what production said.
        f.llmRouter.execute.mockImplementation(async (req: any) => {
            if (req.task === 'classify') return { content: '{"operationKey":"ask_question","confidence":0.9}', routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
            const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } });
            const details = bodies.find((b: any) => typeof b?.id === 'string' && 'languages' in b && !Array.isArray(b.packages));
            if (details) {
                return { ...usage, content: details.languages === 'not_registered'
                    ? `El idioma de ${details.name} no está registrado.` : `${details.name} se ofrece en: ${details.languages.join(', ')}.` };
            }
            return { ...usage, content: 'No tengo información sobre los idiomas de ese tour.' };
        });
        jest.spyOn(TurnTraceContext.prototype, 'toEvent');
        const calls = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3] as string, args: c[4] }));
        const turn = (message: string) => f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        return { turn, calls };
    }
    afterEach(() => jest.restoreAllMocks());

    it('«en qué idiomas es el Spark QA Tour?» reads get_package_details and answers from its languages', async () => {
        const h = fixture();
        const result = await h.turn('en qué idiomas es el Spark QA Tour?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.calls().find(c => c.name === 'get_package_details')?.args).toEqual({ packageId: SPARK });
        expect(result.reply).toContain('es');
        expect(result.reply).not.toMatch(/No tengo información/);
    });

    it('«em que idiomas é o Tour QA Aurora?» reads its details: the language is not registered, never guessed', async () => {
        const h = fixture();
        const result = await h.turn('em que idiomas é o Tour QA Aurora?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.calls().find(c => c.name === 'get_package_details')?.args).toEqual({ packageId: AURORA });
    });
});
