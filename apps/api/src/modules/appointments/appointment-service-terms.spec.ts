import { appointmentServiceTerms, appointmentServiceTermsHash, assertAppointmentServiceTerms } from './appointment-service-terms';

const row = { id: '11111111-1111-4111-8111-111111111111', name: 'Consulta', price: '100.00', currency: 'COP',
    duration_minutes: 30, duration_type: 'fixed', payment_policy: 'deposit', deposit_percent: 25 };

describe('canonical service terms', () => {
    it('normalizes database numeric representations without rounding away a price change', () => {
        const terms = appointmentServiceTerms(row);
        expect(assertAppointmentServiceTerms(terms, { ...row, price: 100, deposit_percent: '25.000' })).toEqual(terms);
        expect(() => assertAppointmentServiceTerms(terms, { ...row, price: '100.01' })).toThrow();
        expect(terms).toMatchObject({ price: 100, requiresPayment: true, amountDue: 25, paymentPolicy: 'deposit' });
    });
    it('binds exact service names, currency and case-sensitive URLs', () => {
        const terms = appointmentServiceTerms({ ...row, meeting_link: 'https://example.test/MeetingA' });
        const original = appointmentServiceTermsHash(terms);
        for (const changed of [{ ...terms, name: 'consulta' }, { ...terms, currency: 'USD' }, appointmentServiceTerms({ ...row, meeting_link: 'https://example.test/meetinga' })]) {
            expect(appointmentServiceTermsHash(changed)).not.toBe(original);
        }
        expect(appointmentServiceTermsHash(Object.fromEntries(Object.entries(terms).reverse()))).toBe(original);
    });
    it.each([null, {}, { price: 100 }, { ...appointmentServiceTerms(row), price: NaN }, { ...appointmentServiceTerms(row), amountDue: Infinity }])('rejects incomplete or nonfinite terms', value => {
        expect(appointmentServiceTermsHash(value)).toBeNull();
        expect(() => assertAppointmentServiceTerms(value, row)).toThrow();
    });
});
