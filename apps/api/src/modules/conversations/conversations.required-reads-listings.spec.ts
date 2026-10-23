import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import {
    REQUIRED_READS_CATALOG_FLAG, REQUIRED_READS_LISTINGS_FLAG, REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_RESTAURANTS_FLAG,
    REQUIRED_READS_TOURS_FLAG,
} from '../throttle/feature-flags.service';

/**
 * The real-estate required reads through the real turn (Agent Test runtime session): with `agentRuntime.requiredReads.listings` on
 * and a confident classifier, the reads the operation owes run BEFORE the model.
 *
 * Production QA (real-estate QA tenant, gpt-4.1-mini, after #177):
 *   - with search_listings in the turn: «250.000 EUR, venta, 1 baño, 80 m²» 2/2;
 *   - without it: «El precio del apartamento no está confirmado» and an advisor, 0/3;
 *   - «2 baños» invented with no get_listing_details;
 *   - «¿qué propiedades tienen?» answered with three filter questions while the agency has one listing.
 *
 * The model is a stand-in that answers ONLY from the tool results it was given, and otherwise does what production did.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const CHAPINERO = '55555555-5555-4555-8555-555555555555';
const ROSALES = '66666666-6666-4666-8666-666666666666';
const LISTING = {
    id: CHAPINERO, name: 'Apartamento Chapinero', transactionType: 'sale', propertyKind: 'apartment',
    price: 250000, priceStatus: 'confirmed', currency: 'EUR', bedrooms: 2, bathrooms: 1, areaM2: 80, status: 'available',
};
const DETAILS = { ...LISTING, address: 'Calle 60 # 5-20', amenities: ['ascensor'], externalUrl: null };
const SECOND = { ...LISTING, id: ROSALES, name: 'Casa Rosales', propertyKind: 'house', price: 410000, bathrooms: 3, areaM2: 160 };

const TOOLS = ['search_listings', 'get_listing_details', 'send_listing_image', 'check_availability', 'create_appointment'];

const PRODUCTION = {
    price: 'El precio del apartamento no está confirmado. ¿Quieres que un asesor te contacte?',
    bathrooms: 'Tiene 2 baños.',
    browse: '¿Buscas comprar o arrendar, en qué zona y con qué presupuesto?',
};

function fixture(flags: Record<string, boolean>, classifier: string, results: Record<string, (args: any) => any> = {}) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'inmobiliaria/venta';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'inmobiliaria', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'inmobiliaria', subType: 'venta' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: flags } });
    publishTools(f, TOOLS);
    const defaults: Record<string, (args: any) => any> = {
        search_listings: () => ({ listings: [LISTING] }),
        get_listing_details: args => (args.listingId === ROSALES ? { ...DETAILS, ...SECOND } : { ...DETAILS, id: args.listingId }),
    };
    const all = { ...defaults, ...results };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        all[name] ? all[name](args) : { error: `unexpected tool ${name}` });

    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
        const failed = bodies.find((b: any) => b?.error);
        if (failed) return { ...usage, content: String(failed.message || 'No pude consultar.') };
        const question = String(req.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '');
        const details = [...bodies].reverse().find((b: any) => b?.address && typeof b?.bathrooms === 'number');
        const list = bodies.find((b: any) => Array.isArray(b?.listings));
        if (details && /bano|baño/i.test(question)) return { ...usage, content: `La ${details.name} tiene ${details.bathrooms} baño${details.bathrooms === 1 ? '' : 's'}.` };
        if (details) {
            return { ...usage, content: `${details.price.toLocaleString('es-CO')} ${details.currency}, ${details.transactionType === 'sale' ? 'venta' : 'arriendo'}, ${details.bathrooms} baño, ${details.areaM2} m².` };
        }
        if (list?.listings.length) return { ...usage, content: `Tenemos: ${list.listings.map((l: any) => l.name).join(', ')}.` };
        // What production did without the reads.
        if (/bano|baño/i.test(question)) return { ...usage, content: PRODUCTION.bathrooms };
        if (/precio|cuesta|vale/i.test(question)) return { ...usage, content: PRODUCTION.price };
        return { ...usage, content: PRODUCTION.browse };
    });

    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    let sessionId: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: sessionId }, { agentSnapshot: undefined });
        sessionId = result.debug.runtimeSessionId;
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3], args: c[4] }));
    const replyCalls = (): any[] => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task !== 'classify').map((c: any[]) => c[0]);
    const classifyCalls = () => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task === 'classify');
    /** The tool results the FIRST model call received from the required reads. */
    const requiredReadBodies = () => replyCalls()[0].messages
        .filter((m: any) => m.role === 'tool' && String(m.toolCallId).startsWith('required_read_'))
        .map((m: any) => JSON.parse(m.content));
    return { f, featureFlags, turn, executed, replyCalls, classifyCalls, requiredReadBodies };
}

const toolNames = (calls: any[]) => calls.map(c => (c.tools || []).map((t: any) => t.name ?? t.function?.name));
const ON = { [REQUIRED_READS_LISTINGS_FLAG]: true };

afterEach(() => jest.restoreAllMocks());

describe('required reads through the turn: real estate', () => {
    it('«¿cuál es el precio del apartamento?»: search_listings (kind stated) and the details before the model, the published price answered', async () => {
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.93}');
        const { result, requiredReads } = await h.turn('¿cuál es el precio del apartamento?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([
            { name: 'search_listings', args: { propertyKind: 'apartment' } },
            { name: 'get_listing_details', args: { listingId: CHAPINERO } },
        ]);
        const [list, details] = h.requiredReadBodies();
        expect(list).toMatchObject({ listings: [expect.objectContaining({ price: 250000, currency: 'EUR' })], complete: true, total: 1 });
        expect(details).toMatchObject({ price: 250000, bathrooms: 1, areaM2: 80, transactionType: 'sale' });
        expect(result.reply).toBe('250.000 EUR, venta, 1 baño, 80 m².');
        expect(result.reply).not.toMatch(/no está confirmado|asesor/i);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'listings', operation: 'listing_info', outcome: 'read', slots: ['property_kind'],
            reads: [expect.objectContaining({ tool: 'search_listings', status: 'read', complete: true, total: 1 }),
                expect.objectContaining({ tool: 'get_listing_details', status: 'read' })],
        });
    });

    it('«¿cuántos baños tiene?»: the details are read, so the count is the listing\'s (1), not an invented 2', async () => {
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.9}');
        const { result, requiredReads } = await h.turn('¿cuántos baños tiene?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([
            { name: 'search_listings', args: {} },
            { name: 'get_listing_details', args: { listingId: CHAPINERO } },
        ]);
        expect(result.reply).toBe('La Apartamento Chapinero tiene 1 baño.');
        expect(result.reply).not.toMatch(/2 baños/);
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'listing_info', outcome: 'read' });
        expect(requiredReads[0].metadata?.slots).toBeUndefined();
    });

    it('«¿qué propiedades tienen?»: search_listings runs unfiltered and the listing is listed instead of three filter questions', async () => {
        const h = fixture(ON, '{"operationKey":"find_listing","confidence":0.88}');
        const { result, requiredReads } = await h.turn('¿qué propiedades tienen?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([{ name: 'search_listings', args: {} }]);
        expect(h.requiredReadBodies()).toEqual([expect.objectContaining({ complete: true, total: 1, listings: [expect.objectContaining({ id: CHAPINERO })] })]);
        expect(result.reply).toBe('Tenemos: Apartamento Chapinero.');
        expect(result.reply).not.toMatch(/presupuesto|no hay inmuebles/i);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'listings', operation: 'find_listing', outcome: 'read', reads: [expect.objectContaining({ tool: 'search_listings', status: 'read' })],
        });
    });

    it('a named listing among several gets its own details; several unnamed is left to the model (ambiguous_receipt)', async () => {
        const two = { search_listings: () => ({ listings: [LISTING, SECOND] }) };
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.9}', two);
        const named = await h.turn('¿y cuánto mide la Casa Rosales?');
        expect(named.result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([
            { name: 'search_listings', args: { propertyKind: 'house' } },
            { name: 'get_listing_details', args: { listingId: ROSALES } },
        ]);
        expect(named.result.reply).toBe('410.000 EUR, venta, 3 baño, 160 m².');
        jest.restoreAllMocks();

        const unnamed = fixture(ON, '{"operationKey":"listing_info","confidence":0.9}', two);
        const turn = await unnamed.turn('¿cuánto miden?');
        expect(unnamed.executed()).toEqual([{ name: 'search_listings', args: {} }]);
        expect(turn.requiredReads[0].metadata?.reads).toEqual([
            expect.objectContaining({ tool: 'search_listings', status: 'read', rows: 2, complete: true, total: 2 }),
            { tool: 'get_listing_details', status: 'ambiguous_receipt' },
        ]);
        expect(turn.result.reply).toBe('Tenemos: Apartamento Chapinero, Casa Rosales.');
    });

    it('the automatic listing-detail lookup is reused, not repeated', async () => {
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.9}');
        const { result, requiredReads } = await h.turn('¿cuántos baños tiene el Apartamento Chapinero?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed().filter(c => c.name === 'get_listing_details')).toEqual([{ name: 'get_listing_details', args: { listingId: CHAPINERO } }]);
        expect(requiredReads[0].metadata?.reads).toEqual(expect.arrayContaining([{ tool: 'get_listing_details', status: 'already_read' }]));
        expect(result.reply).toBe('La Apartamento Chapinero tiene 1 baño.');
    });

    it('a failed read is an admission ("no pude consultar"), never an empty list', async () => {
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.93}', { search_listings: () => ({ error: 'listings_unavailable' }) });
        const { result, requiredReads } = await h.turn('¿cuál es el precio del apartamento?');
        expect(result.debug.runtimeError).toBeUndefined();
        const [body] = h.requiredReadBodies();
        expect(body.error).toBeTruthy();
        expect(body.listings).toBeUndefined();
        expect(body.message).toMatch(/^No pude consultar/);
        expect(result.reply).toMatch(/^No pude consultar/);
        expect(requiredReads[0].metadata).toMatchObject({
            outcome: 'admit',
            reads: [expect.objectContaining({ tool: 'search_listings', status: 'failed' }), { tool: 'get_listing_details', status: 'upstream_failed' }],
        });
    });
});

describe('required reads, real estate: flags', () => {
    it.each([
        ['¿cuál es el precio del apartamento?', PRODUCTION.price],
        ['¿cuántos baños tiene?', PRODUCTION.bathrooms],
        // The fixture's catalogue guard answers this one (the stand-in never sees a listing); either way nothing is listed.
        ['¿qué propiedades tienen?', null],
    ])('flag off, «%s»: no classification, no read, no trace step (the production baseline)', async (question, reply) => {
        const off = fixture({}, '{"operationKey":"listing_info","confidence":0.93}');
        const offTurn = await off.turn(question);
        expect(off.classifyCalls()).toHaveLength(0);
        expect(offTurn.requiredReads).toEqual([]);
        expect(off.executed()).toEqual([]);
        expect(off.replyCalls()[0].messages.some((m: any) => String(m.toolCallId ?? '').startsWith('required_read_'))).toBe(false);
        if (reply) expect(offTurn.result.reply).toBe(reply);
        expect(offTurn.result.reply).not.toContain('Apartamento Chapinero');
    });

    it.each([REQUIRED_READS_RESTAURANTS_FLAG, REQUIRED_READS_CATALOG_FLAG, REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_TOURS_FLAG])(
        'real estate with only %s on: model input, tools and reply identical to the baseline', async otherFlag => {
            const question = '¿cuál es el precio del apartamento?';
            const off = fixture({}, '{"operationKey":"listing_info","confidence":0.93}');
            const offTurn = await off.turn(question);
            const baseline = { executed: off.executed(), messages: off.replyCalls().map(c => c.messages), tools: toolNames(off.replyCalls()), reply: offTurn.result.reply };
            jest.restoreAllMocks();

            const other = fixture({ [otherFlag]: true }, '{"operationKey":"listing_info","confidence":0.93}');
            const otherTurn = await other.turn(question);
            expect(other.classifyCalls()).toHaveLength(0);
            expect(otherTurn.requiredReads).toEqual([]);
            expect(other.executed()).toEqual(baseline.executed);
            expect(other.replyCalls().map(c => c.messages)).toEqual(baseline.messages);
            expect(toolNames(other.replyCalls())).toEqual(baseline.tools);
            expect(otherTurn.result.reply).toEqual(baseline.reply);
        });

    it('Agent Test reads the flag from the sealed snapshot: no tenant query and no flag-service lookup per turn', async () => {
        const h = fixture(ON, '{"operationKey":"listing_info","confidence":0.93}');
        await h.turn('¿cuál es el precio del apartamento?');
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;
        const second = await h.turn('¿y cuántos baños tiene?');
        expect(second.result.debug.runtimeError).toBeUndefined();
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
        // One required_reads step per turn (the trace spy accumulates across the two turns).
        expect(second.requiredReads).toHaveLength(2);
        expect(second.requiredReads[1].metadata).toMatchObject({ pilot: 'listings', operation: 'listing_info', outcome: 'read' });
        const flagLookups = h.featureFlags.isFeatureEnabled.mock.calls.map((c: any[]) => c[1]);
        expect(flagLookups).not.toContain(REQUIRED_READS_LISTINGS_FLAG);
    });
});
