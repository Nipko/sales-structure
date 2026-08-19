import { requestsAnotherOperation } from './tool-execution-control.service';
import { ToolExecutionControlService } from './tool-execution-control.service';

/**
 * The same operation, written differently, is still the same operation.
 *
 * The model re-issues a confirmed call by rebuilding its arguments from the
 * conversation text, so the date arrives as "2026-08-20" one turn and
 * "20/08/2026" the next, the phone with and without spaces, the name with and
 * without its accent. Each spelling produced a different hash, a new ledger and
 * one more "please confirm" over an operation the customer had already agreed
 * to — which is what the loop looked like from their side.
 */

const schemaName = 'tenant_args_canonical';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

/** Hash of one argument set, read off the ledger row the guard writes. */
function createHasher() {
    const inserted: any[] = [];
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        // The guard needs an inbound message to bind the operation to before it
        // will open a ledger; without it preflight stops early and the hash is
        // never written (which silently made every comparison below vacuous).
        if (normalized.includes('FROM messages') && normalized.includes("direction = 'inbound'")) {
            return [{ id: '44444444-4444-4444-8444-444444444444', content_text: 'quiero reservar' }];
        }
        if (normalized.startsWith('INSERT INTO tool_execution_ledger')) {
            inserted.push({ idempotency_key: params[0], tool_name: params[1], args_hash: params[2] });
            return [];
        }
        return [];
    });
    const service = new ToolExecutionControlService(
        { executeInTenantSchema, transactionInTenantSchema: jest.fn() } as any,
        { get: jest.fn().mockReturnValue('args-canonical-secret-at-least-32-bytes-long') } as any,
        { isVerified: jest.fn().mockResolvedValue(true), startVerification: jest.fn() } as any,
        { get: jest.fn(), incr: jest.fn(), expire: jest.fn() } as any,
    );
    return { service, inserted };
}

async function hashOf(args: Record<string, unknown>): Promise<string> {
    const { service, inserted } = createHasher();
    await service.preflight({
        schemaName, tenantId, contactId, conversationId,
        toolName: 'create_property_booking', args,
    });
    const hash = inserted[0]?.args_hash;
    // Guard the guard: a harness that never reaches the ledger would make every
    // comparison below trivially true.
    if (!hash) throw new Error('preflight never opened a ledger — the harness is not exercising the hash');
    return hash;
}

describe('canonical arguments', () => {
    it('reads the same date written three ways as one operation', async () => {
        const iso = await hashOf({ propertyId: 'p1', checkIn: '2026-08-20' });
        expect(await hashOf({ propertyId: 'p1', checkIn: '20/08/2026' })).toBe(iso);
        expect(await hashOf({ propertyId: 'p1', checkIn: '2026-8-20' })).toBe(iso);
    });

    it('does not merge two genuinely different dates', async () => {
        const a = await hashOf({ propertyId: 'p1', checkIn: '2026-08-20' });
        expect(await hashOf({ propertyId: 'p1', checkIn: '2026-08-21' })).not.toBe(a);
    });

    it('reads one formatted phone written several ways as one customer', async () => {
        const spaced = await hashOf({ propertyId: 'p1', guestPhone: '+57 320 801 07 37' });
        expect(await hashOf({ propertyId: 'p1', guestPhone: '+57-320-801-0737' })).toBe(spaced);
        expect(await hashOf({ propertyId: 'p1', guestPhone: '+573208010737' })).toBe(spaced);
        // A different number stays different.
        expect(await hashOf({ propertyId: 'p1', guestPhone: '+57 320 801 07 38' })).not.toBe(spaced);
    });

    it('leaves a bare number alone so an amount is never read as a phone', async () => {
        // 1500000 is a price in COP, not a phone. Canonicalising bare digits as
        // phone numbers would quietly merge two different amounts.
        const a = await hashOf({ propertyId: 'p1', totalAmount: '1500000' });
        expect(await hashOf({ propertyId: 'p1', totalAmount: '1600000' })).not.toBe(a);
        expect(await hashOf({ propertyId: 'p1', totalAmount: 1500000 })).toBe(a);
    });

    it('ignores accents in a name', async () => {
        const accented = await hashOf({ propertyId: 'p1', guestName: 'José Pérez' });
        expect(await hashOf({ propertyId: 'p1', guestName: 'Jose Perez' })).toBe(accented);
    });

    it('still separates two different guests', async () => {
        const ana = await hashOf({ propertyId: 'p1', guestName: 'Ana' });
        expect(await hashOf({ propertyId: 'p1', guestName: 'Andrea' })).not.toBe(ana);
    });
});

describe('requestsAnotherOperation', () => {
    it('recognises a customer asking for a second one', () => {
        for (const value of [
            'Quiero reservar otra igual',
            'dame otro turno',
            'quiero una mas',
            'book another one please',
            'quero mais uma',
            "je veux une autre",
        ]) {
            expect(requestsAnotherOperation(value)).toBe(true);
        }
    });

    it('does not mistake a question about the existing one for a new request', () => {
        // These must replay the booking that exists, not create a second.
        for (const value of ['¿ya quedó?', 'gracias', 'sí, confirmo', 'perfecto', 'is it confirmed?']) {
            expect(requestsAnotherOperation(value)).toBe(false);
        }
    });
});
