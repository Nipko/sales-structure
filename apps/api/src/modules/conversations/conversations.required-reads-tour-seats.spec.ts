import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_TOURS_FLAG } from '../throttle/feature-flags.service';
import { lexicalRequiredReadsOperation } from './runtime/operation-lexical-cues';
import { pickReceiptId, requiredReadsGate, requiredReadsPlan } from './runtime/required-reads.runner';
import type { OperationShadowVerdict } from './runtime/operation-classifier.service';
import { PACKAGE_FIELD_AUTHORITY, PACKAGE_SEATS_NOTE } from './package-structured-fields';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { getOperation } from '@parallext/shared';

/**
 * Production 2026-10-24, image b168adb0 (#208 deployed), travel QA tenant with `agentRuntime.requiredReads.tours` on:
 * «combien de places restent pour le Spark QA Tour ?» ran only search_packages (+ search_faqs), never get_package_details, and
 * replied «Le Spark QA Tour dure 4 heures et son prix est de 125 EUR. Cependant, je n'ai pas l'information précise sur le nombre
 * de places restantes» while the 2026-12-15 09:00 departure had 10 seats. Same with «cuántos cupos quedan en el Spark QA Tour?».
 *
 * The package is «Spark QA Tour 20261018T2140Z» and the list has other packages. get_package_details takes its id from the
 * search receipt, and a receipt with several rows only resolved to a row whose WHOLE name was in the message: the customer said
 * «Spark QA Tour», so the read was `ambiguous_receipt` and never ran, whatever the classifier said. And the dateless search gave
 * every package `seatsLeft: null`, which the model read as "unknown".
 *
 * Fixed by layer: (1) a row is named when every word of its name that carries no digit starts a word of the message (the more
 * specific name wins, a tie names none); (2) a confident `package_info` verdict is narrowed to `package_availability` when the
 * message asks seats or departures (never a booking, never another pilot); (3) the dateless search carries no null seat count,
 * and says the seats are in each departure (get_package_details.upcomingDepartures).
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const SPARK = '33333333-3333-4333-8333-333333333333';
const AURORA = '44444444-4444-4444-8444-444444444444';
const RUTA = '55555555-5555-4555-8555-555555555555';
const SPARK_NAME = 'Spark QA Tour 20261018T2140Z';
const row = (id: string, name: string) => ({ id, name, description: 'Experiencia ficticia de QA.', durationType: 'hours', durationValue: 4,
    duration: '4 hours', price: 125, currency: 'EUR', priceStatus: 'confirmed' });
const PACKAGES = [row(SPARK, SPARK_NAME), row(AURORA, 'Tour Aurora'), row(RUTA, 'Ruta del Sol QA 20261001T0900Z')];
const DEPARTURES = [{ date: '2026-12-15', time: '09:00', seatsLeft: 10, priceOverride: null }];
const TOUR_TOOLS = ['search_faqs', 'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'cancel_tour_booking', 'list_my_tour_bookings'];

/** The production messages (fr, es) and their en/pt equivalents. */
const PRODUCTION = [
    'combien de places restent pour le Spark QA Tour ?',
    'cuántos cupos quedan en el Spark QA Tour?',
    'how many seats are left for the Spark QA Tour?',
    'quantas vagas restam no Spark QA Tour?',
];
const DEPARTURE_QUESTIONS = [
    'quel est le prochain départ du Spark QA Tour ?',
    '¿cuándo es la próxima salida del Spark QA Tour?',
    'when is the next departure of the Spark QA Tour?',
    'quais são as próximas datas do Spark QA Tour?',
];
const CLASSIFIERS = [
    ['confident package_info', '{"operationKey":"package_info","confidence":0.93}', 'package_info'],
    ['confident ask_question', '{"operationKey":"ask_question","confidence":0.9}', 'ask_question'],
] as const;

function fixture(classifier: string) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'turismo/tours';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'fr', industry: 'turismo', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'turismo', subType: 'tours' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_TOURS_FLAG]: true } } });
    publishTools(f, TOUR_TOOLS);
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [] }),
        // What the reader returns now for a dateless search: no seat count, and where the seats are.
        search_packages: () => ({ packages: PACKAGES, fieldAuthority: PACKAGE_FIELD_AUTHORITY, seatsNote: PACKAGE_SEATS_NOTE }),
        get_package_details: args => {
            const found = PACKAGES.find(p => p.id === args.packageId);
            return found ? { ...found, includes: ['guía'], excludes: [], upcomingDepartures: found.id === SPARK ? DEPARTURES : [], fieldAuthority: PACKAGE_FIELD_AUTHORITY }
                : { error: 'package_not_found' };
        },
        check_package_availability: () => ({ available: true, seatsLeft: 10 }),
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });

    // A stand-in model that answers ONLY from the tool results it was given, and otherwise says what production said.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } });
        const details = bodies.find((b: any) => b?.id === SPARK && Array.isArray(b?.upcomingDepartures) && b.upcomingDepartures.length);
        if (details) {
            const [next] = details.upcomingDepartures;
            const day = new Date(`${next.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
            return { ...usage, content: `${next.seatsLeft} seats left on the ${day} ${next.time} departure of the Spark QA Tour.` };
        }
        return { ...usage, content: "Le Spark QA Tour dure 4 heures et son prix est de 125 EUR. Cependant, je n'ai pas l'information précise sur le nombre de places restantes." };
    });

    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const calls = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3] as string, args: c[4] }));
    const firstReply = () => f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]).find((r: any) => r?.task !== 'classify');
    const toolBodies = (): any[] => firstReply().messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
    return { f, turn, calls, toolBodies };
}

const verdict = (operationKey: string, confidence: number): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback: null, candidates: ['package_info', 'package_availability', 'book_tour', 'ask_question'], latencyMs: 5 });

afterEach(() => jest.restoreAllMocks());

describe('the package the customer named, from the search receipt', () => {
    const ref = { tool: 'search_packages', container: 'packages', field: 'id' };
    const search = { packages: PACKAGES };

    it.each([...PRODUCTION, ...DEPARTURE_QUESTIONS])('«%s» names «Spark QA Tour 20261018T2140Z» (a timestamp suffix is not said aloud)', text => {
        expect(pickReceiptId(search, ref, text)).toEqual({ id: SPARK });
    });

    it('the whole name, the words in another order, and the more specific of two names', () => {
        expect(pickReceiptId(search, ref, `seats for ${SPARK_NAME}?`)).toEqual({ id: SPARK });
        expect(pickReceiptId(search, ref, 'how many seats on the Aurora tour?')).toEqual({ id: AURORA });
        const both = { packages: [...PACKAGES, row('66666666-6666-4666-8666-666666666666', 'Spark QA Tour Premium')] };
        expect(pickReceiptId(both, ref, 'combien de places restent pour le Spark QA Tour ?')).toEqual({ id: SPARK });
        expect(pickReceiptId(both, ref, 'combien de places pour le Spark QA Tour Premium ?')).toEqual({ id: '66666666-6666-4666-8666-666666666666' });
    });

    it('no name, a generic word, or two packages with the same spoken name: no guess', () => {
        expect(pickReceiptId(search, ref, 'combien de places restent ?')).toEqual({ reason: 'ambiguous_receipt' });
        expect(pickReceiptId(search, ref, 'how many seats are left on the tour?')).toEqual({ reason: 'ambiguous_receipt' });
        expect(pickReceiptId(search, ref, 'cupos para el Spark?')).toEqual({ reason: 'ambiguous_receipt' });
        const twins = { packages: [...PACKAGES, row('77777777-7777-4777-8777-777777777777', 'Spark QA Tour 20261019T1000Z')] };
        expect(pickReceiptId(twins, ref, 'combien de places restent pour le Spark QA Tour ?')).toEqual({ reason: 'ambiguous_receipt' });
        expect(pickReceiptId(twins, ref, 'places pour le Spark QA Tour 20261019T1000Z ?')).toEqual({ id: '77777777-7777-4777-8777-777777777777' });
        // The only package is that package, named or not.
        expect(pickReceiptId({ packages: [PACKAGES[0]] }, ref, 'combien de places restent ?')).toEqual({ id: SPARK });
    });
});

describe('the gate: a seats or departure question owes the departures', () => {
    it.each([...PRODUCTION, ...DEPARTURE_QUESTIONS])('«%s» narrows a confident package_info to package_availability', text => {
        const cue = lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS);
        expect(cue).toBe('package_availability');
        const gate = requiredReadsGate(verdict('package_info', 0.93), 'tours', cue);
        expect(gate).toMatchObject({ run: true, pilot: 'tours', source: 'lexical_cue' });
        expect(gate.run && requiredReadsPlan(gate.operation, {}).map(r => r.tool)).toEqual(expect.arrayContaining(['search_packages', 'get_package_details']));
    });

    it('never over a booking, another pilot, or a package_info question', () => {
        const booking = requiredReadsGate(verdict('book_tour', 0.93), 'tours', 'package_availability');
        expect(booking.run && booking.operation.key).toBe('book_tour');
        expect(booking.run && booking.source).toBeUndefined();
        const info = requiredReadsGate(verdict('package_info', 0.93), 'tours', 'package_info');
        expect(info.run && info.operation.key).toBe('package_info');
        expect(info.run && info.source).toBeUndefined();
        const lodging = requiredReadsGate(verdict('property_info', 0.93), 'properties', 'package_availability');
        expect(lodging.run && lodging.operation.key).toBe('property_info');
        expect(requiredReadsPlan(getOperation('package_info')!, {}).map(r => r.tool)).toEqual(['search_packages', 'get_package_details']);
    });
});

describe('search_packages: seats belong to a departure', () => {
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
    const DB_ROW = { id: SPARK, name: SPARK_NAME, duration_type: 'hours', duration_value: 4, price: 125, currency: 'EUR', is_active: true };

    it('without a date: no null seat count, and the note says where the seats are', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([DB_ROW]);
        const search = await h.run('search_packages', {});
        expect(search.packages[0]).not.toHaveProperty('seatsLeft');
        expect(search.seatsNote).toBe(PACKAGE_SEATS_NOTE);
        expect(PACKAGE_SEATS_NOTE).toMatch(/in get_package_details of that package/);
        expect(PACKAGE_SEATS_NOTE).toMatch(/\(date, time, seatsLeft\)/);
        expect(PACKAGE_SEATS_NOTE).toMatch(/an empty list means no departure is scheduled/);
        // Production QA 29-oct: «What are the specific departure times for the tours?» → «not listed», with a departure on file.
        expect(PACKAGE_SEATS_NOTE).toMatch(/Never say the seat count or the departure dates or times are unknown or not recorded when they are listed, or before reading them/);
    });

    // POST308 (production QA 29-oct): «What are the specific departure times for the tours?» → «not listed» after search_packages
    // only. The dateless search now carries each package's next departures; a package with none says so with an empty list.
    it('without a date: each package carries its next departures (date, time, seats); none scheduled is an empty list', async () => {
        const h = executor();
        const other = { ...DB_ROW, id: '22222222-2222-4222-8222-222222222222', name: 'Tour QA Aurora 20261014' };
        h.toursService.searchPackages.mockResolvedValue([DB_ROW, other]);
        h.toursService.listInventory.mockImplementation(async (_s: string, id: string) => id === DB_ROW.id
            ? [{ departure_date: '2026-12-15', departure_time: '09:00', available_seats: 10 }] : []);
        const search = await h.run('search_packages', {});
        expect(search.packages[0].upcomingDepartures).toEqual([{ date: '2026-12-15', time: '09:00', seatsLeft: 10 }]);
        expect(search.packages[1].upcomingDepartures).toEqual([]);
        expect(search.packages[0]).not.toHaveProperty('seatsLeft');
    });

    it('a failed departures read leaves that package without upcomingDepartures (nothing claimed)', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([DB_ROW]);
        h.toursService.listInventory.mockRejectedValue(new Error('db down'));
        const search = await h.run('search_packages', {});
        expect(search.packages[0]).not.toHaveProperty('upcomingDepartures');
    });

    it('with a date: the seats of that departure, no note', async () => {
        const h = executor();
        h.toursService.searchPackages.mockResolvedValue([{ ...DB_ROW, available_seats: 10 }]);
        const search = await h.run('search_packages', { date: '2026-12-15' });
        expect(search.packages[0].seatsLeft).toBe(10);
        expect(search.seatsNote).toBeUndefined();
    });

    it('get_package_details gives each departure with its seats', async () => {
        const h = executor();
        h.toursService.getPackage.mockResolvedValue(DB_ROW);
        h.toursService.listInventory.mockResolvedValue([{ departure_date: '2026-12-15', departure_time: '09:00', available_seats: 10 }]);
        const details = await h.run('get_package_details', { packageId: SPARK });
        expect(details.upcomingDepartures).toEqual([expect.objectContaining({ date: '2026-12-15', time: '09:00', seatsLeft: 10 })]);
    });
});

describe('through the Agent Test turn: travel, flag on, the production messages', () => {
    describe.each(CLASSIFIERS)('classifier %s', (_label, classifier, classifierOperation) => {
        it.each(PRODUCTION)('«%s» → search_packages then get_package_details for the Spark QA Tour; the reply gives 10 seats on 15 Dec 2026 09:00', async message => {
            const h = fixture(classifier);
            const { result, requiredReads } = await h.turn(message);
            expect(result.debug.runtimeError).toBeUndefined();
            const names = h.calls().map(c => c.name);
            expect(names).toEqual(expect.arrayContaining(['search_packages', 'get_package_details']));
            expect(names.indexOf('search_packages')).toBeLessThan(names.indexOf('get_package_details'));
            expect(h.calls().find(c => c.name === 'get_package_details')?.args).toEqual({ packageId: SPARK });
            // What the model answers from: the departure and its seats.
            const details = h.toolBodies().find((b: any) => b.id === SPARK && Array.isArray(b.upcomingDepartures));
            expect(details.upcomingDepartures[0]).toMatchObject({ date: '2026-12-15', time: '09:00', seatsLeft: 10 });
            expect(h.toolBodies().find((b: any) => Array.isArray(b.packages))?.packages.some((p: any) => p.seatsLeft === null)).toBe(false);
            expect(result.reply).toBe('10 seats left on the 15 Dec 2026 09:00 departure of the Spark QA Tour.');
            expect(result.reply).not.toMatch(/pas l'information|no specific number/);
            const metadata = requiredReads[0].metadata as any;
            expect(metadata).toMatchObject({ pilot: 'tours', operation: 'package_availability', source: 'lexical_cue', classifierOperation });
            expect(metadata.reads).toEqual(expect.arrayContaining([
                expect.objectContaining({ tool: 'search_packages', status: 'read' }),
                expect.objectContaining({ tool: 'get_package_details', status: 'read' }),
            ]));
        });
    });

    it('a confident package_info question (duration) still reads the details, as before', async () => {
        const h = fixture('{"operationKey":"package_info","confidence":0.93}');
        const { requiredReads } = await h.turn('combien de temps dure le Spark QA Tour ?');
        expect(h.calls().find(c => c.name === 'get_package_details')?.args).toEqual({ packageId: SPARK });
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'package_info' });
        expect((requiredReads[0].metadata as any).source).toBeUndefined();
    });
});
