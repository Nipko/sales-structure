import { getOperation, operationsForPublishedTools } from '@parallext/shared';
import { isOwnBookingsQuestion, lexicalRequiredReadsOperation, ownBookingsOperation } from './operation-lexical-cues';
import {
    requiredReadsGate, requiredReadsOperationInPilot, requiredReadsPilotForProfile, requiredReadsPlan, runRequiredReads, withListEvidence,
} from './required-reads.runner';
import type { OperationShadowVerdict } from './operation-classifier.service';
import { claimsNoOwnBookings, ownBookingsReadBacked } from '../../../common/utils/outcome-claim.util';

/**
 * F4300-08 (production QA 2026-10-25, Telegram QA tenants, image fe2edd65). The customer asked about their OWN bookings and the
 * agent answered «you have none» after search_faqs alone, with no booking read (right only because the QA customer has none):
 *   - hotel, requiredReads.properties on: «tenho alguma reserva no hotel?», «j'ai une réservation chez vous ?»;
 *   - tours, requiredReads.tours on: «do I have any tour bookings?», «tenho alguma reserva de passeio?»;
 *   - salon, no pilot flag: «tenho algum horário marcado?», «tengo citas agendadas?», «est-ce que j'ai un rendez-vous ?».
 * «Do I have a booking?» now names the pilot's own-bookings read; «can I book?» and «is it available?» never do.
 */
const op = (key: string) => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`missing operation ${key}`);
    return operation;
};
const verdict = (operationKey: string, confidence: number, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback, candidates: [operationKey, 'ask_question'], latencyMs: 5 });

const HOTEL_TOOLS = ['search_faqs', 'list_properties', 'check_property_availability', 'get_property_details', 'create_property_booking', 'list_my_property_bookings'];
const TOUR_TOOLS = ['search_faqs', 'search_packages', 'get_package_details', 'check_package_availability', 'create_tour_booking', 'list_my_tour_bookings'];
const SALON_TOOLS = ['search_faqs', 'list_services', 'check_availability', 'create_appointment', 'list_customer_appointments', 'get_appointment_details', 'cancel_appointment'];
const REAL_ESTATE_TOOLS = ['search_faqs', 'search_listings', 'get_listing_details', 'check_availability', 'create_appointment', 'list_customer_appointments'];

/** The production messages first, then their es/en/pt/fr equivalents. */
const HOTEL_OWN = [
    'tenho alguma reserva no hotel?', "j'ai une réservation chez vous ?", 'do I have any reservations?',
    '¿tengo alguna reserva?', 'tengo reserva para mañana?', '¿cuál es el estado de mi reserva?', 'mis reservas',
    'tenho reserva?', 'minha reserva está confirmada?', 'ai-je une réservation ?', 'ma réservation est-elle confirmée ?',
    'do I have a booking?', 'my booking', 'is there a reservation under my name?',
];
const TOUR_OWN = [
    'do I have any tour bookings?', 'tenho alguma reserva de passeio?', 'tengo alguna reserva de tour?',
    'when does my booking start?', 'est-ce que j\'ai une réservation pour le tour ?', 'meus agendamentos',
];
const SALON_OWN = [
    'tenho algum horário marcado?', 'tengo citas agendadas?', "est-ce que j'ai un rendez-vous ?", 'do I have any appointments booked?',
    '¿tengo cita?', '¿a qué hora es mi cita?', 'mis citas', 'tengo turno?', 'tenho consulta marcada?', 'qual é o meu horário?',
    'mes rendez-vous', 'have I got an appointment?', 'my appointment',
];
/** Booking, availability, a change to a booking, or another topic: never the customer's own bookings. */
const NOT_OWN = [
    'puedo reservar una habitación?', 'quiero reservar el tour', 'quiero hacer una reserva', 'is the room available?',
    'is the room available on friday?', 'can I book an appointment?', 'I want to book a room', 'quero fazer uma reserva',
    'posso reservar para sábado?', 'je voudrais réserver une chambre', 'puis-je prendre rendez-vous ?', 'how do I book?',
    'do I have to make a reservation?', '¿tengo que reservar con anticipación?', 'hay reservas disponibles para el sábado?',
    'tengo una consulta sobre precios', 'quiero cancelar mi cita', 'cancel my booking', 'quiero cambiar mi reserva',
    'reprogramar mi cita del jueves', 'quero pagar minha reserva', 'what time do you open?', 'hola', 'thanks!',
    '¿cuál es la política de cancelación?', 'tengo turno disponible el lunes?',
];

describe('F4300-08: «do I have a booking?» is the customer\'s own bookings (es/en/pt/fr)', () => {
    it.each([...HOTEL_OWN, ...TOUR_OWN, ...SALON_OWN])('«%s» is an own-bookings question', text => {
        expect(isOwnBookingsQuestion(text)).toBe(true);
    });

    it.each(NOT_OWN)('«%s» is not', text => {
        expect(isOwnBookingsQuestion(text)).toBe(false);
        for (const [pilot, tools] of [['properties', HOTEL_TOOLS], ['tours', TOUR_TOOLS], ['appointments', SALON_TOOLS]] as const) {
            expect(ownBookingsOperation(text, pilot, tools)).toBeNull();
        }
    });

    it.each(HOTEL_OWN)('hotel «%s» → view_my_stay_bookings (list_my_property_bookings)', text => {
        expect(lexicalRequiredReadsOperation(text, 'properties', HOTEL_TOOLS)).toBe('view_my_stay_bookings');
    });

    it.each(TOUR_OWN)('tours «%s» → view_my_tour_bookings (list_my_tour_bookings)', text => {
        expect(lexicalRequiredReadsOperation(text, 'tours', TOUR_TOOLS)).toBe('view_my_tour_bookings');
    });

    it.each(SALON_OWN)('salon «%s» → view_my_appointments (list_customer_appointments)', text => {
        expect(lexicalRequiredReadsOperation(text, 'appointments', SALON_TOOLS)).toBe('view_my_appointments');
    });

    it('real estate: the customer\'s own visits are appointments', () => {
        expect(lexicalRequiredReadsOperation('¿tengo alguna visita agendada?', 'listings', REAL_ESTATE_TOOLS)).toBe('view_my_appointments');
        expect(lexicalRequiredReadsOperation('quiero agendar una visita', 'listings', REAL_ESTATE_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('how much is the apartment?', 'listings', REAL_ESTATE_TOOLS)).toBe('listing_info');
    });

    it('only when the turn publishes the own-bookings read, and the check-in time stays the property\'s', () => {
        expect(lexicalRequiredReadsOperation('tenho alguma reserva no hotel?', 'properties', ['search_faqs', 'list_properties'])).toBeNull();
        expect(lexicalRequiredReadsOperation('do I have any tour bookings?', 'tours', ['search_faqs', 'search_packages'])).toBeNull();
        expect(lexicalRequiredReadsOperation('tengo citas agendadas?', 'appointments', ['search_faqs', 'list_services'])).toBeNull();
        // #208: «what time is check-in for my reservation?» is the property's check-in time.
        expect(lexicalRequiredReadsOperation('what time is check-in for my reservation?', 'properties', HOTEL_TOOLS)).toBe('property_info');
        // Other pilots' cues are unchanged.
        expect(lexicalRequiredReadsOperation('how much is the Spark dish?', 'restaurants', ['get_menu'])).toBe('menu_info');
        expect(lexicalRequiredReadsOperation('is the room available on friday?', 'properties', HOTEL_TOOLS)).toBe('property_info');
    });
});

describe('the catalogue and the pilots', () => {
    it('declares the own-bookings reads of the hotel and the tours', () => {
        expect(op('view_my_stay_bookings').requiredReads.map(r => r.tool)).toEqual(['list_my_property_bookings']);
        expect(op('view_my_tour_bookings').requiredReads.map(r => r.tool)).toEqual(['list_my_tour_bookings']);
        expect(op('view_my_appointments').requiredReads.map(r => r.tool)).toEqual(['list_customer_appointments']);
        for (const key of ['view_my_stay_bookings', 'view_my_tour_bookings']) {
            expect(op(key)).toMatchObject({ commits: false, writers: [], factKinds: ['record_list', 'record_status'] });
        }
        expect(op('view_my_stay_bookings').profiles).toEqual(expect.arrayContaining(['turismo/hotel', 'turismo/alquiler_vacacional']));
        expect(op('view_my_tour_bookings').profiles).toEqual(expect.arrayContaining(['turismo/tours', 'turismo/agencia_viajes']));
        expect(operationsForPublishedTools(HOTEL_TOOLS).map(o => o.key)).toContain('view_my_stay_bookings');
    });

    it('the appointments pilot is the appointment businesses; earlier pilots keep their profiles', () => {
        for (const profile of ['moda_belleza/salon_belleza', 'salud/dental', 'gimnasios/yoga_pilates']) expect(requiredReadsPilotForProfile(profile)).toBe('appointments');
        expect(requiredReadsPilotForProfile('turismo/hotel')).toBe('properties');
        expect(requiredReadsPilotForProfile('turismo/tours')).toBe('tours');
        expect(requiredReadsPilotForProfile('inmobiliaria/venta')).toBe('listings');
        expect(requiredReadsPilotForProfile('restaurantes/casual_dining')).toBe('restaurants');
        expect(requiredReadsPilotForProfile('retail/hogar')).toBe('catalog');
        expect(requiredReadsOperationInPilot('view_my_appointments', 'appointments')).toBe(true);
        expect(requiredReadsOperationInPilot('view_my_appointments', 'listings')).toBe(true);
        expect(requiredReadsOperationInPilot('view_my_appointments', 'properties')).toBe(false);
        expect(requiredReadsOperationInPilot('book_appointment', 'appointments')).toBe(false);
    });
});

describe('the gate', () => {
    it('the cue runs over the FAQ intent, a fallback or a low verdict', () => {
        for (const v of [verdict('ask_question', 0.9), verdict('none', 0.9, 'none'), verdict('view_my_stay_bookings', 0.5), null]) {
            const gate = requiredReadsGate(v, 'properties', 'view_my_stay_bookings');
            expect(gate.run && gate.operation.key).toBe('view_my_stay_bookings');
            expect(gate.run && gate.source).toBe('lexical_cue');
        }
    });

    it('«do I have a booking?» read by the classifier as booking or as the catalogue: the own bookings are read', () => {
        for (const [pilot, classified, own] of [
            ['properties', 'book_stay', 'view_my_stay_bookings'], ['properties', 'property_info', 'view_my_stay_bookings'],
            ['tours', 'book_tour', 'view_my_tour_bookings'], ['tours', 'package_availability', 'view_my_tour_bookings'],
            ['appointments', 'book_appointment', 'view_my_appointments'], ['appointments', 'service_info', 'view_my_appointments'],
        ] as const) {
            const gate = requiredReadsGate(verdict(classified, 0.95), pilot, own);
            expect({ classified, key: gate.run && gate.operation.key }).toEqual({ classified, key: own });
        }
    });

    it('a confident other business operation keeps the turn; a cue of another pilot does nothing', () => {
        expect(requiredReadsGate(verdict('cancel_appointment', 0.95), 'appointments', 'view_my_appointments')).toEqual({ run: false, reason: 'not_pilot_operation' });
        expect(requiredReadsGate(verdict('none', 0.9, 'none'), 'tours', 'view_my_stay_bookings')).toEqual({ run: false, reason: 'fallback:none' });
        // The classifier's own confident verdict runs with no cue.
        const classified = requiredReadsGate(verdict('view_my_appointments', 0.9), 'appointments', null);
        expect(classified.run && classified.operation.key).toBe('view_my_appointments');
        expect(classified.run && classified.source).toBeUndefined();
    });
});

describe('the reads', () => {
    it('stay dates in the message add no availability read to the guest\'s own bookings', () => {
        const plan = requiredReadsPlan(op('view_my_stay_bookings'), { check_in: '2026-12-03', check_out: '2026-12-05' }, 'tengo una reserva del 3 al 5 de diciembre?');
        expect(plan.map(r => r.tool)).toEqual(['list_my_property_bookings']);
        expect(requiredReadsPlan(op('view_my_tour_bookings'), { starts_at: '2026-12-15' }).map(r => r.tool)).toEqual(['list_my_tour_bookings']);
    });

    it('an empty booking list is complete: «none» is what was read, not `hasMore`', () => {
        for (const [name, container] of [['list_my_property_bookings', 'bookings'], ['list_my_tour_bookings', 'bookings'], ['list_customer_appointments', 'appointments']]) {
            const evidence = withListEvidence(name, {}, { [container]: [] });
            expect(evidence).toMatchObject({ rows: 0, complete: true, total: 0, result: { hasMore: false, complete: true, total: 0 } });
        }
        // Ten rows (the reader's cap) may not be all of them.
        expect(withListEvidence('list_my_property_bookings', {}, { bookings: Array.from({ length: 10 }, (_, i) => ({ id: `b${i}` })) })).toMatchObject({ complete: false });
    });

    it('a guest with bookings: list_my_property_bookings runs and reaches the model', async () => {
        const execute = jest.fn(async () => ({ bookings: [{ id: 'b1', propertyName: 'Spark QA Hotel', checkIn: '2026-12-03', status: 'confirmed' }] }));
        const run = await runRequiredReads(op('view_my_stay_bookings'), { execute, publishedTools: HOTEL_TOOLS, alreadyRead: [], projectedContexts: [] });
        expect(execute).toHaveBeenCalledWith('list_my_property_bookings', {});
        expect(run).toMatchObject({ outcome: 'read', reads: [{ tool: 'list_my_property_bookings', status: 'read', rows: 1, complete: true }] });
    });

    it('dental, unverified chat: the guard\'s verification step reaches the model as it is, nothing read, nothing sent', async () => {
        const refusal = {
            error: 'identity_verification_required', needsVerification: true, challengeSent: false, codeSent: false, nextStep: 'request_identity_code',
            message: 'Se requiere verificar la identidad antes de continuar. NO se envió ningún código.',
        };
        const execute = jest.fn(async () => refusal);
        const run = await runRequiredReads(op('view_my_appointments'), { execute, publishedTools: [...SALON_TOOLS, 'request_identity_code', 'verify_identity_code'], alreadyRead: [], projectedContexts: [] });
        expect(execute.mock.calls.map((c: any[]) => c[0])).toEqual(['list_customer_appointments']);
        expect(run.outcome).toBe('identity_required');
        expect(run.reads).toEqual([expect.objectContaining({ tool: 'list_customer_appointments', status: 'identity_required' })]);
        expect(run.results[0].result).toMatchObject({ needsVerification: true, nextStep: 'request_identity_code', codeSent: false, requiredRead: true });
        expect(JSON.stringify(run.results)).not.toMatch(/No pude consultar/);
    });

    it('a read the execution may not run (Agent Test read-only) is left to the model, not said as a failure', async () => {
        const execute = jest.fn(async () => ({ error: 'read_only_tool_blocked', message: 'La herramienta no está permitida en ejecución de solo lectura.' }));
        const run = await runRequiredReads(op('view_my_appointments'), { execute, publishedTools: SALON_TOOLS, alreadyRead: [], projectedContexts: [] });
        expect(run).toMatchObject({ outcome: 'nothing_to_run', results: [], reads: [expect.objectContaining({ status: 'unpublished' })] });
    });
});

describe('the reply: «you have no bookings» needs a booking read this turn', () => {
    it.each([
        'Você não tem nenhuma reserva registrada no momento.',
        "Vous n'avez actuellement aucune réservation chez nous.",
        "You don't have any tour bookings at the moment.",
        'You have no reservations.',
        'No tienes citas agendadas por ahora.',
        'No tengo registro de citas a tu nombre.',
        'Não encontrei nenhum agendamento no seu nome.',
        "Il n'y a aucun rendez-vous à votre nom.",
        "I couldn't find any appointments under your name.",
        'No hay ninguna reserva a su nombre.',
    ])('«%s» says the customer has none', reply => {
        expect(claimsNoOwnBookings(reply)).toBe(true);
    });

    it.each([
        'Tiene una reserva en Spark QA Hotel del 3 al 5 de diciembre.',
        'Puede reservar la habitación desde 150.000 COP por noche.',
        'Sí, tenemos disponibilidad para el sábado.',
        'Your appointment is on Friday at 10:00.',
        'Para revisar sus citas necesito verificar su identidad. ¿Le envío un código?',
        '',
    ])('«%s» does not', reply => {
        expect(claimsNoOwnBookings(reply)).toBe(false);
    });

    it('a booking read that answered backs it; a refusal, a failure or another read does not', () => {
        expect(ownBookingsReadBacked([{ name: 'list_my_property_bookings', result: { bookings: [], complete: true } }])).toBe(true);
        expect(ownBookingsReadBacked([{ name: 'list_customer_appointments', result: { appointments: [] } }])).toBe(true);
        expect(ownBookingsReadBacked([{ name: 'list_customer_appointments', result: { error: 'identity_verification_required', needsVerification: true, message: 'x' } }])).toBe(false);
        expect(ownBookingsReadBacked([{ name: 'list_my_tour_bookings', result: { success: false, error: 'read_failed' } }])).toBe(false);
        expect(ownBookingsReadBacked([{ name: 'search_faqs', result: { faqs: [] } }])).toBe(false);
        expect(ownBookingsReadBacked(undefined)).toBe(false);
    });
});
