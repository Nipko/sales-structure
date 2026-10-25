import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_LISTINGS_FLAG } from '../throttle/feature-flags.service';
import { lexicalRequiredReadsOperation, listingQuestionOperation } from './runtime/operation-lexical-cues';
import { buildRequiredReadsTrace, REQUIRED_READS_CONFIDENCE_THRESHOLD, requiredReadsGate } from './runtime/required-reads.runner';
import { buildOperationClassifierPrompt, type OperationShadowVerdict } from './runtime/operation-classifier.service';
import { LISTING_FIELD_AUTHORITY } from './listing-structured-fields';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { getOperation, operationsForPublishedTools } from '@parallext/shared';

/**
 * Production QA 2026-10-24, real-estate QA tenant with `agentRuntime.requiredReads.listings` on:
 *   - when the classifier was confident, search_listings (+ get_listing_details) ran and the answers were right;
 *   - «quelle est la surface du Spark QA Inmueble ?» ran ONLY search_faqs and answered «Je n'ai pas la surface confirmée» (the
 *     listing has 80 m²);
 *   - «what properties are available?» ran ONLY search_faqs, listed the listing from the history and said «The price is not
 *     confirmed in the catalog» (250.000 EUR).
 * The classifier answered the FAQ intent or a listing operation under the threshold, and the reads only run on a confident pilot
 * verdict. Same fix as the menu (#207) and the lodging/tours cues (#208), the 0.8 threshold untouched: a listing question in the
 * message's own words (es/pt/fr/en) runs the listings reads when the classifier missed, never over a confident other business
 * operation, never for a visit, an appointment, a complaint or a payment.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const SPARK = '57542cc7-de10-4166-b731-704bc7fa403d';
const LISTING = {
    id: SPARK, name: 'Spark QA Inmueble', transactionType: 'sale', propertyKind: 'apartment',
    price: 250000, priceStatus: 'confirmed', currency: 'EUR', bedrooms: 2, bathrooms: 1, areaM2: 80, status: 'available',
    description: 'Inmueble ficticio de QA.',
};
const DETAILS = { ...LISTING, address: 'Calle Sintetica QA 123', city: 'Spark QA Ciudad', amenities: [], fieldAuthority: LISTING_FIELD_AUTHORITY };
const TOOLS = ['search_faqs', 'search_listings', 'get_listing_details', 'send_listing_image', 'check_availability', 'create_appointment'];

/** The two production messages first, then their es/pt/fr/en equivalents. */
const LISTING_INFO = [
    'quelle est la surface du Spark QA Inmueble ?',
    '¿cuál es el área del Spark QA Inmueble?',
    'qual é a área do Spark QA Inmueble?',
    'what is the area of the Spark QA Inmueble?',
    'how many square meters is it?',
    '¿cuántos metros tiene el apartamento?',
    'how much is the Spark QA Inmueble?',
    '¿cuánto cuesta el Spark QA Inmueble?',
    'quanto custa o imóvel?',
    'quel est le prix du Spark QA Inmueble ?',
    'how many bedrooms does it have?',
    '¿cuántas habitaciones tiene?',
    'quantos banheiros tem?',
    'combien de chambres ?',
    'is it for sale or rent?',
    '¿es para venta o arriendo?',
    'é para venda ou aluguel?',
    "c'est à vendre ou à louer ?",
    'where is the Spark QA Inmueble?',
    '¿dónde queda el apartamento?',
    'onde fica o imóvel?',
    "quelle est l'adresse de l'appartement ?",
    'is the apartment still available?',
];
const FIND_LISTING = [
    'what properties are available?',
    'what properties do you have?',
    '¿qué inmuebles tienen?',
    '¿qué propiedades tienen disponibles?',
    'quais imóveis vocês têm?',
    'quels biens avez-vous ?',
    'do you have apartments for rent?',
];
const NOT_LISTING = [
    'quiero agendar una visita',
    'cancelar mi cita',
    'hola', 'buenos días', 'hello!', 'thanks!', 'olá, tudo bem?', 'bonjour', 'merci beaucoup',
    'I want to schedule a visit to the apartment',
    'quero marcar uma visita ao imóvel',
    'je voudrais visiter la maison',
    'reprogramar mi cita del jueves',
    'when is my appointment?',
    'tengo una queja con el asesor',
    'how can I pay the deposit?',
    '¿dónde queda su oficina?',
    'what time do you open?',
    'quiero vender mi casa',
    '¿cuánto cobran de comisión?',
    'quiero hablar con una persona',
];

function fixture(classifier: string, listings: any[] = [LISTING]) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'inmobiliaria/venta';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry: 'inmobiliaria', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'inmobiliaria', subType: 'venta' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_LISTINGS_FLAG]: true } } });
    publishTools(f, TOOLS);
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [] }),
        search_listings: () => ({ listings, ...(listings.length ? { fieldAuthority: LISTING_FIELD_AUTHORITY } : {}) }),
        get_listing_details: args => {
            const row = listings.find(l => l.id === args.listingId);
            return row ? { ...DETAILS, ...row, fieldAuthority: LISTING_FIELD_AUTHORITY } : { error: 'listing_not_found' };
        },
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });

    // A stand-in model that answers ONLY from the tool results it was given, and otherwise does what production did.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } });
        const question = String(req.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '');
        const rows = bodies.flatMap((b: any) => Array.isArray(b?.listings) ? b.listings : b?.id && typeof b?.areaM2 === 'number' ? [b] : []);
        const confirmed = rows.filter((l: any) => l.priceStatus === 'confirmed' && l.areaM2 > 0);
        if (confirmed.length) {
            const unique = [...new Map(confirmed.map((l: any) => [l.id, l])).values()] as any[];
            return { ...usage, content: unique.map(l => `${l.name}: ${String(l.price).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ${l.currency}, ${l.areaM2} m².`).join(' ') };
        }
        // What production did without the reads.
        if (/surface|area|área|metros/i.test(question)) return { ...usage, content: "Je n'ai pas la surface confirmée." };
        return { ...usage, content: 'Spark QA Inmueble. The price is not confirmed in the catalog.' };
    });

    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): string[] => f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]);
    const firstReply = () => f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]).find((r: any) => r?.task !== 'classify');
    /**
     * The tool results the FIRST model call received, read before the model: the required reads, or the automatic listing-detail
     * lookup when it already read the same record this turn (the required read is then `already_read`).
     */
    const readBodies = (): any[] => firstReply().messages
        .filter((m: any) => m.role === 'tool' && /^(required_read_|auto_listing_details)/.test(String(m.toolCallId)))
        .map((m: any) => JSON.parse(m.content));
    return { f, turn, executed, firstReply, readBodies };
}

const verdict = (operationKey: string, confidence: number, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback, candidates: ['listing_info', 'find_listing', 'ask_question'], latencyMs: 5 });

afterEach(() => jest.restoreAllMocks());

describe('listing questions in the message\'s own words (es/pt/fr/en)', () => {
    it.each(LISTING_INFO)('«%s» is a listing details question → listing_info', text => {
        expect(listingQuestionOperation(text)).toBe('listing_info');
        expect(lexicalRequiredReadsOperation(text, 'listings', TOOLS)).toBe('listing_info');
    });

    it.each(FIND_LISTING)('«%s» asks what is on offer → find_listing', text => {
        expect(listingQuestionOperation(text)).toBe('find_listing');
        expect(lexicalRequiredReadsOperation(text, 'listings', TOOLS)).toBe('find_listing');
    });

    it.each(NOT_LISTING)('«%s» is not a listing read', text => {
        expect(listingQuestionOperation(text)).toBeNull();
        expect(lexicalRequiredReadsOperation(text, 'listings', TOOLS)).toBeNull();
    });

    it('only the listings pilot, and only when the turn publishes search_listings', () => {
        expect(lexicalRequiredReadsOperation('quelle est la surface du Spark QA Inmueble ?', 'listings', ['search_faqs', 'get_listing_details'])).toBeNull();
        expect(lexicalRequiredReadsOperation('what properties are available?', 'properties', ['list_properties', 'search_listings'])).not.toBe('find_listing');
        expect(lexicalRequiredReadsOperation('how much is the Spark QA Inmueble?', 'catalog', TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('how much is the Spark QA Inmueble?', 'restaurants', ['get_menu', 'search_listings'])).toBeNull();
        // The other cues are unchanged.
        expect(lexicalRequiredReadsOperation('how much is the Spark dish?', 'restaurants', ['get_menu'])).toBe('menu_info');
        expect(lexicalRequiredReadsOperation('what time is check-out?', 'properties', ['list_properties'])).toBe('property_info');
    });
});

describe('the gate: the cue runs what the classifier missed, the threshold does not move', () => {
    it.each([
        ['listing_info', verdict('ask_question', 0.9)],
        ['listing_info', verdict('listing_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01)],
        ['listing_info', verdict('none', 0.9, 'none')],
        ['find_listing', verdict('ask_question', 0.85)],
        ['find_listing', verdict('find_listing', 0.6)],
        ['find_listing', verdict('none', 0, 'timeout')],
    ] as const)('%s over %j', (op, v) => {
        const gate = requiredReadsGate(v, 'listings', op);
        expect(gate).toMatchObject({ run: true, pilot: 'listings', source: 'lexical_cue' });
        expect(gate.run && gate.operation.key).toBe(op);
        expect(buildRequiredReadsTrace({ pilot: 'listings', verdict: v, gate, latencyMs: 1 })).toMatchObject({
            operation: op, source: 'lexical_cue', classifierOperation: v.operationKey, threshold: REQUIRED_READS_CONFIDENCE_THRESHOLD,
        });
    });

    it('without a cue the threshold is exactly what it was', () => {
        expect(REQUIRED_READS_CONFIDENCE_THRESHOLD).toBe(0.8);
        expect(requiredReadsGate(verdict('listing_info', 0.79), 'listings', null)).toEqual({ run: false, reason: 'below_threshold' });
        expect(requiredReadsGate(verdict('ask_question', 0.95), 'listings', null)).toEqual({ run: false, reason: 'not_pilot_operation' });
    });

    it('a confident verdict keeps the turn: its own pilot operation, or another business operation', () => {
        const info = requiredReadsGate(verdict('listing_info', 0.9), 'listings', 'find_listing');
        expect(info.run && info.operation.key).toBe('listing_info');
        expect(info.run && info.source).toBeUndefined();
        // F4300-08: the customer's own visits are the listings pilot's own-records read; a listing cue does not take that turn.
        const visits = requiredReadsGate(verdict('view_my_appointments', 0.95), 'listings', 'listing_info');
        expect(visits.run && visits.operation.key).toBe('view_my_appointments');
        expect(visits.run && visits.source).toBeUndefined();
        expect(requiredReadsGate(verdict('book_appointment', 0.95), 'listings', 'listing_info')).toEqual({ run: false, reason: 'not_pilot_operation' });
        // A listings cue does nothing in another pilot.
        expect(requiredReadsGate(verdict('none', 0.9, 'none'), 'properties', 'listing_info')).toEqual({ run: false, reason: 'fallback:none' });
    });
});

describe('the classifier sees a listing\'s area or price as a listing question, not the FAQ intent', () => {
    it('the catalogue line and the classifier prompt name these questions in every language', () => {
        const description = getOperation('listing_info')?.description;
        expect(description).toEqual(expect.stringContaining('quelle est la surface du X ?'));
        expect(description).toEqual(expect.stringContaining('¿es para venta o arriendo?'));
        expect(description).toEqual(expect.stringContaining('scheduling a visit is not this operation'));
        const prompt = buildOperationClassifierPrompt(operationsForPublishedTools(TOOLS));
        expect(prompt).toMatch(/quelle est la surface du X \?.*¿cuántos metros tiene\?.*quantos quartos tem o imóvel\?/);
        expect(prompt).toContain('For a real-estate business, the price, area (m2), bedrooms, bathrooms, sale or rent, address or availability of a listing are listing_info; "what properties do you have?" or "what properties are available?" is find_listing; never ask_question, in any language. Scheduling a visit is neither.');
        expect(prompt).not.toContain('For a lodging business');
        expect(buildOperationClassifierPrompt(operationsForPublishedTools(['list_properties', 'get_property_details']))).not.toContain('For a real-estate business');
    });
});

describe('the listing readers: price, area and rooms are structured fields the description never overrides', () => {
    const ROW = {
        id: SPARK, name: 'Spark QA Inmueble', transaction_type: 'sale', property_kind: 'apartment', price: 250000, currency: 'EUR',
        bedrooms: 2, bathrooms: 1, area_m2: 80, neighborhood: null, city: 'Spark QA Ciudad', address: 'Calle Sintetica QA 123',
        description: 'Precio y área a confirmar con el asesor.', status: 'available', images: [],
    };
    function executor(rows: any[]) {
        const listingsService = {
            search: jest.fn().mockResolvedValue(rows),
            getAvailableById: jest.fn(async (_s: string, id: string) => {
                const row = rows.find(r => r.id === id);
                return row ? { state: 'available', listing: row } : { state: 'not_found' };
            }),
        };
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]), $executeRawUnsafe: jest.fn(), executeInTenantSchema: jest.fn().mockResolvedValue([{ present: 1 }]) };
        const control = { preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }), complete: jest.fn(), fail: jest.fn() };
        const service = new AIToolExecutorService(
            prisma as any, {} as any, { emit: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            {} as any, {} as any, listingsService as any,
            {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
            control as any, {} as any, {} as any,
        );
        return (tool: string, args: Record<string, any>) => service.execute('tenant_qa', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222', tool, args, undefined, { authority: authorityFor(tool) });
    }

    it('search_listings and get_listing_details give price, area and rooms as fields, with the note', async () => {
        const run = executor([ROW]);
        const search = await run('search_listings', {});
        expect(search.listings[0]).toMatchObject({ price: 250000, priceStatus: 'confirmed', currency: 'EUR', areaM2: 80, bedrooms: 2, bathrooms: 1, transactionType: 'sale' });
        expect(search.fieldAuthority).toBe(LISTING_FIELD_AUTHORITY);
        const details = await run('get_listing_details', { listingId: SPARK });
        expect(details).toMatchObject({ price: 250000, priceStatus: 'confirmed', areaM2: 80, bedrooms: 2, bathrooms: 1, fieldAuthority: LISTING_FIELD_AUTHORITY });
        expect(LISTING_FIELD_AUTHORITY).toMatch(/areaM2, bedrooms, bathrooms.*description is free text.*never overrides, negates or replaces those fields/);
    });

    it('an empty search carries no note', async () => {
        const run = executor([]);
        expect((await run('search_listings', {})).fieldAuthority).toBeUndefined();
    });
});

/** The reply quotes the listing's confirmed price and area. The reply pipeline groups thousands per language (250.000 / 250,000 / a space). */
const QUOTES_LISTING = /^Spark QA Inmueble: 250[.,\s]000 EUR, 80 m²\.$/;

describe('through the turn: real estate, flag on, classifier missing the listing question', () => {
    it.each([
        'quelle est la surface du Spark QA Inmueble ?',
        '¿cuál es el área del Spark QA Inmueble?',
        'qual é a área do Spark QA Inmueble?',
        'what is the area of the Spark QA Inmueble?',
        'how much is the Spark QA Inmueble?',
        '¿cuánto cuesta el Spark QA Inmueble?',
    ])('«%s» with the FAQ intent → search_listings and get_listing_details before the model; 250.000 EUR, 80 m²', async message => {
        const h = fixture('{"operationKey":"ask_question","confidence":0.9}');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed().filter(name => name !== 'search_faqs')).toEqual(['search_listings', 'get_listing_details']);
        const details = h.readBodies().find((b: any) => b.id === SPARK && b.address);
        expect(details).toMatchObject({ price: 250000, priceStatus: 'confirmed', currency: 'EUR', areaM2: 80, fieldAuthority: LISTING_FIELD_AUTHORITY });
        expect(result.reply).toMatch(QUOTES_LISTING);
        expect(result.reply).not.toMatch(/pas la surface|not confirmed/);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'listings', operation: 'listing_info', source: 'lexical_cue', classifierOperation: 'ask_question',
            reads: [expect.objectContaining({ tool: 'search_listings', status: expect.stringMatching(/^(read|already_read)$/) }),
                expect.objectContaining({ tool: 'get_listing_details', status: expect.stringMatching(/^(read|already_read)$/) })],
        });
    });

    it('«¿cuánto cuesta el Spark QA Inmueble?» (Spanish) reads «250.000 EUR»', async () => {
        const h = fixture('{"operationKey":"ask_question","confidence":0.9}');
        const { result } = await h.turn('¿cuánto cuesta el Spark QA Inmueble?');
        expect(result.reply).toBe('Spark QA Inmueble: 250.000 EUR, 80 m².');
    });

    it('the production listing name is longer than what the customer typed: the required read still reads its details', async () => {
        const production = { ...LISTING, name: 'Spark QA Inmueble 20261018T2220Z' };
        const h = fixture('{"operationKey":"ask_question","confidence":0.9}', [production]);
        const { result, requiredReads } = await h.turn('quelle est la surface du Spark QA Inmueble ?');
        expect(result.debug.runtimeError).toBeUndefined();
        const metadata = requiredReads[0].metadata as any;
        expect(metadata).toMatchObject({ operation: 'listing_info', source: 'lexical_cue', outcome: 'read' });
        // The automatic lookup ran the list but could not name the listing; the required read takes the only one.
        expect(metadata.reads).toEqual([expect.objectContaining({ tool: 'search_listings', status: 'already_read' }), expect.objectContaining({ tool: 'get_listing_details', status: 'read' })]);
        expect(h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'get_listing_details')?.[4]).toEqual({ listingId: SPARK });
        expect(h.readBodies()).toEqual(expect.arrayContaining([expect.objectContaining({ id: SPARK, areaM2: 80, price: 250000 })]));
        expect(result.reply).toMatch(/^Spark QA Inmueble 20261018T2220Z: 250[.,\s]000 EUR, 80 m²\.$/);
    });

    it.each(['quanto custa o imóvel?', 'how many bedrooms does it have?', 'combien de chambres ?'])('«%s» with listing_info under the threshold → the reads run', async message => {
        const h = fixture('{"operationKey":"listing_info","confidence":0.7}');
        const { result, requiredReads } = await h.turn(message);
        expect(h.executed()).toEqual(expect.arrayContaining(['search_listings', 'get_listing_details']));
        expect(result.reply).toMatch(QUOTES_LISTING);
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'listing_info', source: 'lexical_cue', outcome: 'read', confidence: 0.7 });
    });

    it.each(['what properties are available?', '¿qué inmuebles tienen?', 'quais imóveis vocês têm?', 'quels biens avez-vous ?'])('«%s» with the FAQ intent → search_listings before the model, the price is the confirmed 250.000 EUR', async message => {
        const h = fixture('{"operationKey":"ask_question","confidence":0.88}');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toContain('search_listings');
        expect(h.executed()).not.toContain('get_listing_details');
        expect(h.readBodies()).toEqual([expect.objectContaining({ listings: [expect.objectContaining({ id: SPARK, price: 250000, priceStatus: 'confirmed', currency: 'EUR', areaM2: 80 })] })]);
        expect(result.reply).toMatch(QUOTES_LISTING);
        expect(result.reply).not.toMatch(/not confirmed/);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'listings', operation: 'find_listing', source: 'lexical_cue', classifierOperation: 'ask_question', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'search_listings', status: 'read' })],
        });
    });

    it('with two listings the open question lists both, and a named one reads its details', async () => {
        const OTHER = { ...LISTING, id: '66666666-6666-4666-8666-666666666666', name: 'Casa Rosales', price: 410000, areaM2: 160 };
        const h = fixture('{"operationKey":"ask_question","confidence":0.9}', [LISTING, OTHER]);
        const open = await h.turn('¿qué propiedades tienen disponibles?');
        expect(open.result.reply).toBe('Spark QA Inmueble: 250.000 EUR, 80 m². Casa Rosales: 410.000 EUR, 160 m².');
        h.f.toolExecutor.execute.mockClear();
        await h.turn('quelle est la surface du Spark QA Inmueble ?');
        const detailCall = h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'get_listing_details');
        expect(detailCall?.[4]).toEqual({ listingId: SPARK });
    });

    it.each([
        ['quiero agendar una visita', '{"operationKey":"ask_question","confidence":0.9}'],
        ['cancelar mi cita', '{"operationKey":"ask_question","confidence":0.9}'],
        ['hola', '{"operationKey":"none","confidence":0.95}'],
        ['hello!', '{"operationKey":"none","confidence":0.4}'],
        ['merci beaucoup', '{"operationKey":"none","confidence":0.95}'],
    ])('«%s» is never turned into a listing read', async (message, classifier) => {
        const h = fixture(classifier);
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).not.toContain('search_listings');
        expect(h.executed()).not.toContain('get_listing_details');
        for (const step of requiredReads) expect(step.metadata).toMatchObject({ outcome: 'skipped' });
        for (const step of requiredReads) expect((step.metadata as any).source).toBeUndefined();
    });
});

describe('rule 22a: a description never overrides a listing\'s structured fields', () => {
    it('the system prompt says so', async () => {
        const h = fixture('{"operationKey":"listing_info","confidence":0.9}');
        await h.turn('quelle est la surface du Spark QA Inmueble ?');
        const system = String(h.firstReply().systemPrompt ?? '');
        expect(system).toContain('A free-text description in the same result never overrides, negates or replaces those structured fields');
        expect(system).toContain("a listing's area (areaM2), bedrooms, bathrooms and sale or rent are such fields too");
    });
});
