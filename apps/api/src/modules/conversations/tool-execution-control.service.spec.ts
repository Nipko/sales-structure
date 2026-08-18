import {
    classifyExplicitToolConfirmation,
    ToolExecutionControlService,
} from './tool-execution-control.service';

const schemaName = 'tenant_dec_controls';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const firstMessageId = '44444444-4444-4444-8444-444444444444';
const secondMessageId = '55555555-5555-4555-8555-555555555555';
const thirdMessageId = '88888888-8888-4888-8888-888888888888';
const fourthMessageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ledgerId = '66666666-6666-4666-8666-666666666666';
const ticketId = '77777777-7777-4777-8777-777777777777';
const secondLedgerId = '99999999-9999-4999-8999-999999999999';
const secondTicketId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';

function createHarness(identityVerified = true) {
    const state: any = {
        latestMessage: { id: firstMessageId, content_text: 'Quiero reservar' },
        messages: [
            { id: firstMessageId, content_text: 'Quiero reservar', sequence: 1 },
            { id: secondMessageId, content_text: 'confirmo', sequence: 2 },
            { id: thirdMessageId, content_text: 'Quiero reservar otra igual', sequence: 3 },
            { id: fourthMessageId, content_text: 'autorizo', sequence: 4 },
        ],
        ledger: null,
        ledgers: [],
        ticket: null,
        tickets: [],
        outbox: [],
        bookingState: null,
        insertInboundBeforeAcquire: false,
    };

    const runQuery = async (sql: string, params: any[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')
            || normalized.startsWith('ALTER TABLE') || normalized.startsWith('DO $ddl$')) return [];

        if (normalized.includes("AND status = 'succeeded'")) {
            const found = [...state.ledgers].reverse().find((item: any) => (
                item.status === 'succeeded'
                && item.tool_name === params[2]
                && item.args_hash === params[3]
            ));
            if (found) state.ledger = found;
            return found ? [found] : [];
        }
        const statusInMatch = normalized.match(/status IN \(([^)]*)\)/);
        if (normalized.startsWith('SELECT') && statusInMatch) {
            const statuses = statusInMatch[1].split(',').map((s: string) => s.trim().replace(/'/g, ''));
            const found = [...state.ledgers].reverse().find((item: any) => (
                statuses.includes(item.status)
                && item.tool_name === params[2]
                && (!normalized.includes('AND args_hash = $4') || item.args_hash === params[3])
            ));
            if (found) state.ledger = found;
            return found ? [found] : [];
        }
        if (normalized.includes('(request_source_message_id = $5::uuid OR confirmed_by_message_id = $5::uuid)')) {
            const found = [...state.ledgers].reverse().find((item: any) => (
                [item.request_source_message_id, item.confirmed_by_message_id].includes(params[4])
                && item.tool_name === params[2]
                && item.args_hash === params[3]
            ));
            if (found) state.ledger = found;
            return found ? [found] : [];
        }

        if (normalized.startsWith('INSERT INTO tool_execution_ledger')) {
            const existing = state.ledgers.find((item: any) => item.idempotency_key === params[0]);
            if (existing) return [];
            state.ledger = {
                id: state.ledgers.length === 0 ? ledgerId : secondLedgerId,
                idempotency_key: params[0],
                tool_name: params[1],
                args_hash: params[2],
                contact_id: params[3],
                conversation_id: params[4],
                assurance_level: params[5],
                status: params[6],
                confirmation_token: null,
                request_source_message_id: params[7],
                confirmation_source_message_id: null,
                confirmed_by_message_id: null,
                confirmation_expires_at: null,
                confirmed_at: null,
                approval_ticket_id: null,
                request_payload: JSON.parse(params[8]),
                channel_type: params[9],
                execution_lease_token: null,
                execution_lease_expires_at: null,
                response_payload: null,
            };
            state.ledgers.push(state.ledger);
            return [state.ledger];
        }
        if (normalized.startsWith('SELECT * FROM tool_execution_ledger WHERE idempotency_key')) {
            const found = state.ledgers.find((item: any) => item.idempotency_key === params[0]);
            if (found) state.ledger = found;
            return found ? [found] : [];
        }
        if (normalized.startsWith('SELECT * FROM tool_execution_ledger WHERE id =')) {
            const found = state.ledgers.find((item: any) => item.id === params[0]);
            if (found) state.ledger = found;
            return found ? [found] : [];
        }
        if (normalized.startsWith('SELECT id::text, content_text FROM messages')) {
            return [state.latestMessage];
        }
        if (normalized.startsWith('SELECT ( NOT EXISTS')) {
            const sourceIndex = state.messages.findIndex((item: any) => item.id === params[1]);
            const latestIndex = state.messages.findIndex((item: any) => item.id === state.latestMessage.id);
            return [{ stale: sourceIndex < 0 || latestIndex > sourceIndex }];
        }
        if (normalized.includes('SET confirmation_token =')) {
            Object.assign(state.ledger, {
                confirmation_token: params[1],
                confirmation_source_message_id: params[2],
                confirmation_expires_at: params[3],
                confirmed_at: null,
                status: 'awaiting_confirmation',
            });
            return [state.ledger];
        }
        if (normalized.includes('SET confirmed_at = NOW(), confirmed_by_message_id')) {
            Object.assign(state.ledger, {
                confirmed_at: new Date().toISOString(),
                confirmed_by_message_id: params[1],
                status: 'ready',
            });
            return [state.ledger];
        }
        if (normalized.startsWith('INSERT INTO tool_approval_tickets')) {
            if (!state.ticket || state.ticket.execution_ledger_id !== state.ledger.id) state.ticket = {
                id: state.tickets.length === 0 ? ticketId : secondTicketId,
                execution_ledger_id: state.ledger.id,
                tool_name: state.ledger.tool_name,
                contact_id: contactId,
                conversation_id: conversationId,
                status: 'pending',
                expires_at: params[4],
                approval_source_message_id: params[5],
                resume_state: 'not_requested',
                decided_by: null,
                decided_at: null,
            };
            if (!state.tickets.includes(state.ticket)) state.tickets.push(state.ticket);
            return [state.ticket];
        }
        if (normalized.startsWith('INSERT INTO tool_approval_outbox')) {
            state.outbox.push({ eventType: params[2], payload: JSON.parse(params[4]) });
            return [];
        }
        if (normalized.includes("SET approval_ticket_id = $2::uuid, status = 'awaiting_approval'")) {
            Object.assign(state.ledger, { approval_ticket_id: params[1], status: 'awaiting_approval' });
            return [state.ledger];
        }
        if (normalized.startsWith('SELECT id, status, expires_at, approval_source_message_id')) {
            return state.ticket ? [state.ticket] : [];
        }
        if (normalized.startsWith('SELECT id, execution_ledger_id, tool_name, contact_id, conversation_id,')) {
            return state.ticket ? [state.ticket] : [];
        }
        if (normalized.includes("SET status = 'ready', updated_at = NOW() WHERE id")) {
            state.ledger.status = 'ready';
            return [state.ledger];
        }
        if (normalized.includes("SET status = 'executing'")) {
            if (!['ready', 'awaiting_confirmation', 'awaiting_approval'].includes(state.ledger.status)) return [];
            if (state.insertInboundBeforeAcquire && state.ledger.assurance_level === 'A4') {
                state.insertInboundBeforeAcquire = false;
                state.latestMessage = {
                    id: thirdMessageId,
                    content_text: 'Cancela, ya no quiero el descuento',
                };
            }
            const sourceIndex = state.messages.findIndex((item: any) => (
                item.id === state.ticket?.approval_source_message_id
            ));
            const latestIndex = state.messages.findIndex((item: any) => item.id === state.latestMessage.id);
            if (state.ledger.assurance_level === 'A4' && latestIndex > sourceIndex) return [];
            Object.assign(state.ledger, {
                status: 'executing',
                execution_lease_token: params[1],
                execution_lease_expires_at: new Date(Date.now() + params[2] * 1000).toISOString(),
            });
            return [state.ledger];
        }
        if (normalized.includes('AND execution_lease_token = $4::uuid')) {
            if (state.ledger.status !== 'executing'
                || state.ledger.execution_lease_token !== params[3]
                || new Date(state.ledger.execution_lease_expires_at).getTime() <= Date.now()) return [];
            Object.assign(state.ledger, {
                status: params[1],
                response_payload: JSON.parse(params[2]),
                execution_lease_token: null,
                execution_lease_expires_at: null,
            });
            return [{ id: state.ledger.id }];
        }
        if (normalized.includes("SET status = 'reconciliation_required'")) {
            if (state.ledger.status !== 'executing') return [];
            Object.assign(state.ledger, {
                status: 'reconciliation_required',
                response_payload: JSON.parse(params[params.length - 1] || params[1]),
                execution_lease_token: null,
                execution_lease_expires_at: null,
            });
            return [state.ledger];
        }
        if (normalized.includes("SET status = 'expired', resume_state = 'failed'")) {
            Object.assign(state.ticket, {
                status: 'expired',
                resume_state: 'failed',
                resume_result: JSON.parse(params[1]),
            });
            return [];
        }
        if (normalized.includes("SET status = 'expired', resume_state = 'not_requested'")) {
            Object.assign(state.ticket, { status: 'expired', resume_state: 'not_requested' });
            return [];
        }
        if (normalized.includes("last_error_code = 'approval_expired'")) {
            Object.assign(state.ledger, {
                status: 'failed',
                response_payload: JSON.parse(params[1]),
            });
            return [];
        }
        if (normalized.includes("last_error_code = 'approval_stale_due_to_new_inbound'")) {
            Object.assign(state.ledger, {
                status: 'failed',
                response_payload: JSON.parse(params[1]),
            });
            return [];
        }
        if (normalized.includes("SET status = 'rejected'")) {
            state.ledger.status = 'rejected';
            return [];
        }
        throw new Error(`Unhandled SQL in fake: ${normalized}`);
    };
    const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, params: any[] = []) => (
        runQuery(sql, params)
    ));
    const transactionInTenantSchema = jest.fn(async (
        _schema: string,
        callback: (query: (sql: string, params?: any[]) => Promise<any>) => Promise<any>,
    ) => callback(runQuery));

    const chatIdentity = {
        isVerified: jest.fn().mockResolvedValue(identityVerified),
        startVerification: jest.fn().mockResolvedValue({ status: 'no_channel' }),
    };
    const redis = {
        get: jest.fn(async () => state.bookingState ? JSON.stringify(state.bookingState) : null),
    };
    const service = new ToolExecutionControlService(
        {
            executeInTenantSchema,
            transactionInTenantSchema,
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
        } as any,
        { get: jest.fn().mockReturnValue('dec-controls-test-secret-at-least-32-bytes') } as any,
        chatIdentity as any,
        redis as any,
    );
    return { service, state, executeInTenantSchema, transactionInTenantSchema, chatIdentity, redis };
}

describe('ToolExecutionControlService', () => {
    it('accepts only explicit bounded confirmations in supported languages', () => {
        for (const value of ['sí', 'I confirm', 'pode fazer', 'je confirme']) {
            expect(classifyExplicitToolConfirmation(value)).toBe('confirmed');
        }
        for (const value of ['no', 'não faça', 'je refuse']) {
            expect(classifyExplicitToolConfirmation(value)).toBe('rejected');
        }
        for (const value of ['quizás', 'yes, but change the amount', 'I said yes yesterday']) {
            expect(classifyExplicitToolConfirmation(value)).toBe('unclear');
        }
    });

    it('acepta la confirmación como la escribe un cliente real', () => {
        // El allowlist exigía coincidencia EXACTA, así que "sí, confirmo la
        // reserva" caía en unclear y el agente volvía a preguntar — el bucle que
        // hacía imposible cerrar una reserva. Sólo la APERTURA otorga
        // consentimiento; nada negado ni matizado pasa.
        for (const value of [
            'Sí, confirmo la reserva',
            'confirmo la reserva del Amazon Minimalist',
            'dale, confirmo',
            'ok confirmo',
            'yes, confirm the booking',
            'sim, confirmo a reserva',
            'oui, je confirme la reservation',
        ]) {
            expect(classifyExplicitToolConfirmation(value)).toBe('confirmed');
        }
    });

    it('nunca infiere consentimiento de una negación o de un sí matizado', () => {
        for (const value of [
            'no confirmo la reserva',
            'todavía no confirmo',
            'sí, pero cambiá el monto',
            'yes, but change the amount',
            'confirmo? no se',
            'cancela la reserva',
        ]) {
            expect(classifyExplicitToolConfirmation(value)).not.toBe('confirmed');
        }
    });

    it('treats a comma as a separator so natural confirmations are not re-asked', () => {
        // "sí, confirmo" is how a customer actually confirms in Spanish. Only
        // trailing punctuation used to be stripped, so this landed in 'unclear'
        // and the agent asked again — stalling the customer at the payment step.
        for (const value of ['sí, confirmo', 'Sí, autorizo', 'sim, confirmo', 'oui, je confirme', 'yes; confirm']) {
            expect(classifyExplicitToolConfirmation(value)).toBe('confirmed');
        }
        // Widening the separator must not manufacture consent out of a refusal
        // or a qualified answer. A qualified yes is still just unclear — the
        // customer wants something changed, so ask again.
        expect(classifyExplicitToolConfirmation('sí, pero cambiá el monto')).toBe('unclear');
        // These two used to be 'unclear' as well, which meant the agent kept
        // asking someone who had already declined. Opening with a negative is a
        // refusal: in Spanish "no confirmo" negates the verb, and "no, cancela"
        // was never ambiguous. For an action that books or charges, reading a
        // refusal as a refusal is both more accurate and the safe direction.
        for (const value of ['no, confirmo', 'no, cancela', 'no gracias', 'no, mejor no']) {
            expect(classifyExplicitToolConfirmation(value)).toBe('rejected');
        }
    });

    it('issues a signed, argument-bound challenge and cannot execute it in the same turn', async () => {
        const { service, state } = createHarness();
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: { serviceId: 'service-1', date: '2026-08-10', time: '10:00' },
        };

        const first = await service.preflight(request);
        const sameTurnRetry = await service.preflight(request);

        expect(first).toMatchObject({ allowed: false, result: { error: 'confirmation_required' } });
        expect(sameTurnRetry).toMatchObject({ allowed: false, result: { error: 'confirmation_required' } });
        expect(state.ledger.confirmation_source_message_id).toBe(firstMessageId);
        expect(state.ledger.confirmation_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(state.ledger.status).toBe('awaiting_confirmation');
    });

    it('rejects a non-canonical confirmation token after a later affirmative message', async () => {
        const { service, state } = createHarness();
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: { serviceId: 'service-1', date: '2026-08-10', time: '10:00' },
        };
        await service.preflight(request);
        // Buffer.from(..., 'base64') decodes this padded variant to the same
        // signature bytes as the original token. It must still fail closed.
        state.ledger.confirmation_token = `${state.ledger.confirmation_token}=`;
        state.latestMessage = { id: secondMessageId, content_text: 'sí' };

        const decision = await service.preflight(request);

        expect(decision).toMatchObject({
            allowed: false,
            result: { error: 'invalid_confirmation_token', shouldHandoff: true },
        });
        expect(state.ledger.status).not.toBe('executing');
    });

    it('executes once after a later confirmation and replays the committed result', async () => {
        const { service, state } = createHarness();
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: { serviceId: 'service-1', date: '2026-08-10', time: '10:00' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'confirmo' };
        const allowed = await service.preflight(request);
        expect(allowed).toMatchObject({ allowed: true, ledgerId });

        await service.complete(schemaName, allowed, { success: true, appointmentId: 'appointment-1' });
        const replay = await service.preflight(request);

        expect(replay).toMatchObject({
            allowed: false,
            result: { success: true, appointmentId: 'appointment-1', idempotentReplay: true },
        });
    });

    it('opens a new operation for the same arguments from a later inbound intent', async () => {
        const { service, state } = createHarness();
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: { serviceId: 'service-1', date: '2026-08-10', time: '10:00' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'confirmo' };
        const allowed = await service.preflight(request);
        await service.complete(schemaName, allowed, { success: true, appointmentId: 'appointment-1' });

        state.latestMessage = { id: thirdMessageId, content_text: 'Quiero reservar otra igual' };
        const newIntent = await service.preflight(request);

        expect(newIntent).toMatchObject({
            allowed: false,
            result: { error: 'confirmation_required', confirmationId: secondLedgerId },
        });
        expect(state.ledgers).toHaveLength(2);
        expect(state.ledgers[0].idempotency_key).not.toBe(state.ledgers[1].idempotency_key);
    });

    it('re-binds a caller idempotency key to contact, conversation, tool and arguments', async () => {
        const { service, state } = createHarness();
        const sharedKey = 'caller-operation-123';
        const args = { serviceId: 'service-1', date: '2026-08-10', time: '10:00' };
        await service.preflight({
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args,
            idempotencyKey: sharedKey,
        });
        const otherContactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const otherConversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        await service.preflight({
            schemaName,
            tenantId,
            contactId: otherContactId,
            conversationId: otherConversationId,
            toolName: 'create_appointment',
            args,
            idempotencyKey: sharedKey,
        });

        expect(state.ledgers).toHaveLength(2);
        expect(state.ledgers[0].idempotency_key).not.toBe(state.ledgers[1].idempotency_key);
        expect(state.ledgers[1]).toMatchObject({
            contact_id: otherContactId,
            conversation_id: otherConversationId,
        });
    });

    it('requires an approved A4 ticket after confirmation and never executes a pending ticket', async () => {
        const { service, state } = createHarness(true);
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'apply_discount',
            args: { percent: 10, reason: 'retención' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'autorizo' };

        const pending = await service.preflight(request);
        expect(pending).toMatchObject({
            allowed: false,
            result: { error: 'approval_required', shouldHandoff: true },
        });
        expect((pending as any).result.approvalTicketId).toBeUndefined();
        expect(state.ledger.status).toBe('awaiting_approval');

        state.ticket.status = 'approved';
        const approved = await service.preflight(request);
        expect(approved).toMatchObject({ allowed: true, ledgerId });
        expect(state.ledger.status).toBe('executing');
    });

    it('closes A4 stale in the same ledger acquisition CAS when a cancellation races the resume', async () => {
        const { service, state } = createHarness(true);
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'apply_discount',
            args: { percent: 10, reason: 'retención' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'autorizo' };
        await service.preflight(request);
        state.ticket.status = 'approved';
        state.ticket.resume_state = 'pending';
        state.insertInboundBeforeAcquire = true;

        const decision = await service.preflight(request);

        expect(decision).toMatchObject({
            allowed: false,
            result: {
                error: 'approval_stale_due_to_new_inbound',
                shouldHandoff: true,
            },
        });
        expect(state.ledger.status).toBe('failed');
        expect(state.ticket.status).toBe('expired');
        expect(state.ledger.status).not.toBe('executing');
    });

    it('closes an expired A4 ticket and creates a fresh ticket for a later intent', async () => {
        const { service, state } = createHarness(true);
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'apply_discount',
            args: { percent: 10, reason: 'retención' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'autorizo' };
        await service.preflight(request);
        const expiredTicketId = state.ticket.id;
        state.ticket.expires_at = new Date(Date.now() - 1_000).toISOString();

        await expect(service.preflight(request)).resolves.toMatchObject({
            allowed: false,
            result: { error: 'approval_expired' },
        });
        expect(state.ticket.status).toBe('expired');
        expect(state.ledger.status).toBe('failed');

        state.latestMessage = { id: thirdMessageId, content_text: 'Quiero solicitar el descuento de nuevo' };
        await service.preflight(request);
        state.latestMessage = { id: fourthMessageId, content_text: 'autorizo' };
        const fresh = await service.preflight(request);

        expect(fresh).toMatchObject({
            allowed: false,
            result: { error: 'approval_required' },
        });
        expect(state.ledgers).toHaveLength(2);
        expect(state.tickets).toHaveLength(2);
        expect(state.ticket.id).not.toBe(expiredTicketId);
        expect(state.ticket.status).toBe('pending');
    });

    it('sweeps expired pending A4 tickets transactionally and idempotently', async () => {
        const ticket: any = {
            id: ticketId,
            execution_ledger_id: ledgerId,
            tool_name: 'apply_discount',
            contact_id: contactId,
            conversation_id: conversationId,
            status: 'pending',
            resume_state: 'not_requested',
            expires_at: new Date(Date.now() - 60_000).toISOString(),
        };
        const ledger: any = {
            id: ledgerId,
            status: 'awaiting_approval',
            response_payload: null,
            last_error_code: null,
        };
        const outbox = new Map<string, any>();
        let failOutbox = true;
        const query = jest.fn(async (sql: string, params: any[] = []) => {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            if (normalized.startsWith('SELECT t.id AS ticket_id')) {
                return ticket.status === 'pending' && new Date(ticket.expires_at).getTime() <= Date.now()
                    ? [{
                        ticket_id: ticket.id,
                        ledger_id: ledger.id,
                        tool_name: ticket.tool_name,
                        contact_id: ticket.contact_id,
                        conversation_id: ticket.conversation_id,
                        expires_at: ticket.expires_at,
                    }]
                    : [];
            }
            if (normalized.startsWith('UPDATE tool_approval_tickets')) {
                if (ticket.status !== 'pending') return [];
                ticket.status = 'expired';
                ticket.resume_state = 'not_requested';
                return [{ id: ticket.id }];
            }
            if (normalized.startsWith('UPDATE tool_execution_ledger')) {
                if (ledger.status === 'awaiting_approval') {
                    ledger.status = 'failed';
                    ledger.response_payload = JSON.parse(params[1]);
                    ledger.last_error_code = 'approval_expired';
                }
                return [];
            }
            if (normalized.startsWith('INSERT INTO tool_approval_outbox')) {
                if (failOutbox) throw new Error('outbox unavailable');
                if (!outbox.has(params[3])) {
                    outbox.set(params[3], {
                        eventType: params[2],
                        payload: JSON.parse(params[4]),
                    });
                }
                return [];
            }
            throw new Error(`Unhandled SQL in expiry fake: ${normalized}`);
        });
        const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            const ticketSnapshot = { ...ticket };
            const ledgerSnapshot = { ...ledger };
            try {
                return await callback(query);
            } catch (error) {
                Object.assign(ticket, ticketSnapshot);
                Object.assign(ledger, ledgerSnapshot);
                throw error;
            }
        });
        const service = new ToolExecutionControlService(
            {
                executeInTenantSchema: jest.fn().mockResolvedValue([]),
                transactionInTenantSchema,
            } as any,
            { get: jest.fn().mockReturnValue('dec-controls-test-secret-at-least-32-bytes') } as any,
            {} as any,
            {} as any,
        );

        await expect(service.expirePendingApprovalTickets(schemaName)).rejects.toThrow('outbox unavailable');
        expect(ticket.status).toBe('pending');
        expect(ledger.status).toBe('awaiting_approval');
        expect(outbox.size).toBe(0);

        failOutbox = false;
        await expect(service.expirePendingApprovalTickets(schemaName)).resolves.toBe(1);
        await expect(service.expirePendingApprovalTickets(schemaName)).resolves.toBe(0);

        expect(ticket).toMatchObject({ status: 'expired', resume_state: 'not_requested' });
        expect(ledger).toMatchObject({
            status: 'failed',
            last_error_code: 'approval_expired',
            response_payload: { error: 'approval_expired' },
        });
        expect([...outbox.values()]).toEqual([{
            eventType: 'tool.approval.expired',
            payload: expect.objectContaining({
                ticketId,
                toolName: 'apply_discount',
                contactId,
                conversationId,
                expiresAt: ticket.expires_at,
            }),
        }]);
    });

    it('moves an expired execution lease to reconciliation instead of retrying the side effect', async () => {
        const { service, state } = createHarness();
        const request = {
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: { serviceId: 'service-1', date: '2026-08-10', time: '10:00' },
        };
        await service.preflight(request);
        state.latestMessage = { id: secondMessageId, content_text: 'confirmo' };
        const allowed = await service.preflight(request);
        state.ledger.execution_lease_expires_at = new Date(Date.now() - 1_000).toISOString();

        await expect(service.complete(schemaName, allowed, { success: true }))
            .rejects.toThrow('tool_execution_lease_expired_or_lost');
        expect(state.ledger.status).toBe('reconciliation_required');

        const replay = await service.preflight(request);
        expect(replay).toMatchObject({
            allowed: false,
            result: { error: 'execution_lease_expired', idempotentReplay: true },
        });
    });

    it('accepts BookingEngine confirmation only when inbound and persisted state bind every argument', async () => {
        const { service, state } = createHarness();
        state.latestMessage = { id: firstMessageId, content_text: 'confirm_yes' };
        state.bookingState = {
            step: 'confirm',
            serviceId: 'service-1',
            date: '2026-08-10',
            time: '10:00',
            staffId: 'staff-1',
            customerName: 'Ana',
            customerEmail: 'ana@example.com',
        };

        const result = await service.preflight({
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: {
                serviceId: 'service-1',
                date: '2026-08-10',
                time: '10:00',
                staffId: 'staff-1',
                customerName: 'Ana',
                customerEmail: 'ana@example.com',
            },
            authorityEvidence: { kind: 'booking_engine_confirmation', source: 'confirm_yes' },
        });

        expect(result).toMatchObject({ allowed: true, ledgerId });
        expect(state.ledger.confirmation_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(state.ledger.confirmed_by_message_id).toBe(firstMessageId);
    });

    it('rejects a stale or mismatched BookingEngine authority claim', async () => {
        const { service, state } = createHarness();
        state.latestMessage = { id: firstMessageId, content_text: 'confirm_yes' };
        state.bookingState = {
            step: 'confirm',
            serviceId: 'service-other',
            date: '2026-08-10',
            time: '10:00',
            customerName: 'Ana',
            customerEmail: 'ana@example.com',
        };

        const result = await service.preflight({
            schemaName,
            tenantId,
            contactId,
            conversationId,
            toolName: 'create_appointment',
            args: {
                serviceId: 'service-1',
                date: '2026-08-10',
                time: '10:00',
                customerName: 'Ana',
                customerEmail: 'ana@example.com',
            },
            authorityEvidence: { kind: 'booking_engine_confirmation', source: 'confirm_yes' },
        });

        expect(result).toMatchObject({
            allowed: false,
            result: { error: 'booking_confirmation_args_mismatch', shouldHandoff: true },
        });
        expect(state.ledger.status).not.toBe('executing');
    });

    it('gates payment-link creation on confirmation, not on an identity channel the tenant may not have', async () => {
        // Regression for the A2 dead-end: create_payment_link used to demand
        // step-up identity, but the tools that satisfy it are only published
        // with the insurance toolset. Every other tenant either escalated with
        // 'identity_unverifiable' or was mailed a code the agent could not
        // consume, so payment by chat could never complete. At A1 the tool must
        // still be gated — by the signed confirmation turn — and must still not
        // reach the provider on the first turn.
        const { service, executeInTenantSchema, chatIdentity } = createHarness(false);
        const result = await service.preflight({
            schemaName,
            tenantId,
            contactId,
            conversationId,
            channelType: 'whatsapp',
            toolName: 'create_payment_link',
            args: { payableReference: 'order:11111111-1111-4111-8111-111111111111' },
        });

        expect(result.allowed).toBe(false);
        expect((result as any).result.error).toBe('confirmation_required');
        expect((result as any).result.shouldHandoff).not.toBe(true);
        expect(chatIdentity.startVerification).not.toHaveBeenCalled();
    });
});
