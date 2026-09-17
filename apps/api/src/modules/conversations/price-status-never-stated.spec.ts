import { BookingEngineService, BookingState } from './booking-engine.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { appointmentServiceTerms, appointmentTermsReviewResult } from '../appointments/appointment-service-terms';
import { projectAvailableService, servicePriceNote, servicePriceStatus } from '../appointments/service-price-status';

/**
 * D10 (sep-2026): a price the business never confirmed is not a price. The
 * recipe seeds services with example amounts so the owner has something to
 * start from; until she confirms them, neither the deterministic booking
 * engine nor the LLM may state a number for that service.
 */
const CONFIRMED = { id: 'a', name: 'Consulta', durationMinutes: 30, price: 80000, currency: 'COP', priceStatus: 'confirmed' as const };
const EXAMPLE = { id: 'b', name: 'Corte y estilo', durationMinutes: 45, price: 40000, currency: 'COP', priceStatus: 'example' as const };
const QUOTE = { id: 'c', name: 'Evento privado', durationMinutes: 120, price: 0, currency: 'COP', priceStatus: 'quote' as const };
const EXAMPLE_ROW = { id: 'b', name: 'Corte y estilo', price: 40000, currency: 'COP', duration_minutes: 45, payment_policy: 'none', price_status: 'example' };

function engine(result: any = {}) {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    const executor = { execute: jest.fn().mockResolvedValue(result) };
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    return new BookingEngineService(prisma as any, redis as any, executor as any) as any;
}

describe('the booking engine lists and confirms without inventing a number', () => {
    it.each(['es', 'en', 'pt', 'fr'])('the service list states only the confirmed price (%s)', lang => {
        const state: BookingState = { step: 'select_service', services: [CONFIRMED, EXAMPLE, QUOTE] } as any;
        const text: string = engine().showServices(state, lang).text;
        expect(text).toContain('80.000 COP');
        expect(text).not.toContain('40.000');
        expect(text).not.toContain('40000');
        expect(text).toMatch(/por confirmar|to be confirmed|a confirmar|à confirmer/i);
        expect(text).toMatch(/se cotiza|case by case|orçamento|devis/i);
    });
    it.each(['es', 'en', 'pt', 'fr'])('the confirmation summary says the price is pending, not a number (%s)', lang => {
        const state: BookingState = { step: 'confirm', serviceId: 'b', serviceName: 'Corte y estilo', date: '2027-01-01', time: '10:00', customerName: 'Ana', customerEmail: 'ana@example.test', services: [EXAMPLE] } as any;
        const proposal = engine().collectMissingInfo(state, lang);
        expect(proposal.text).not.toContain('40000');
        expect(proposal.text).not.toMatch(/\b0 COP\b/);
        expect(proposal.text).toMatch(/por confirmar|to be confirmed|a confirmar|à confirmer/i);
    });
    it('a confirmed price still reads as before', () => {
        const state: BookingState = { step: 'confirm', serviceId: 'a', serviceName: 'Consulta', date: '2027-01-01', time: '10:00', customerName: 'Ana', customerEmail: 'ana@example.test', services: [CONFIRMED] } as any;
        expect(engine().collectMissingInfo(state, 'es').text).toContain('80000 COP');
    });
    it('a change of terms mid-flow re-proposes "por confirmar", never "Precio: 0 COP"', async () => {
        // The executor answers appointment_terms_changed with the fresh terms of
        // the example row; the engine adopts that service object and re-issues
        // the proposal from it.
        const h = engine(appointmentTermsReviewResult(appointmentServiceTerms(EXAMPLE_ROW)));
        const state: BookingState = { step: 'confirm', serviceId: 'b', serviceName: 'Corte y estilo', date: '2027-01-01', time: '10:00', customerName: 'Ana', customerEmail: 'ana@example.test', services: [EXAMPLE] } as any;
        h.collectMissingInfo(state, 'es');
        const outcome = await h.createBooking('tenant_test', 'tenant', 'contact', state, 'es', 'conversation', authorityFor('create_appointment'), 'confirm_yes');
        expect(outcome.text).toContain('por confirmar');
        expect(outcome.text).not.toMatch(/\b0 COP\b/);
        expect(outcome.text).not.toContain('40000');
        expect(outcome.state.services.find((s: any) => s.id === 'b')).toMatchObject({ price: null, priceStatus: 'example' });
    });
});

describe('the terms objects never carry an unconfirmed number', () => {
    it('freezes 0 with the status beside it, and the review result mirrors list_services', () => {
        const terms = appointmentServiceTerms(EXAMPLE_ROW);
        expect(terms).toMatchObject({ price: 0, priceStatus: 'example', requiresPayment: false, amountDue: null });
        const review = appointmentTermsReviewResult(terms).service as any;
        expect(review).toMatchObject({ price: null, priceStatus: 'example' });
        expect(review.priceNote).toMatch(/no digas ningún monto/);
        const confirmed = appointmentTermsReviewResult(appointmentServiceTerms({ ...EXAMPLE_ROW, price_status: 'confirmed' })).service as any;
        expect(confirmed).toMatchObject({ price: 40000, priceStatus: 'confirmed' });
        expect(confirmed.priceNote).toBeUndefined();
        expect(appointmentServiceTerms({ ...EXAMPLE_ROW, price_status: 'confirmed' })).not.toHaveProperty('priceStatus');
    });
});

describe('list_services gives the model words instead of an amount', () => {
    function build(rows: any[]) {
        const service = Object.create(AIToolExecutorService.prototype);
        service.prisma = { $queryRawUnsafe: jest.fn(async () => rows) };
        return service;
    }
    const base = { description: null, duration_minutes: 45, buffer_minutes: 0, currency: 'COP', duration_type: 'fixed', duration_minutes_max: null, payment_policy: 'none', deposit_percent: null, deposit_amount: null };
    it('an example price comes back as null with the instruction to say it will be confirmed', async () => {
        const out = await build([{ ...base, id: 's1', name: 'Corte', price: '40000', price_status: 'example' }]).listServices('tenant_x');
        expect(out.services[0]).toMatchObject({ price: null, priceStatus: 'example', requiresPaymentToConfirm: false, amountDueToConfirm: null });
        expect(out.services[0].priceNote).toMatch(/no digas ningún monto/);
        expect(JSON.stringify(out)).not.toContain('40000');
    });
    it('a quote-only service says so', async () => {
        const out = await build([{ ...base, id: 's2', name: 'Evento', price: '0', price_status: 'quote' }]).listServices('tenant_x');
        expect(out.services[0]).toMatchObject({ price: null, priceStatus: 'quote' });
        expect(out.services[0].priceNote).toMatch(/cotiza/);
    });
    it('a confirmed price, and a legacy row without the column, keep the amount and the payment note', async () => {
        const out = await build([
            { ...base, id: 's3', name: 'Consulta', price: '80000', price_status: 'confirmed', payment_policy: 'deposit', deposit_percent: 50 },
            { ...base, id: 's4', name: 'Control', price: '50000' },
        ]).listServices('tenant_x');
        expect(out.services[0]).toMatchObject({ price: 80000, priceStatus: 'confirmed', requiresPaymentToConfirm: true, amountDueToConfirm: 40000 });
        expect(out.services[0].priceNote).toBeUndefined();
        expect(out.services[1]).toMatchObject({ price: 50000, priceStatus: 'confirmed' });
    });
    it('the projection helper is the single reading of the column', () => {
        expect(servicePriceStatus({ price_status: 'example' })).toBe('example');
        expect(servicePriceStatus({ price_status: 'quote' })).toBe('quote');
        expect(servicePriceStatus({ price_status: null })).toBe('confirmed');
        expect(servicePriceStatus(undefined)).toBe('confirmed');
        expect(servicePriceStatus({ price_status: 'garbage' })).toBe('confirmed');
        expect(servicePriceNote('confirmed')).toBeUndefined();
    });
});

describe('the prompt marks the service instead of pricing it', () => {
    const turn = (services: any[]) => ({
        language: 'es', timezone: 'America/Bogota', now: '2026-09-17T12:00:00.000Z',
        upcomingDays: [], businessHoursStatus: 'open', availableServices: services,
    }) as any;
    it('the turn projection drops the number of an unconfirmed service and keeps a confirmed one', () => {
        expect(projectAvailableService(EXAMPLE)).toEqual({ id: 'b', name: 'Corte y estilo', durationMinutes: 45, price: undefined, priceStatus: 'example', currency: 'COP' });
        expect(projectAvailableService(QUOTE)).toMatchObject({ price: undefined, priceStatus: 'quote' });
        expect(projectAvailableService(CONFIRMED)).toMatchObject({ price: 80000, priceStatus: 'confirmed' });
        expect(projectAvailableService({ ...CONFIRMED, priceStatus: undefined } as any)).toMatchObject({ price: 80000 });
    });
    it('the real assembler emits price_status and no price attribute, and tells the model what that means', () => {
        const personaService = { buildSystemPrompt: jest.fn(() => '<persona><name>Test</name></persona>') };
        const assembler = new PromptAssemblerService(personaService as any);
        const prompt = assembler.assemble({} as any, turn([projectAvailableService(EXAMPLE), projectAvailableService(CONFIRMED)]));
        const example = prompt.split('\n').find(line => line.includes('id="b"'))!;
        const confirmed = prompt.split('\n').find(line => line.includes('id="a"'))!;
        expect(example).toContain('price_status="example"');
        expect(example).not.toContain('price=');
        expect(prompt).not.toContain('40000');
        expect(confirmed).toContain('price="80000"');
        expect(confirmed).not.toContain('price_status');
        expect(prompt).toContain('NO NUMBER WITHOUT A CONFIRMED PRICE');
    });
});
