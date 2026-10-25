import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import * as adapters from './agent-turn-adapters';
import { REQUIRED_READS_APPOINTMENTS_FLAG, REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_TOURS_FLAG } from '../throttle/feature-flags.service';

/**
 * F4300-08 through the turn (production QA 2026-10-25, Telegram QA tenants, image fe2edd65). The customer asked about their OWN
 * bookings and the agent said «you have none» after search_faqs alone:
 *   - hotel, requiredReads.properties on: «tenho alguma reserva no hotel?» → «você não tem nenhuma reserva», «j'ai une réservation
 *     chez vous ?» → «Vous n'avez actuellement aucune réservation», no list_my_property_bookings;
 *   - tours, requiredReads.tours on: «do I have any tour bookings?», «tenho alguma reserva de passeio?» → «none», no
 *     list_my_tour_bookings;
 *   - salon, no pilot flag: «tenho algum horário marcado?», «tengo citas agendadas?», «est-ce que j'ai un rendez-vous ?» → «no tengo
 *     registro», no list_customer_appointments.
 * With the pilot flag on, the own-bookings read runs before the model (`requiredReads.appointments`, new, for the salon). Without
 * any read, a «you have none» is not sent as a fact. «puedo reservar…» / «is the room available…» never read the own bookings.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const PROPERTY = { id: '11111111-1111-4111-8111-111111111111', name: 'Spark QA Hotel', nightPrice: 150000, currency: 'COP', minNights: 1, priceStatus: 'confirmed', maxGuests: 4 };

type Vertical = 'hotel' | 'tours' | 'salon' | 'dental';
const PROFILE: Record<Vertical, [string, string]> = {
    hotel: ['turismo', 'hotel'], tours: ['turismo', 'tours'], salon: ['moda_belleza', 'salon_belleza'], dental: ['salud', 'dental'],
};
const TOOLS: Record<Vertical, string[]> = {
    hotel: ['search_faqs', 'list_properties', 'check_property_availability', 'get_property_details', 'create_property_booking', 'cancel_property_booking', 'list_my_property_bookings'],
    tours: ['search_faqs', 'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'cancel_tour_booking', 'list_my_tour_bookings'],
    salon: ['search_faqs', 'list_services', 'check_availability', 'create_appointment', 'list_customer_appointments', 'get_appointment_details', 'cancel_appointment'],
    dental: ['search_faqs', 'list_services', 'check_availability', 'create_appointment', 'list_customer_appointments', 'get_appointment_details', 'cancel_appointment',
        'request_identity_code', 'verify_identity_code'],
};
const FLAG: Record<Vertical, string> = {
    hotel: REQUIRED_READS_PROPERTIES_FLAG, tours: REQUIRED_READS_TOURS_FLAG, salon: REQUIRED_READS_APPOINTMENTS_FLAG, dental: REQUIRED_READS_APPOINTMENTS_FLAG,
};
/** What production said with no booking read (one per language). */
const UNBACKED_NONE: Record<string, string> = {
    pt: 'Você não tem nenhuma reserva registrada no momento.',
    fr: "Vous n'avez actuellement aucune réservation.",
    en: "You don't have any bookings at the moment.",
    es: 'No tengo registro de citas agendadas a tu nombre.',
};
const UNCHECKED = /^(?:No pude revisar sus reservas|I could not check your bookings|Não consegui verificar suas reservas|Je n'ai pas pu vérifier vos réservations)/;
const VERIFY_FIRST = 'Para ver sus citas primero necesito verificar su identidad.';

function fixture(vertical: Vertical, classifier: string, options: { flag?: boolean; lang?: string; records?: any[] } = {}) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    const [industry, subType] = PROFILE[vertical];
    f.contract.subtypeProfileId = `${industry}/${subType}`;
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry, tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry, subType });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [FLAG[vertical]]: options.flag !== false } } });
    publishTools(f, TOOLS[vertical]);
    // Agent Test executes only its safe reads; the appointment records are a live-turn read. Stand in for the live turn here.
    // The live executor sees the options the turn passes (the session adapter would answer agent_test_read_only first).
    if (vertical === 'salon' || vertical === 'dental') {
        jest.spyOn(adapters, 'sessionCanExecute').mockReturnValue(true);
        jest.spyOn(adapters, 'sessionToolExecutor').mockImplementation(executor => executor);
    }
    const records = options.records ?? [];
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [] }),
        list_properties: () => ({ properties: [PROPERTY] }),
        get_property_details: args => ({ ...PROPERTY, id: args.propertyId, checkInTime: '15:00', checkOutTime: '11:00' }),
        check_property_availability: () => ({ available: true }),
        search_packages: () => ({ packages: [] }),
        list_services: () => ({ services: [] }),
        list_my_property_bookings: () => ({ bookings: records }),
        list_my_tour_bookings: () => ({ bookings: records }),
        // Dental: the central guard asks for a verified identity first and sends nothing (identityChallenge 'none').
        list_customer_appointments: () => vertical === 'dental'
            ? { error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false, nextStep: 'request_identity_code',
                message: 'Se requiere verificar la identidad antes de continuar. NO se envió ningún código.' }
            : { appointments: records },
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });
    // A stand-in model: answers from a booking read when it has one, otherwise does what production did.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => { try { return JSON.parse(m.content); } catch { return {}; } });
        if (bodies.some((b: any) => b?.needsVerification)) return { ...usage, content: VERIFY_FIRST };
        const list = bodies.find((b: any) => Array.isArray(b?.bookings) || Array.isArray(b?.appointments));
        if (list) {
            const rows = list.bookings ?? list.appointments;
            return { ...usage, content: rows.length ? `You have ${rows.length} booking(s): ${rows.map((r: any) => r.propertyName ?? r.packageName ?? r.service).join(', ')}.` : UNBACKED_NONE[options.lang ?? 'en'] };
        }
        return { ...usage, content: UNBACKED_NONE[options.lang ?? 'en'] };
    });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const calls = (): Array<{ name: string; options: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3], options: c[6] }));
    const executed = (): string[] => calls().map(c => c.name);
    return { f, turn, executed, calls };
}

afterEach(() => jest.restoreAllMocks());

describe('hotel, requiredReads.properties on: the production messages read the guest\'s bookings', () => {
    it.each([
        ['pt', 'tenho alguma reserva no hotel?'],
        ['fr', "j'ai une réservation chez vous ?"],
        ['en', 'do I have any reservations?'],
    ])('[%s] «%s» with the FAQ intent → list_my_property_bookings before the model, and «none» is what was read', async (lang, message) => {
        const h = fixture('hotel', '{"operationKey":"ask_question","confidence":0.9}', { lang });
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toContain('list_my_property_bookings');
        expect(h.executed()).not.toContain('list_properties');
        // A contact read: the read-only path, unchanged (only appointment records go through the identity guard).
        expect(h.calls().find(c => c.name === 'list_my_property_bookings')?.options?.identityChallenge).toBeUndefined();
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'properties', operation: 'view_my_stay_bookings', source: 'lexical_cue', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'list_my_property_bookings', status: 'read', rows: 0, complete: true, total: 0 })],
        });
        // Backed by the read: the absence goes out as the model said it.
        expect(result.reply).toBe(UNBACKED_NONE[lang]);
    });

    it('a guest with a booking is told about it, and the classifier saying «book_stay» does not hide it', async () => {
        const h = fixture('hotel', '{"operationKey":"book_stay","confidence":0.92}', { lang: 'pt', records: [{ id: 'b1', propertyName: 'Spark QA Hotel', status: 'confirmed' }] });
        const { result, requiredReads } = await h.turn('tenho alguma reserva no hotel?');
        expect(h.executed()).toContain('list_my_property_bookings');
        expect(h.executed()).not.toContain('create_property_booking');
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'view_my_stay_bookings', source: 'lexical_cue', classifierOperation: 'book_stay' });
        expect(result.reply).toBe('You have 1 booking(s): Spark QA Hotel.');
    });

    it.each(['puedo reservar una habitación?', 'is the room available on friday?', 'quero fazer uma reserva'])('«%s» never reads the guest\'s bookings', async message => {
        const h = fixture('hotel', '{"operationKey":"ask_question","confidence":0.9}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).not.toContain('list_my_property_bookings');
        for (const step of requiredReads) expect(step.metadata?.operation).not.toBe('view_my_stay_bookings');
    });
});

describe('tours, requiredReads.tours on: the production messages read the customer\'s tour bookings', () => {
    it.each([
        ['en', 'do I have any tour bookings?'],
        ['pt', 'tenho alguma reserva de passeio?'],
        ['es', 'tengo alguna reserva de tour?'],
    ])('[%s] «%s» → list_my_tour_bookings before the model', async (lang, message) => {
        const h = fixture('tours', '{"operationKey":"package_info","confidence":0.6}', { lang });
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).toContain('list_my_tour_bookings');
        expect(h.executed()).not.toContain('search_packages');
        expect(requiredReads[0].metadata).toMatchObject({ pilot: 'tours', operation: 'view_my_tour_bookings', source: 'lexical_cue' });
        // Spanish «reserva» already had an automatic read of the bookings (why production ES read them): reused, not repeated.
        expect(requiredReads[0].metadata?.reads).toEqual([expect.objectContaining({
            tool: 'list_my_tour_bookings', status: lang === 'es' ? 'already_read' : 'read' })]);
        expect(h.executed().filter(name => name === 'list_my_tour_bookings')).toHaveLength(1);
    });

    it.each(['quiero reservar el tour', 'can I book the Spark QA Tour?'])('«%s» never reads the customer\'s tour bookings', async message => {
        const h = fixture('tours', '{"operationKey":"ask_question","confidence":0.9}');
        await h.turn(message);
        expect(h.executed()).not.toContain('list_my_tour_bookings');
    });
});

describe('salon: requiredReads.appointments (new, off by default)', () => {
    it.each([
        ['pt', 'tenho algum horário marcado?'],
        ['es', 'tengo citas agendadas?'],
        ['fr', "est-ce que j'ai un rendez-vous ?"],
    ])('flag on [%s] «%s» → list_customer_appointments through the whole guard, no code sent by the read', async (lang, message) => {
        const h = fixture('salon', '{"operationKey":"ask_question","confidence":0.9}', { lang });
        const { requiredReads } = await h.turn(message);
        const read = h.calls().find(c => c.name === 'list_customer_appointments');
        expect(read).toBeDefined();
        expect(read!.options).toMatchObject({ identityChallenge: 'none' });
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'appointments', operation: 'view_my_appointments', source: 'lexical_cue', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'list_customer_appointments', status: 'read', complete: true })],
        });
    });

    it('flag on: «quiero agendar una cita» does not read the customer\'s appointments', async () => {
        const h = fixture('salon', '{"operationKey":"book_appointment","confidence":0.9}');
        await h.turn('quiero agendar una cita');
        expect(h.executed()).not.toContain('list_customer_appointments');
    });

    it.each([
        ['pt', 'tenho algum horário marcado?'],
        ['es', 'tengo citas agendadas?'],
        ['fr', "est-ce que j'ai un rendez-vous ?"],
    ])('flag off [%s] «%s»: no read ran, so «you have none» is not sent as a fact', async (lang, message) => {
        const h = fixture('salon', '{"operationKey":"ask_question","confidence":0.9}', { flag: false, lang });
        const { result, requiredReads } = await h.turn(message);
        expect(requiredReads).toEqual([]);
        expect(h.executed()).not.toContain('list_customer_appointments');
        expect(result.reply).toMatch(UNCHECKED);
        expect(result.reply).not.toBe(UNBACKED_NONE[lang]);
    });
});

describe('dental: the identity verification stays in front of the appointments', () => {
    it('unverified chat, flag on: the verification step reaches the model, nothing is read, the existing code request is unchanged', async () => {
        // Without the flag: the existing flow (the transition engine) reads with no code sent, then requests the code itself.
        const before = fixture('dental', '{"operationKey":"ask_question","confidence":0.9}', { lang: 'es', flag: false });
        await before.turn('¿tengo alguna cita?');
        const codesWithoutFlag = before.executed().filter(name => name === 'request_identity_code').length;
        jest.restoreAllMocks();

        const h = fixture('dental', '{"operationKey":"ask_question","confidence":0.9}', { lang: 'es' });
        const { result, requiredReads } = await h.turn('¿tengo alguna cita?');
        // Every appointment read of the turn, the required one included, asks the guard to send nothing.
        const reads = h.calls().filter(c => c.name === 'list_customer_appointments');
        expect(reads.length).toBeGreaterThan(0);
        for (const read of reads) expect(read.options).toMatchObject({ identityChallenge: 'none' });
        // The required read adds no code request: the verification flow is the one that already ran without it.
        expect(h.executed().filter(name => name === 'request_identity_code')).toHaveLength(codesWithoutFlag);
        expect(requiredReads[0].metadata).toMatchObject({
            operation: 'view_my_appointments', outcome: 'identity_required',
            reads: [expect.objectContaining({ tool: 'list_customer_appointments', status: 'identity_required' })],
        });
        expect(result.reply).toBe(VERIFY_FIRST);
    });
});
