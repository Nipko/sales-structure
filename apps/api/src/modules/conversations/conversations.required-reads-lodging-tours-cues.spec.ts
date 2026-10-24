import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_TOURS_FLAG } from '../throttle/feature-flags.service';
import { isLodgingQuestion, lexicalRequiredReadsOperation, tourQuestionOperation } from './runtime/operation-lexical-cues';
import { buildRequiredReadsTrace, REQUIRED_READS_CONFIDENCE_THRESHOLD, requiredReadsGate, requiredReadsPlan } from './runtime/required-reads.runner';
import { buildOperationClassifierPrompt, type OperationShadowVerdict } from './runtime/operation-classifier.service';
import { PACKAGE_FIELD_AUTHORITY, packageDuration } from './package-structured-fields';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { extractVerifiedFacts } from './runtime/facts-extractors';
import { getOperation, operationsForPublishedTools } from '@parallext/shared';

/**
 * Production QA 2026-10-24, after `agentRuntime.requiredReads.properties` and `.tours` were turned on for the QA tenants:
 *   - hotel price, minimum stay, address and availability-with-dates questions ran list_properties + get_property_details;
 *   - but hotel «à quelle heure est l'enregistrement ?» and «what time is check-out?» ran ONLY search_faqs and answered «I don't
 *     have the check-in/check-out time configured» (the property has check_in_time 15:00, check_out_time 11:00): the classifier
 *     maps a schedule question to the FAQ intent, and the reads only run on a confident pilot verdict;
 *   - travel «combien de places restent pour le Spark QA Tour ?» ran search_packages only and said there is no specific number of
 *     seats (the 2026-12-15 09:00 departure has 10);
 *   - travel «cuánto dura el tour Aurora?» ran search_packages and answered the tour «has no fixed duration» (duration_type hours,
 *     duration_value 4): the package's description text was read as a rule over the configured fields.
 *
 * Fixed by layer, the threshold untouched (same pattern as the restaurant menu cue, #207): the catalogue lines and the classifier
 * prompt name these questions in es/pt/fr/en; a lodging or tour question in the message's own words runs the pilot's reads when the
 * classifier missed (never over a confident other business operation); the package readers state the duration as one value and
 * that the configured fields win over the description, and so does rule 22a.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const HOTEL = '11111111-1111-4111-8111-111111111111';
const PROPERTY = { id: HOTEL, name: 'Spark QA Hotel', nightPrice: 150000, currency: 'COP', minNights: 2, priceStatus: 'confirmed', maxGuests: 4, bedrooms: 2, bathrooms: 1 };
const DETAILS = { ...PROPERTY, checkInTime: '15:00', checkOutTime: '11:00', address: 'Calle 10 #5-20, Medellín', amenities: ['wifi', 'piscina'] };
const SPARK = '33333333-3333-4333-8333-333333333333';
const AURORA = '44444444-4444-4444-8444-444444444444';
const DESCRIPTION = 'Experiencia ficticia de QA para pruebas.';
const PACKAGES = [
    { id: SPARK, name: 'Spark QA Tour', description: DESCRIPTION, durationType: 'hours', durationValue: 3, duration: '3 hours', price: 120000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: null },
    { id: AURORA, name: 'Tour Aurora', description: DESCRIPTION, durationType: 'hours', durationValue: 4, duration: '4 hours', price: 99000, currency: 'COP', priceStatus: 'confirmed', seatsLeft: null },
];
const DEPARTURES = [{ date: '2026-12-15', time: '09:00', seatsLeft: 10, priceOverride: null }];

const HOTEL_TOOLS = ['search_faqs', 'list_properties', 'check_property_availability', 'get_property_details', 'get_check_in_instructions',
    'create_property_booking', 'cancel_property_booking', 'list_my_property_bookings'];
const TOUR_TOOLS = ['search_faqs', 'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'cancel_tour_booking', 'list_my_tour_bookings'];

/** The production messages, and their es/pt/fr/en equivalents. */
const CHECK_IN_OUT = [
    "à quelle heure est l'enregistrement ?",
    'what time is check-out?',
    'what time is check-in?',
    '¿a qué hora es el check-in?',
    '¿a qué hora es la salida?',
    'que horas é o check-out?',
    'a que horas é a chegada?',
    'à quelle heure faut-il libérer la chambre ?',
];
const OTHER_LODGING = [
    'where is the hotel?', '¿cuál es la dirección?', 'qual é o endereço?', "quelle est l'adresse ?",
    'how many guests fit?', '¿cuántas personas caben?', 'quantas pessoas cabem?', 'combien de personnes maximum ?',
    'how many bedrooms and bathrooms does it have?', '¿cuántas habitaciones tiene?', 'quantos quartos tem?', 'combien de chambres ?',
    'do you have wifi?', '¿tienen piscina?', 'tem estacionamento?', 'avez-vous le petit déjeuner ?',
    'what is the minimum stay?', '¿cuál es la estadía mínima?', 'qual é a estadia mínima?', 'quel est le séjour minimum ?',
    'how much per night?', '¿cuánto cuesta la noche?', 'quanto custa a diária?', 'combien coûte la nuit ?',
];
const NOT_LODGING = [
    'hello!', 'thanks!', 'what time do you open?', '¿a qué hora abren?', 'do you accept credit cards?', 'aceitam cartão?',
    'I want to cancel my reservation', '¿cuál es la política de cancelación?', 'can I pay by bank transfer?', 'je veux un remboursement',
    'is someone there?', 'quiero hablar con una persona',
];
const SEATS = [
    'combien de places restent pour le Spark QA Tour ?',
    'how many seats are left for the Spark QA Tour?',
    '¿cuántos cupos quedan para el Spark QA Tour?',
    'quantas vagas restam para o Spark QA Tour?',
    'when is the next departure of the Spark QA Tour?',
    '¿cuándo es la próxima salida del Spark QA Tour?',
    'quais são as próximas datas do Spark QA Tour?',
    'quel est le prochain départ du Spark QA Tour ?',
];
const TOUR_DETAILS = [
    'cuánto dura el tour Aurora?',
    'how long is the Tour Aurora?',
    'quanto tempo dura o Tour Aurora?',
    'combien de temps dure le Tour Aurora ?',
    'what does the Tour Aurora include?',
    '¿qué incluye el Tour Aurora?',
    'o que inclui o Tour Aurora?',
    'how much is the Tour Aurora?',
];
const NOT_TOURS = [
    'hello!', 'what time do you open?', 'do you accept credit cards?', 'where is your office?', 'I want to cancel my booking',
    '¿cuál es la política de reembolso?', 'when does my booking start?', 'merci beaucoup',
];

type Vertical = 'hotel' | 'tours';

function fixture(vertical: Vertical, classifier: string) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = vertical === 'hotel' ? 'turismo/hotel' : 'turismo/tours';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry: 'turismo', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'turismo', subType: vertical === 'hotel' ? 'hotel' : 'tours' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: {
        [vertical === 'hotel' ? REQUIRED_READS_PROPERTIES_FLAG : REQUIRED_READS_TOURS_FLAG]: true,
    } } });
    publishTools(f, vertical === 'hotel' ? HOTEL_TOOLS : TOUR_TOOLS);
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [] }),
        list_properties: () => ({ properties: [PROPERTY] }),
        get_property_details: args => ({ ...DETAILS, id: args.propertyId }),
        search_packages: () => ({ packages: PACKAGES, fieldAuthority: PACKAGE_FIELD_AUTHORITY }),
        get_package_details: args => {
            const row = PACKAGES.find(p => p.id === args.packageId || p.name === args.packageId);
            return row ? { ...row, includes: ['transporte'], excludes: ['almuerzo'], upcomingDepartures: DEPARTURES, fieldAuthority: PACKAGE_FIELD_AUTHORITY } : { error: 'package_not_found' };
        },
        check_package_availability: () => ({ available: true, seatsLeft: 10 }),
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });

    // A stand-in model that answers ONLY from the tool results it was given, and otherwise does what production did.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } });
        const question = String(req.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '');
        const details = bodies.find((b: any) => b?.checkInTime);
        if (details) return { ...usage, content: `Check-in from ${details.checkInTime}, check-out until ${details.checkOutTime}.` };
        const departures = bodies.find((b: any) => Array.isArray(b?.upcomingDepartures) && b.upcomingDepartures.length);
        if (departures && /places|seats|cupos|vagas|salida|departure|datas|depart/i.test(question)) {
            const [next] = departures.upcomingDepartures;
            return { ...usage, content: `${next.seatsLeft} seats left on ${next.date} at ${next.time}.` };
        }
        const aurora = bodies.flatMap((b: any) => Array.isArray(b?.packages) ? b.packages : b?.id ? [b] : []).find((p: any) => p.id === AURORA);
        if (aurora?.duration) return { ...usage, content: `The Tour Aurora lasts ${aurora.duration}.` };
        // What production did without the reads.
        return { ...usage, content: vertical === 'hotel' ? "I don't have the check-in/check-out time configured." : 'There is no specific number of seats.' };
    });

    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): string[] => f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]);
    const firstReply = () => f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]).find((r: any) => r?.task !== 'classify');
    /** The tool results the FIRST model call received (required or automatic reads): what the model answers from. */
    const toolBodies = (): any[] => firstReply().messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    return { f, turn, executed, firstReply, toolBodies };
}

const verdict = (operationKey: string, confidence: number, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback, candidates: ['property_info', 'package_info', 'package_availability', 'ask_question'], latencyMs: 5 });

afterEach(() => jest.restoreAllMocks());

describe('lodging and tour questions in the message\'s own words (es/pt/fr/en)', () => {
    it.each([...CHECK_IN_OUT, ...OTHER_LODGING])('«%s» is a lodging question → property_info', text => {
        expect(isLodgingQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'properties', HOTEL_TOOLS)).toBe('property_info');
    });

    it.each(NOT_LODGING)('«%s» is not', text => {
        expect(isLodgingQuestion(text)).toBe(false);
        expect(lexicalRequiredReadsOperation(text, 'properties', HOTEL_TOOLS)).toBeNull();
    });

    it.each(SEATS)('«%s» is a departures/seats question → package_availability', text => {
        expect(tourQuestionOperation(text)).toBe('package_availability');
        expect(lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS)).toBe('package_availability');
    });

    it.each(TOUR_DETAILS)('«%s» is a package details question → package_info', text => {
        expect(tourQuestionOperation(text)).toBe('package_info');
        expect(lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS)).toBe('package_info');
    });

    it.each(NOT_TOURS)('«%s» is not a tour question', text => {
        expect(tourQuestionOperation(text)).toBeNull();
        expect(lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS)).toBeNull();
    });

    it('only its own pilot, and only when the turn publishes the pilot read', () => {
        expect(lexicalRequiredReadsOperation('what time is check-out?', 'tours', TOUR_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('what time is check-out?', 'restaurants', ['get_menu'])).toBeNull();
        expect(lexicalRequiredReadsOperation('what time is check-out?', 'properties', ['search_faqs', 'list_my_property_bookings'])).toBeNull();
        expect(lexicalRequiredReadsOperation('how long is the Tour Aurora?', 'properties', HOTEL_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('how long is the Tour Aurora?', 'tours', ['search_faqs', 'list_my_tour_bookings'])).toBeNull();
        // The menu cue is unchanged.
        expect(lexicalRequiredReadsOperation('how much is the Spark dish?', 'restaurants', ['get_menu'])).toBe('menu_info');
    });
});

describe('the gate: the cue runs what the classifier missed, the threshold does not move', () => {
    it.each([
        ['properties', 'property_info', verdict('ask_question', 0.9)],
        ['properties', 'property_info', verdict('property_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01)],
        ['properties', 'property_info', verdict('none', 0.9, 'none')],
        ['tours', 'package_availability', verdict('ask_question', 0.88)],
        ['tours', 'package_info', verdict('package_info', 0.7)],
        ['tours', 'package_info', verdict('none', 0, 'timeout')],
    ] as const)('%s: %s over %j', (pilot, op, v) => {
        const gate = requiredReadsGate(v, pilot, op);
        expect(gate).toMatchObject({ run: true, pilot, source: 'lexical_cue' });
        expect(gate.run && gate.operation.key).toBe(op);
        expect(buildRequiredReadsTrace({ pilot, verdict: v, gate, latencyMs: 1 })).toMatchObject({
            operation: op, source: 'lexical_cue', classifierOperation: v.operationKey, threshold: REQUIRED_READS_CONFIDENCE_THRESHOLD,
        });
    });

    it('without a cue the threshold is exactly what it was', () => {
        expect(requiredReadsGate(verdict('property_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01), 'properties', null)).toEqual({ run: false, reason: 'below_threshold' });
        expect(requiredReadsGate(verdict('ask_question', 0.95), 'tours', null)).toEqual({ run: false, reason: 'not_pilot_operation' });
    });

    it('a confident verdict keeps the turn: its own pilot operation, or another business operation', () => {
        const stay = requiredReadsGate(verdict('book_stay', 0.9), 'properties', 'property_info');
        expect(stay.run && stay.operation.key).toBe('book_stay');
        expect(stay.run && stay.source).toBeUndefined();
        const info = requiredReadsGate(verdict('package_info', 0.9), 'tours', 'package_availability');
        expect(info.run && info.operation.key).toBe('package_info');
        expect(requiredReadsGate(verdict('view_my_appointments', 0.95), 'properties', 'property_info')).toEqual({ run: false, reason: 'not_pilot_operation' });
        // A cue of another pilot does nothing.
        expect(requiredReadsGate(verdict('none', 0.9, 'none'), 'tours', 'property_info')).toEqual({ run: false, reason: 'fallback:none' });
    });

    it('a seats question with no date reads the departures (get_package_details); with a date, any tour read checks that departure', () => {
        const availability = getOperation('package_availability')!;
        expect(requiredReadsPlan(availability, {}).map(r => r.tool)).toEqual(['search_packages', 'check_package_availability', 'get_package_details']);
        expect(requiredReadsPlan(availability, { starts_at: '2026-12-15' }).map(r => r.tool)).toEqual(['search_packages', 'check_package_availability']);
        const info = getOperation('package_info')!;
        expect(requiredReadsPlan(info, {}).map(r => r.tool)).toEqual(['search_packages', 'get_package_details']);
        expect(requiredReadsPlan(info, { starts_at: '2026-12-15' }).map(r => r.tool)).toEqual(['search_packages', 'get_package_details', 'check_package_availability']);
    });
});

describe('the classifier sees a schedule question about the property as a property question, not the FAQ intent', () => {
    it('the catalogue lines and the classifier prompt name these questions in every language', () => {
        expect(getOperation('property_info')?.description).toEqual(expect.stringContaining("à quelle heure est l'enregistrement ?"));
        expect(getOperation('package_availability')?.description).toEqual(expect.stringContaining('combien de places restent pour X ?'));
        expect(getOperation('package_info')?.description).toEqual(expect.stringContaining('¿cuánto dura el tour X?'));
        const hotel = buildOperationClassifierPrompt(operationsForPublishedTools(HOTEL_TOOLS));
        expect(hotel).toMatch(/what time is check-out\?.*¿a qué hora es el check-in\?.*que horas é o check-out\?.*à quelle heure est l'enregistrement/);
        expect(hotel).toMatch(/check-in or check-out \(arrival or departure\) time.*are property_info, never ask_question, in any language/);
        expect(hotel).not.toContain('For a travel business');
        const tours = buildOperationClassifierPrompt(operationsForPublishedTools(TOUR_TOOLS));
        expect(tours).toMatch(/how many seats are left.*are package_availability; its duration.*are package_info; never ask_question/);
        expect(tours).not.toContain('For a lodging business');
    });
});

describe('the package readers: the configured duration wins over the description', () => {
    it.each([
        ['hours', 4, '4 hours'], ['hours', 1, '1 hour'], ['days', 3, '3 days'], ['days', '2', '2 days'],
        ['hours', null, null], ['hours', 0, null], ['weeks', 2, null], [undefined, 4, null],
    ] as const)('%s × %s → %s', (type, value, label) => {
        expect(packageDuration(type, value)).toBe(label);
    });

    function executor() {
        const toursService = { searchPackages: jest.fn(), getPackage: jest.fn(), listInventory: jest.fn() };
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
    const ROW = { id: AURORA, name: 'Tour Aurora', description: DESCRIPTION, duration_type: 'hours', duration_value: 4, price: 99000, currency: 'COP', is_active: true, includes: ['transporte'], excludes: ['almuerzo'] };

    it('search_packages and get_package_details state the duration and which fields are the configured data', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([ROW]);
        h.toursService.getPackage.mockResolvedValue(ROW);
        h.toursService.listInventory.mockResolvedValue([{ departure_date: '2026-12-15', departure_time: '09:00', available_seats: 10 }]);
        const search = await h.run('search_packages', {});
        expect(search.packages[0]).toMatchObject({ durationType: 'hours', durationValue: 4, duration: '4 hours', description: DESCRIPTION });
        expect(search.fieldAuthority).toBe(PACKAGE_FIELD_AUTHORITY);
        const details = await h.run('get_package_details', { packageId: AURORA });
        expect(details).toMatchObject({ duration: '4 hours', includes: ['transporte'], excludes: ['almuerzo'], fieldAuthority: PACKAGE_FIELD_AUTHORITY,
            upcomingDepartures: [expect.objectContaining({ date: '2026-12-15', time: '09:00', seatsLeft: 10 })] });
        expect(PACKAGE_FIELD_AUTHORITY).toMatch(/description is free text.*never overrides, negates or replaces those fields/);
        // The duration is a verified fact of the package, like its price.
        const { facts } = extractVerifiedFacts([{ name: 'search_packages', result: search }], new Date('2026-10-24T12:00:00Z'));
        expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'attribute', subject: expect.objectContaining({ id: AURORA }), field: 'duration', value: '4 hours' })]));
    });

    it('an empty search carries no note', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([]);
        const search = await h.run('search_packages', {});
        expect(search.fieldAuthority).toBeUndefined();
    });
});

describe('through the turn: hotel, flag on, classifier missing the property question', () => {
    it.each(CHECK_IN_OUT)('«%s» with the classifier answering the FAQ intent → list_properties and get_property_details before the model', async message => {
        const h = fixture('hotel', '{"operationKey":"ask_question","confidence":0.9}');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining(['list_properties', 'get_property_details']));
        expect(h.executed()).not.toContain('get_check_in_instructions');
        expect(h.toolBodies().some((b: any) => b.checkInTime === '15:00' && b.checkOutTime === '11:00')).toBe(true);
        expect(result.reply).toBe('Check-in from 15:00, check-out until 11:00.');
        expect(result.reply).not.toMatch(/configured/);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'properties', operation: 'property_info', source: 'lexical_cue', classifierOperation: 'ask_question', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'list_properties', status: 'read' }), expect.objectContaining({ tool: 'get_property_details', status: 'read' })],
        });
    });

    it.each(['where is the hotel?', 'how many guests fit?', 'do you have wifi?', 'what is the minimum stay?'])('«%s» with property_info under the threshold → the reads run', async message => {
        const h = fixture('hotel', '{"operationKey":"property_info","confidence":0.7}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).toEqual(expect.arrayContaining(['list_properties', 'get_property_details']));
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'property_info', source: 'lexical_cue', outcome: 'read', confidence: 0.7 });
    });

    it.each(['what time do you open?', 'do you accept credit cards?', 'I want to cancel my reservation'])('«%s» (FAQ intent) is never turned into a property read', async message => {
        const h = fixture('hotel', '{"operationKey":"ask_question","confidence":0.9}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).not.toContain('list_properties');
        expect(h.executed()).not.toContain('get_property_details');
        // A cancellation leaves the turn before the reads (its own flow): either way, never a catalogue read.
        for (const step of requiredReads) expect(step.metadata).toMatchObject({ outcome: 'skipped', reason: 'not_pilot_operation' });
    });
});

describe('through the turn: travel, flag on, classifier missing the tour question', () => {
    it.each(SEATS.slice(0, 4))('«%s» with the classifier answering the FAQ intent → the departures and their seats are read before the model', async message => {
        const h = fixture('tours', '{"operationKey":"ask_question","confidence":0.88}');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining(['search_packages', 'get_package_details']));
        const details = h.toolBodies().find((b: any) => b.id === SPARK && Array.isArray(b.upcomingDepartures));
        expect(details.upcomingDepartures[0]).toMatchObject({ date: '2026-12-15', time: '09:00', seatsLeft: 10 });
        expect(result.reply).toBe('10 seats left on 2026-12-15 at 09:00.');
        expect(result.reply).not.toMatch(/no specific number/);
        const metadata = requiredReads[0].metadata as any;
        expect(metadata).toMatchObject({ pilot: 'tours', operation: 'package_availability', source: 'lexical_cue', classifierOperation: 'ask_question' });
        expect(metadata.reads).toEqual(expect.arrayContaining([
            expect.objectContaining({ tool: 'check_package_availability', status: 'missing_slot' }),
            expect.objectContaining({ tool: 'get_package_details', status: expect.stringMatching(/^(read|already_read)$/) }),
        ]));
    });

    it('a seats question with a date reads check_package_availability for that departure', async () => {
        const h = fixture('tours', '{"operationKey":"package_availability","confidence":0.6}');
        const { requiredReads } = await h.turn('how many seats are left for the Spark QA Tour on December 15?');
        const check = h.f.toolExecutor.execute.mock.calls.find((c: any[]) => c[3] === 'check_package_availability');
        expect(check?.[4]).toMatchObject({ packageId: SPARK, date: expect.stringMatching(/-12-15$/) });
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'package_availability', source: 'lexical_cue' });
        expect((requiredReads[0].metadata as any).reads).toEqual(expect.arrayContaining([
            expect.objectContaining({ tool: 'check_package_availability', status: 'read' }),
        ]));
    });

    it.each(['cuánto dura el tour Aurora?', 'how long is the Tour Aurora?', 'combien de temps dure le Tour Aurora ?'])('«%s» under the threshold → the package reads run and the model sees the configured duration', async message => {
        const h = fixture('tours', '{"operationKey":"package_info","confidence":0.65}');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining(['search_packages', 'get_package_details']));
        const aurora = h.toolBodies().find((b: any) => b.id === AURORA);
        expect(aurora).toMatchObject({ durationType: 'hours', durationValue: 4, duration: '4 hours', fieldAuthority: PACKAGE_FIELD_AUTHORITY });
        expect(result.reply).toBe('The Tour Aurora lasts 4 hours.');
        expect(requiredReads[0].metadata).toMatchObject({ pilot: 'tours', operation: 'package_info', source: 'lexical_cue' });
    });

    it.each(['do you accept credit cards?', 'where is your office?', 'I want to cancel my booking'])('«%s» (FAQ intent) is never turned into a package read', async message => {
        const h = fixture('tours', '{"operationKey":"ask_question","confidence":0.9}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).not.toContain('get_package_details');
        expect(h.executed()).not.toContain('check_package_availability');
        for (const step of requiredReads) expect(step.metadata).toMatchObject({ outcome: 'skipped', reason: 'not_pilot_operation' });
    });
});

describe('rule 22a: a description never overrides the structured fields', () => {
    it('the system prompt says so for every catalogue result', async () => {
        const h = fixture('tours', '{"operationKey":"package_info","confidence":0.9}');
        await h.turn('how long is the Tour Aurora?');
        const system = String(h.firstReply().systemPrompt ?? '');
        expect(system).toContain('A free-text description in the same result never overrides, negates or replaces those structured fields (price, duration, includes, excludes, check-in or check-out time)');
    });
});
