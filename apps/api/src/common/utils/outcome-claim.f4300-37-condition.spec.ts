import { claimsCompletedAction } from './outcome-claim.util';

/**
 * F4300-37 (production QA 29-oct, POST288-MEET-EN): the agency's meeting-point FAQ said in English — «We will send you the exact
 * meeting point once the booking is confirmed» — was read as a booking claimed done and replaced by «I cannot treat that as done».
 */
describe('F4300-37 · a confirmation named as a condition is not a claim', () => {
    it.each([
        'We will send you the exact meeting point once the booking is confirmed.',
        'You will receive the voucher when your reservation is confirmed.',
        'We share the pickup time as soon as the booking is confirmed.',
        'Te enviaré el punto exacto una vez que la reserva esté confirmada.',
        'Você receberá o ponto exato quando a reserva for confirmada.',
    ])('not a claim: %s', reply => {
        expect(claimsCompletedAction(reply)).toBe(false);
    });

    it.each([
        'Your booking is confirmed.',
        'Once again, your booking is confirmed.',
        'Great news: your reservation is confirmed for tomorrow.',
    ])('still a claim: %s', reply => {
        expect(claimsCompletedAction(reply)).toBe(true);
    });
});
