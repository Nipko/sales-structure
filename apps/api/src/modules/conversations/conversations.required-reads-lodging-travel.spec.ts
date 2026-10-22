import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_TOURS_FLAG } from '../throttle/feature-flags.service';

/**
 * Operations runtime PR7 through the real turn (Agent Test runtime session): hotel / vacation rental and travel run the reads
 * their operation owes BEFORE the model when `agentRuntime.requiredReads.properties|tours` is on and the classifier is confident.
 *
 * Production QA (Telegram, the flag would be on):
 *   - hotel «¿cuánto cuesta la noche?» with no dates → asked for dates, then «no tengo un precio base» (list_properties returns
 *     nightPrice 150.000 COP, minNights 1): the answer is the "desde" price;
 *   - hotel «¿tienen disponible del 3 al 5 de diciembre para 2?» → availability claimed without check_property_availability;
 *   - hotel «¿a qué hora es el check-in?» / «¿a qué hora hay que entregar la habitación?» → only get_property_details has the times;
 *   - travel «¿qué planes manejan?» → asked for filters instead of listing the packages.
 *
 * The model is a stand-in that answers ONLY from the tool results it was given, and otherwise does what production did.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const CABANA = '11111111-1111-4111-8111-111111111111';
const PROPERTY = { id: CABANA, name: 'Cabaña del Lago', nightPrice: 150000, cleaningFee: 0, currency: 'COP', minNights: 1, priceStatus: 'confirmed', maxGuests: 4 };
const DETAILS = { ...PROPERTY, checkInTime: '15:00', checkOutTime: '11:00', amenities: ['wifi'], houseRules: 'No mascotas' };
const TOUR = '33333333-3333-4333-8333-333333333333';
const PACKAGES = [
    { id: TOUR, name: 'Tour Cafetero', price: 129000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: 8 },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Ruta del Sol', price: 99000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: null },
];

const HOTEL_TOOLS = ['list_properties', 'check_property_availability', 'get_property_details', 'get_check_in_instructions',
    'create_property_booking', 'cancel_property_booking', 'list_my_property_bookings'];
const TOUR_TOOLS = ['search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'cancel_tour_booking', 'list_my_tour_bookings'];

type Vertical = 'hotel' | 'tours';

function fixture(vertical: Vertical, flags: Record<string, boolean>, classifier: string, results: Record<string, (args: any) => any> = {}) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = vertical === 'hotel' ? 'turismo/hotel' : 'turismo/tours';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'turismo', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'turismo', subType: vertical === 'hotel' ? 'hotel' : 'tours' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: flags } });
    publishTools(f, vertical === 'hotel' ? HOTEL_TOOLS : TOUR_TOOLS);
    const defaults: Record<string, (args: any) => any> = {
        list_properties: args => ({ properties: [args?.checkIn ? { ...PROPERTY, totalPrice: 300000, nights: 2 } : PROPERTY] }),
        get_property_details: args => ({ ...DETAILS, id: args.propertyId }),
        check_property_availability: () => ({ available: true, nights: 2, nightPrice: 150000, totalPrice: 300000, currency: 'COP', priceStatus: 'confirmed' }),
        search_packages: () => ({ packages: PACKAGES }),
        get_package_details: args => ({ ...PACKAGES[0], id: args.packageId, includes: ['transporte'], upcomingDepartures: [] }),
        check_package_availability: () => ({ available: true, seatsLeft: 8 }),
    };
    const all = { ...defaults, ...results };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        all[name] ? all[name](args) : { error: `unexpected tool ${name}` });

    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
        const failed = bodies.find((b: any) => b?.error);
        if (failed) return { ...usage, content: String(failed.message || 'No pude consultar.') };
        const availability = bodies.find((b: any) => b?.available === true && b?.totalPrice);
        const details = bodies.find((b: any) => b?.checkInTime);
        const properties = bodies.find((b: any) => Array.isArray(b?.properties));
        const packages = bodies.find((b: any) => Array.isArray(b?.packages));
        const seats = bodies.find((b: any) => b?.available === true && b?.seatsLeft);
        if (availability) return { ...usage, content: 'Sí, la Cabaña del Lago está disponible del 3 al 5 de diciembre.' };
        if (seats) return { ...usage, content: `Sí, quedan ${seats.seatsLeft} cupos.` };
        if (details && /check-?in|entrar|llegar/i.test(req.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '')) {
            return { ...usage, content: `El check-in es a partir de las ${details.checkInTime}.` };
        }
        if (details && /entregar|salida|check-?out/i.test(req.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '')) {
            return { ...usage, content: `La habitación se entrega a las ${details.checkOutTime}.` };
        }
        if (properties && properties.priceBasis === 'from_nightly_price') return { ...usage, content: 'La noche está desde 150.000 COP.' };
        if (packages) return { ...usage, content: `Manejamos: ${packages.packages.map((p: any) => p.name).join(', ')}.` };
        // What production did without the reads.
        return { ...usage, content: vertical === 'hotel' ? '¿Para qué fechas sería su estadía?' : '¿A qué destino y en qué fechas le gustaría viajar?' };
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

afterEach(() => jest.restoreAllMocks());

describe('required reads through the turn: hotel (PR7)', () => {
    it('«¿cuánto cuesta la noche?» with no dates: list_properties and the details before the model, answered as a "desde" price', async () => {
        const h = fixture('hotel', { [REQUIRED_READS_PROPERTIES_FLAG]: true }, '{"operationKey":"property_info","confidence":0.93}');
        const { result, requiredReads } = await h.turn('cuánto cuesta la noche?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining([
            { name: 'list_properties', args: {} },
            { name: 'get_property_details', args: { propertyId: CABANA } },
        ]));
        const [list] = h.requiredReadBodies();
        expect(list).toMatchObject({ priceBasis: 'from_nightly_price', properties: [expect.objectContaining({ nightPrice: 150000, minNights: 1 })] });
        expect(result.reply).toBe('La noche está desde 150.000 COP.');
        expect(result.reply).not.toMatch(/fechas|precio base/i);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'properties', operation: 'property_info', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'list_properties', status: 'read', complete: true, total: 1 }),
                expect.objectContaining({ tool: 'get_property_details', status: 'read' })],
        });
    });

    it('«¿tienen disponible del 3 al 5 de diciembre para 2?»: the dates force the availability read before any claim', async () => {
        const h = fixture('hotel', { [REQUIRED_READS_PROPERTIES_FLAG]: true }, '{"operationKey":"book_stay","confidence":0.9}');
        const { result, requiredReads } = await h.turn('tienen disponible del 3 al 5 de diciembre para 2?');
        expect(result.debug.runtimeError).toBeUndefined();
        const executed = h.executed();
        const availability = executed.find(c => c.name === 'check_property_availability');
        expect(availability?.args).toMatchObject({ propertyId: CABANA, guests: 2, checkIn: expect.stringMatching(/-12-03$/), checkOut: expect.stringMatching(/-12-05$/) });
        expect(executed.find(c => c.name === 'list_properties')?.args).toMatchObject({ checkIn: availability?.args.checkIn, checkOut: availability?.args.checkOut });
        expect(h.requiredReadBodies().some((b: any) => b.available === true)).toBe(true);
        expect(result.reply).toMatch(/disponible del 3 al 5 de diciembre/);
        expect(requiredReads[0].metadata).toMatchObject({
            operation: 'book_stay', outcome: 'read', slots: expect.arrayContaining(['check_in', 'check_out', 'guests']),
            reads: expect.arrayContaining([expect.objectContaining({ tool: 'check_property_availability', status: 'read' })]),
        });
    });

    it.each([
        ['a qué hora es el check-in?', 'stay_logistics', 'El check-in es a partir de las 15:00.'],
        ['a qué hora hay que entregar la habitación?', 'property_info', 'La habitación se entrega a las 11:00.'],
    ])('«%s» chains get_property_details on the one property', async (question, operation, reply) => {
        const h = fixture('hotel', { [REQUIRED_READS_PROPERTIES_FLAG]: true }, `{"operationKey":"${operation}","confidence":0.9}`);
        const { result, requiredReads } = await h.turn(question);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining([{ name: 'get_property_details', args: { propertyId: CABANA } }]));
        // stay_logistics: the guest's booking and its instructions (identity step-up) are NOT read before the model.
        expect(h.executed().map(c => c.name)).not.toContain('get_check_in_instructions');
        expect(h.requiredReadBodies().some((b: any) => b.checkInTime === '15:00' && b.checkOutTime === '11:00')).toBe(true);
        expect(result.reply).toBe(reply);
        expect(requiredReads[0].metadata).toMatchObject({ pilot: 'properties', operation, outcome: 'read' });
    });

    it('a failed read is an admission ("no pude consultar"), never an empty list', async () => {
        const h = fixture('hotel', { [REQUIRED_READS_PROPERTIES_FLAG]: true }, '{"operationKey":"property_info","confidence":0.93}',
            { list_properties: () => ({ error: 'catalog_unavailable' }) });
        const { result, requiredReads } = await h.turn('cuánto cuesta la noche?');
        expect(result.debug.runtimeError).toBeUndefined();
        const [body] = h.requiredReadBodies();
        expect(body.error).toBeTruthy();
        expect(body.properties).toBeUndefined();
        expect(body.message).toMatch(/^No pude consultar/);
        expect(result.reply).toMatch(/^No pude consultar/);
        expect(requiredReads[0].metadata).toMatchObject({
            outcome: 'admit',
            reads: [expect.objectContaining({ tool: 'list_properties', status: 'failed' }), { tool: 'get_property_details', status: 'upstream_failed' }],
        });
    });
});

describe('required reads through the turn: travel (PR7)', () => {
    it('«¿qué planes manejan?» lists the packages instead of asking for filters', async () => {
        const h = fixture('tours', { [REQUIRED_READS_TOURS_FLAG]: true }, '{"operationKey":"package_info","confidence":0.86}');
        const { result, requiredReads } = await h.turn('qué planes manejan?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining([{ name: 'search_packages', args: {} }]));
        expect(h.requiredReadBodies()[0].packages).toHaveLength(2);
        expect(result.reply).toBe('Manejamos: Tour Cafetero, Ruta del Sol.');
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'tours', operation: 'package_info', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'search_packages' }), { tool: 'get_package_details', status: 'ambiguous_receipt' }],
        });
    });

    it('availability of a named package on a date runs check_package_availability with the date and the group', async () => {
        const h = fixture('tours', { [REQUIRED_READS_TOURS_FLAG]: true }, '{"operationKey":"package_availability","confidence":0.92}');
        const { result } = await h.turn('hay cupo en el Tour Cafetero para el 15 de noviembre para 4?');
        expect(result.debug.runtimeError).toBeUndefined();
        const check = h.executed().find(c => c.name === 'check_package_availability');
        expect(check?.args).toMatchObject({ packageId: TOUR, partySize: 4, date: expect.stringMatching(/-11-15$/) });
        expect(result.reply).toBe('Sí, quedan 8 cupos.');
    });
});

describe('required reads PR7: flags', () => {
    it('flag off: no classification, no read, no trace step', async () => {
        const off = fixture('hotel', {}, '{"operationKey":"property_info","confidence":0.93}');
        const offTurn = await off.turn('cuánto cuesta la noche?');
        expect(off.classifyCalls()).toHaveLength(0);
        expect(offTurn.requiredReads).toEqual([]);
        expect(off.replyCalls()[0].messages.some((m: any) => String(m.toolCallId ?? '').startsWith('required_read_'))).toBe(false);
        expect(offTurn.result.reply).toBe('¿Para qué fechas sería su estadía?');
    });

    it.each([
        ['hotel', REQUIRED_READS_TOURS_FLAG, 'cuánto cuesta la noche?'],
        ['tours', REQUIRED_READS_PROPERTIES_FLAG, 'qué planes manejan?'],
    ] as const)('%s: the other vertical\'s flag leaves model input and tools identical to the baseline', async (vertical, otherFlag, question) => {
        const off = fixture(vertical, {}, '{"operationKey":"none","confidence":0.9}');
        const offTurn = await off.turn(question);
        const baseline = { executed: off.executed(), messages: off.replyCalls().map(c => c.messages), tools: toolNames(off.replyCalls()), reply: offTurn.result.reply };
        jest.restoreAllMocks();

        const other = fixture(vertical, { [otherFlag]: true }, '{"operationKey":"none","confidence":0.9}');
        const otherTurn = await other.turn(question);
        expect(other.classifyCalls()).toHaveLength(0);
        expect(otherTurn.requiredReads).toEqual([]);
        expect(other.executed()).toEqual(baseline.executed);
        expect(other.replyCalls().map(c => c.messages)).toEqual(baseline.messages);
        expect(toolNames(other.replyCalls())).toEqual(baseline.tools);
        expect(otherTurn.result.reply).toEqual(baseline.reply);
    });

    it('Agent Test reads the flags from the sealed snapshot: no tenant query and no flag-service lookup per turn', async () => {
        const h = fixture('hotel', { [REQUIRED_READS_PROPERTIES_FLAG]: true }, '{"operationKey":"property_info","confidence":0.93}');
        await h.turn('cuánto cuesta la noche?');
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;
        const second = await h.turn('y a qué hora es el check-in?');
        expect(second.result.debug.runtimeError).toBeUndefined();
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
        // One required_reads step per turn (the trace spy accumulates across the two turns).
        expect(second.requiredReads).toHaveLength(2);
        const flagLookups = h.featureFlags.isFeatureEnabled.mock.calls.map((c: any[]) => c[1]);
        expect(flagLookups).not.toContain(REQUIRED_READS_PROPERTIES_FLAG);
        expect(flagLookups).not.toContain(REQUIRED_READS_TOURS_FLAG);
    });
});
