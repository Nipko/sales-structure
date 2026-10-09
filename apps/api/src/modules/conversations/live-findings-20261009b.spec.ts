import { PromptAssemblerService } from './prompt-assembler.service';
import { ActiveOperationsContextService } from './active-operations-context.service';
import { servicePriceNote } from '../appointments/service-price-status';

/**
 * Live regression 2026-10-09 after PR #82 (Salón QA Citas, Telegram) — the parts of it that are wording and context, not flow:
 *  · «¿dónde queda el local?» answered «ubicado en Bogotá. ¿Desea que le confirme la dirección exacta?» when only the CITY is on file;
 *  · «el precio no está confirmado… ¿le pido a alguien del equipo que lo confirme y termine de reservar?» at the end of a booking;
 *  · «Usted no tiene citas próximas» next to a list that showed the appointment of this morning.
 */
describe('rule 13f: where the business is, when only the city is configured', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
    const base: any = { language: 'es', timezone: 'America/Bogota', now: '2026-10-09T15:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' };

    it('the city alone is rendered as the city, with no address', () => {
        const prompt = assembler.assemble({ persona: {} } as any, { ...base, business: { companyName: 'Salón QA Citas', city: 'Bogotá' } });
        expect(prompt).toContain('<city>Bogotá</city>');
        expect(prompt).not.toContain('<address>');
    });

    it('says to give the city AND that the exact address is not on file, and never to ask whether to confirm the address', () => {
        const prompt = assembler.assemble({ persona: {} } as any, { ...base, business: { companyName: 'Salón QA Citas', city: 'Bogotá' } });
        const rule = prompt.slice(prompt.indexOf('13f. WHERE THE BUSINESS IS'), prompt.indexOf('14.', prompt.indexOf('13f. WHERE THE BUSINESS IS')));
        expect(rule).toContain('When only &lt;city&gt; is present, give the city AND say in the same answer that the exact address is not on file');
        expect(rule).toContain('a city alone is never presented as the address');
        expect(rule).toContain('"do you want me to confirm the exact address?"');
        // (what it had before stays: with an address the answer opens with it; with none, nothing is invented)
        expect(rule).toContain('answer in the FIRST sentence with &lt;turn&gt;&lt;business&gt;&lt;address&gt;');
        expect(rule).toContain('When &lt;address&gt; is absent, say plainly that you do not have the address on file');
    });
});

describe('an unconfirmed price is never a condition for booking', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '<persona/>' } as any);
    const base: any = { language: 'es', timezone: 'America/Bogota', now: '2026-10-09T15:00:00.000Z', upcomingDays: [], businessHoursStatus: 'open' };

    it('rule 22a: the booking goes ahead with the price pending; the person is for the customer who asked the price', () => {
        const prompt = assembler.assemble({ persona: {} } as any, base);
        const rule = prompt.slice(prompt.indexOf('22a. NO NUMBER WITHOUT'), prompt.indexOf('22. NEVER CONVERT'));
        expect(rule).toContain('An unconfirmed price is NEVER a condition for booking');
        expect(rule).toContain('the booking goes ahead with the price shown as pending');
        expect(rule).toContain('do not offer a person «to confirm the price and finish the booking»');
        expect(rule).toContain('The offer of a person to confirm the price is for a customer who ASKED the price');
        // what the rule always said
        expect(rule).toContain('say the price is not confirmed and offer to have a person from the team confirm it (example)');
    });

    it.each(['example', 'quote'] as const)('the note a %s service carries tells the model the same', status => {
        const note = servicePriceNote(status)!;
        expect(note).toContain('la reserva sigue adelante con el precio pendiente');
        expect(note).toContain('no la condiciones a esa confirmación');
        expect(note).toContain('ofrece que una persona');
    });

    it('a confirmed price carries no note', () => {
        expect(servicePriceNote('confirmed')).toBeUndefined();
    });
});

describe('the appointments the model is shown are the ones the list shows (upcoming + today\'s)', () => {
    const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
    const run = async () => {
        const query = jest.fn(async (_schema: string, sql: string, _params?: unknown[]) => (sql.includes('FROM appointments') ? [{
            id: 'f0080b9a-1111-4111-8111-111111111111', service_name: 'Corte y estilo', status: 'confirmed',
            starts_at_iso: '2026-10-09T16:00:00.000Z', ends_at_iso: '2026-10-09T16:45:00.000Z', updated_at_iso: '2026-10-09T01:00:00.000Z',
        }] : []));
        const result = await new ActiveOperationsContextService({ executeInTenantSchema: query } as any).load({
            tenantId: 'tenant-1', schemaName: 'tenant_test', contactId: CONTACT_ID,
            config: { industry: 'moda_belleza', capabilities: ['appointment_booking'] } as any,
            timezone: 'America/Bogota', now: new Date('2026-10-09T18:30:00.000Z'),
        });
        const call = query.mock.calls.find(([, sql]) => sql.includes('FROM appointments'))!;
        return { sql: String(call[1]), params: call[2], result };
    };

    it('reads from the start of the tenant\'s local day, like list_customer_appointments', async () => {
        const { sql, params } = await run();
        expect(sql).toContain("start_at >= date_trunc('day', NOW() AT TIME ZONE $2)");
        expect(params).toEqual([CONTACT_ID, 'America/Bogota']);
        // an appointment of today that has started is on the account; one already closed (completed / no-show) is not "pending ahead"
        expect(sql).toMatch(/start_at >= \(NOW\(\) AT TIME ZONE \$2\) OR LOWER\(COALESCE\(status, ''\)\) NOT IN \('completed', 'no_show'\)/);
        expect(sql).toContain("NOT IN ('cancelled', 'canceled', 'expired')");
    });

    it('the appointment of this morning reaches the model\'s context', async () => {
        const { result } = await run();
        expect(result.activeObjects?.items[0]).toMatchObject({ kind: 'appointment', reference: 'F0080B9A', label: 'Corte y estilo' });
    });
});
