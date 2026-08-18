/**
 * Conversation scenarios — the tests that would have caught what the owner hit.
 *
 * The existing simulator runs the agent with tools DISABLED, so it can only
 * grade what the agent SAYS. Every defect that made a booking impossible lived
 * in what the agent DOES: an operation re-challenged after it had already
 * succeeded, arguments that drifted between the question and the answer, a
 * customer's "sí, confirmo" landing on a ledger nobody was waiting for.
 *
 * These scenarios drive the real decision layer turn by turn — a customer
 * message becomes a persisted inbound, the agent attempts a tool, the guard
 * decides — with no LLM in the loop, so they are deterministic and run on every
 * push. What they assert is the OUTCOME of the conversation, not its wording.
 */
import { ToolExecutionControlService } from './tool-execution-control.service';

const schemaName = 'tenant_scenarios';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

let idCounter = 0;
function nextUuid(): string {
    idCounter += 1;
    return `aaaaaaaa-bbbb-4ccc-8ddd-${String(idCounter).padStart(12, '0')}`;
}

type Decision = { allowed: boolean; ledgerId?: string; result?: Record<string, any> };

/**
 * What actually happened, in the only terms that matter to a customer.
 * Scenarios assert on this, never on prose.
 */
function outcome(decision: Decision): string {
    if (decision.allowed) return 'EXECUTES';
    if (decision.result?.idempotentReplay) return 'REPLAYS_PRIOR_RESULT';
    const error = decision.result?.error;
    if (error === 'confirmation_required') return 'ASKS_CONFIRMATION';
    return `BLOCKED:${error}`;
}

/** A tenant with a real conversation the guard can reason about. */
function createTenant() {
    const ledgers: any[] = [];
    const messages: Array<{ id: string; content_text: string | null }> = [];

    const runQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
        const q = sql.replace(/\s+/g, ' ').trim();

        if (/^(CREATE|ALTER|DO )/.test(q)) return [];

        if (q.startsWith('SELECT id::text, content_text FROM messages')) {
            const latest = messages[messages.length - 1];
            return latest ? [latest] : [];
        }

        // Is the message that anchored the challenge still the newest one?
        if (q.startsWith('SELECT ( NOT EXISTS')) {
            const anchorIndex = messages.findIndex((m) => m.id === params[1]);
            return [{ stale: anchorIndex < 0 || anchorIndex < messages.length - 1 }];
        }

        const findBy = (predicate: (row: any) => boolean) => {
            const found = [...ledgers].reverse().find(predicate);
            return found ? [found] : [];
        };

        if (q.includes("AND status = 'succeeded'")) {
            return findBy((l) => l.status === 'succeeded'
                && l.tool_name === params[2] && l.args_hash === params[3]);
        }
        const statusIn = q.match(/status IN \(([^)]*)\)/);
        if (statusIn && q.includes('AND args_hash = $4')) {
            const statuses = statusIn[1].split(',').map((s) => s.trim().replace(/'/g, ''));
            return findBy((l) => statuses.includes(l.status)
                && l.tool_name === params[2] && l.args_hash === params[3]);
        }
        if (q.includes('(request_source_message_id = $5::uuid OR confirmed_by_message_id = $5::uuid)')) {
            return findBy((l) => l.tool_name === params[2] && l.args_hash === params[3]
                && [l.request_source_message_id, l.confirmed_by_message_id].includes(params[4]));
        }
        if (q.startsWith('SELECT * FROM tool_execution_ledger WHERE idempotency_key')) {
            return findBy((l) => l.idempotency_key === params[0]);
        }
        if (q.startsWith('SELECT * FROM tool_execution_ledger WHERE id =')) {
            return findBy((l) => l.id === params[0]);
        }

        if (q.startsWith('INSERT INTO tool_execution_ledger')) {
            if (ledgers.some((l) => l.idempotency_key === params[0])) return [];
            const row = {
                id: nextUuid(),
                idempotency_key: params[0],
                tool_name: params[1],
                args_hash: params[2],
                contact_id: params[3],
                conversation_id: params[4],
                assurance_level: params[5],
                status: params[6],
                request_source_message_id: params[7],
                request_payload: JSON.parse(params[8]),
                channel_type: params[9],
                confirmation_token: null,
                confirmation_source_message_id: null,
                confirmed_by_message_id: null,
                confirmation_expires_at: null,
                confirmed_at: null,
                approval_ticket_id: null,
                execution_lease_token: null,
                execution_lease_expires_at: null,
                response_payload: null,
            };
            ledgers.push(row);
            return [row];
        }

        const byId = ledgers.find((l) => l.id === params[0]);

        if (q.includes('SET confirmation_token =')) {
            Object.assign(byId, {
                confirmation_token: params[1],
                confirmation_source_message_id: params[2],
                confirmation_expires_at: params[3],
                confirmed_at: null,
                status: 'awaiting_confirmation',
            });
            return [byId];
        }
        if (q.includes('SET confirmed_at = NOW(), confirmed_by_message_id')) {
            Object.assign(byId, {
                confirmed_at: new Date().toISOString(),
                confirmed_by_message_id: params[1],
                status: 'ready',
            });
            return [byId];
        }
        if (q.includes("SET status = 'rejected'")) {
            Object.assign(byId, { status: 'rejected' });
            return [byId];
        }
        if (q.includes("SET status = 'executing'")) {
            if (!['ready', 'awaiting_confirmation', 'awaiting_approval'].includes(byId.status)) return [];
            Object.assign(byId, {
                status: 'executing',
                execution_lease_token: params[1],
                execution_lease_expires_at: new Date(Date.now() + params[2] * 1000).toISOString(),
            });
            return [byId];
        }
        // Fail-closed sweep for a lease that expired mid-flight. Nothing in
        // these scenarios stalls, so it never matches a row.
        if (q.includes('execution_lease_expires_at <= NOW()')) return [];
        if (q.includes('AND execution_lease_token = $4::uuid')) {
            if (byId.status !== 'executing' || byId.execution_lease_token !== params[3]) return [];
            Object.assign(byId, {
                status: params[1],
                response_payload: JSON.parse(params[2]),
                execution_lease_token: null,
                execution_lease_expires_at: null,
            });
            return [{ id: byId.id }];
        }

        throw new Error(`Unhandled SQL in scenario fake: ${q}`);
    };

    const service = new ToolExecutionControlService(
        {
            executeInTenantSchema: jest.fn(async (_s: string, sql: string, p: any[] = []) => runQuery(sql, p)),
            transactionInTenantSchema: jest.fn(async (
                _s: string,
                cb: (query: (sql: string, p?: any[]) => Promise<any>) => Promise<any>,
            ) => cb(runQuery)),
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
        } as any,
        { get: jest.fn().mockReturnValue('scenario-secret-at-least-32-bytes-long') } as any,
        {
            isVerified: jest.fn().mockResolvedValue(true),
            startVerification: jest.fn().mockResolvedValue({ status: 'no_channel' }),
        } as any,
        { get: jest.fn(async () => null) } as any,
    );

    return {
        ledgers,
        /** The customer writes. This is what the guard reads as consent, or not. */
        says(text: string) {
            messages.push({ id: nextUuid(), content_text: text });
        },
        /** The agent decides to run a tool with these arguments. */
        async attempts(toolName: string, args: Record<string, unknown>): Promise<Decision> {
            return service.preflight({
                schemaName, tenantId, contactId, conversationId, toolName, args,
            } as any) as Promise<Decision>;
        },
        /** The tool ran and produced this. */
        async settled(decision: Decision, result: Record<string, unknown>) {
            await service.complete(schemaName, decision as any, result);
        },
    };
}

const STAY = {
    propertyId: 'amazon-minimalist',
    checkIn: '2026-08-18',
    checkOut: '2026-08-20',
    guests: 2,
};

describe('Escenarios de conversación — reserva de alojamiento', () => {
    it('cierra la reserva cuando el cliente confirma como habla una persona', async () => {
        const t = createTenant();
        t.says('Necesito un apartamento para 2 personas, dos noches desde hoy');
        expect(outcome(await t.attempts('create_property_booking', STAY))).toBe('ASKS_CONFIRMATION');

        t.says('Sí, confirmo la reserva');
        expect(outcome(await t.attempts('create_property_booking', STAY))).toBe('EXECUTES');
    });

    it('no vuelve a pedir confirmación de una reserva que ya hizo', async () => {
        // El bucle que el dueño vio en producción: la reserva se creaba y, en el
        // turno siguiente, el modelo reemitía la misma tool. Como la búsqueda sólo
        // miraba operaciones pendientes, la reserva cumplida era invisible: se
        // abría un ledger nuevo y se pedía confirmar algo que YA existía.
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);
        t.says('Si confirmo');
        await t.settled(
            await t.attempts('create_property_booking', STAY),
            { success: true, bookingId: 'bk-1' },
        );

        t.says('Si confirmo');
        const again = await t.attempts('create_property_booking', STAY);

        expect(outcome(again)).toBe('REPLAYS_PRIOR_RESULT');
        expect(again.result).toMatchObject({ bookingId: 'bk-1' });
        expect(t.ledgers.filter((l) => l.status === 'succeeded')).toHaveLength(1);
    });

    it('la deriva cosmética de argumentos no rompe la confirmación en curso', async () => {
        // El modelo reemite lo mismo escrito distinto — 2 contra "2", el nombre
        // con otra caja, un campo vacío que aparece y desaparece. Hasheando los
        // argumentos crudos, cada variante era una operación nueva: el "sí" del
        // cliente llegaba a un ledger que nadie esperaba y el agente repreguntaba.
        const t = createTenant();
        t.says('Quiero reservar');
        expect(outcome(await t.attempts('create_property_booking', STAY))).toBe('ASKS_CONFIRMATION');

        t.says('Sí, confirmo');
        const drifted = await t.attempts('create_property_booking', {
            propertyId: '  Amazon-Minimalist ',
            checkIn: '2026-08-18',
            checkOut: '2026-08-20',
            guests: '2',
            notes: '',
        });

        expect(outcome(drifted)).toBe('EXECUTES');
        expect(t.ledgers).toHaveLength(1);
    });

    it('un cambio real de los datos exige confirmar de nuevo', async () => {
        // La contracara: el vínculo por argumentos es la garantía de que el
        // cliente aceptó ESOS datos. Si cambian las fechas, se vuelve a preguntar.
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);

        t.says('Sí, confirmo');
        const moved = await t.attempts('create_property_booking', { ...STAY, checkOut: '2026-08-25' });

        expect(outcome(moved)).toBe('ASKS_CONFIRMATION');
        expect(t.ledgers.some((l) => l.status === 'succeeded')).toBe(false);
    });

    it('no reserva cuando el cliente dice que no', async () => {
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);

        t.says('no, mejor no');

        expect(outcome(await t.attempts('create_property_booking', STAY))).toBe('BLOCKED:action_rejected');
    });

    it('no toma por sí un sí con condiciones', async () => {
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);

        t.says('sí, pero cambiá el monto');

        expect(outcome(await t.attempts('create_property_booking', STAY))).toBe('ASKS_CONFIRMATION');
        expect(t.ledgers.some((l) => l.status === 'succeeded')).toBe(false);
    });

    it('permite una segunda reserva idéntica cuando el cliente la pide de verdad', async () => {
        // El recuerdo de lo ya cumplido no puede volverse una cárcel: si el
        // cliente pide otra igual, eso es una intención nueva, no una repetición.
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);
        t.says('confirmo');
        await t.settled(
            await t.attempts('create_property_booking', STAY),
            { success: true, bookingId: 'bk-1' },
        );

        t.says('Quiero reservar otra igual');
        const second = await t.attempts('create_property_booking', STAY);

        expect(outcome(second)).toBe('ASKS_CONFIRMATION');
        expect(t.ledgers).toHaveLength(2);
    });
});

describe('Escenarios de conversación — cobro', () => {
    const CHARGE = { amountCents: 36000000, currency: 'COP', description: 'Reserva Amazon Minimalist' };

    it('nunca emite un enlace de pago sin confirmación explícita', async () => {
        const t = createTenant();
        t.says('Quiero pagar');

        expect(outcome(await t.attempts('create_payment_link', CHARGE))).toBe('ASKS_CONFIRMATION');
    });

    it('reservar y pagar son operaciones distintas y no se pisan', async () => {
        const t = createTenant();
        t.says('Quiero reservar');
        await t.attempts('create_property_booking', STAY);
        t.says('confirmo');
        await t.settled(
            await t.attempts('create_property_booking', STAY),
            { success: true, bookingId: 'bk-1' },
        );

        // Mismo turno de confirmación, otra herramienta: el cobro tiene que
        // pedir su propio sí, nunca heredar el de la reserva.
        expect(outcome(await t.attempts('create_payment_link', CHARGE))).toBe('ASKS_CONFIRMATION');

        t.says('sí, confirmo el pago');
        expect(outcome(await t.attempts('create_payment_link', CHARGE))).toBe('EXECUTES');
    });

    it('no cobra dos veces cuando el cliente vuelve a confirmar', async () => {
        const t = createTenant();
        t.says('Quiero pagar');
        await t.attempts('create_payment_link', CHARGE);
        t.says('confirmo');
        await t.settled(
            await t.attempts('create_payment_link', CHARGE),
            { success: true, url: 'https://pay.example/1' },
        );

        t.says('sí, confirmo');
        const again = await t.attempts('create_payment_link', CHARGE);

        expect(outcome(again)).toBe('REPLAYS_PRIOR_RESULT');
        expect(again.result).toMatchObject({ url: 'https://pay.example/1' });
    });
});
