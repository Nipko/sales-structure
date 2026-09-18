import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The header of `whatsapp-funding-readiness.ts` is where the next person reads
 * what Meta's 1-October change means for an account with no card. It used to
 * say such an account "can exhaust its monthly service allowance; paid
 * deliveries then require funding" — a free runway Meta never documented. What
 * Meta says (docs/whatsapp-meta-pricing-2026-10.md §2 and §6) is a date: with
 * no payment method on the WhatsApp Business account by 30-Sep-2026, service
 * messages stop being delivered on 1-Oct-2026. Behaviour is not touched here;
 * this pins the sentence so the promise does not come back in a rewrite.
 */
const source = readFileSync(join(__dirname, 'whatsapp-funding-readiness.ts'), 'utf8');
const header = source
    .slice(0, source.indexOf('*/'))
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\/?\*+\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

describe('the funding readiness header says what Meta says', () => {
    it('states the stop by date for an account with no payment method', () => {
        expect(header).toContain('no payment method on file by 30 September 2026 stops having its service messages '
            + 'delivered as of 1 October 2026');
    });

    it('never promises that the free allowance keeps flowing without a payment method', () => {
        expect(header).not.toMatch(/exhaust its monthly service allowance/i);
        expect(header).not.toMatch(/paid deliveries then require funding/i);
        expect(header).toContain('does NOT say that the 1,000 free service deliveries per number and month keep flowing without one');
    });
});
