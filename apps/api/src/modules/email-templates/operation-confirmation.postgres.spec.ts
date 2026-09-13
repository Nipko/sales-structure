import { randomUUID } from 'crypto';
import {
    CONFIRMS_ACCOUNT, SILENT_ACCOUNT,
    startConfirmationHarness, type ConfirmationHarness,
} from './__fixtures__/confirmation-harness';

/**
 * ═══ THE ONE DECISION NINE WRITERS ASK, PROVED ONCE ═══
 *
 * `OperationConfirmationService` answers five different questions with five
 * different names, and every one of them used to read "no email went out":
 * an unowned schema, a customer with no address, the owner's switch, a refused
 * transport, and an actual send. A caller that cannot tell them apart cannot
 * explain itself to the owner — and neither can a test.
 *
 * Two connections, two agents, OPPOSITE answers, and the family list is what
 * decides which of the two is read. A single-agent suite would pass against
 * the original defect (`agent_personas WHERE is_active = true LIMIT 1`, an
 * unordered pick), which is the defect this whole row exists for.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the shared confirmation decision', () => {
    let h: ConfirmationHarness;
    jest.setTimeout(180_000);

    const AGENT_CONFIRMS = randomUUID();
    const AGENT_SILENT = randomUUID();

    beforeAll(async () => {
        h = await startConfirmationHarness('opconfirm', { ddl: [], tables: [] });
    });
    afterAll(async () => { if (h) await h.teardown(); });

    beforeEach(async () => {
        await h.reset();
        // Crosswise on purpose: each agent says yes in ONE family and no in
        // the other, so reading the wrong agent OR the wrong family inverts an
        // outcome rather than quietly agreeing.
        await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT, {
            gyms: { enabled: true, emailConfirmations: true },
            insurance: { enabled: true, emailConfirmations: false },
        });
        await h.saveAgent(AGENT_SILENT, SILENT_ACCOUNT, {
            gyms: { enabled: true, emailConfirmations: false },
            insurance: { enabled: true, emailConfirmations: true },
        });
    });

    const send = async (over: {
        account?: string | null;
        families?: any;
        email?: string | null;
        contactEmail?: string | null;
    } = {}) => {
        const customer = await h.customer(
            over.account === undefined ? CONFIRMS_ACCOUNT : over.account,
            over.contactEmail === undefined ? 'ana@example.com' : over.contactEmail);
        return h.confirmations.send({
            schemaName: h.schema,
            families: over.families ?? ['gyms'],
            slug: 'gym_class_confirmation',
            conversationId: customer.conversationId,
            contactId: customer.contactId,
            email: over.email,
            operation: 'synthetic operation',
            variables: { service_name: 'Yoga' },
        });
    };

    describe('the five answers are five answers', () => {
        it('sends under the agent that confirms, and says so', async () => {
            await expect(send({ account: CONFIRMS_ACCOUNT })).resolves.toBe('sent');
            expect(h.renderAndSend).toHaveBeenCalledTimes(1);
        });

        it('reports the owner switch, not a generic failure, under the agent that does not', async () => {
            await expect(send({ account: SILENT_ACCOUNT })).resolves.toBe('switched_off');
            expect(h.renderAndSend).not.toHaveBeenCalled();
        });

        it('reports an unowned schema as unowned', async () => {
            // The predicate an isolated evaluation's cloned schema hits: the
            // clone has no row in `public.tenants`.
            await h.setTenantActive(false);
            await expect(send()).resolves.toBe('schema_unowned');
            expect(h.renderAndSend).not.toHaveBeenCalled();
        });

        it('reports a customer with no address as having no recipient', async () => {
            await expect(send({ contactEmail: null })).resolves.toBe('no_recipient');
            expect(h.renderAndSend).not.toHaveBeenCalled();
        });

        it('reports a refused transport as failed, never as sent', async () => {
            // `renderAndSend` answers `false` for a missing template and for a
            // transport that refused. Calling that "sent" is the same lie as a
            // flag written for a message that never left.
            h.renderAndSend.mockResolvedValue(false);
            await expect(send()).resolves.toBe('failed');
        });

        it('reports a thrown transport as failed and does not propagate', async () => {
            // Every caller has already committed. An unreachable mail server
            // must not turn a booked class into a failed operation.
            h.renderAndSend.mockRejectedValue(new Error('smtp_unreachable'));
            await expect(send()).resolves.toBe('failed');
        });
    });

    describe('which agent, and which of its switches', () => {
        it('follows the family it was given, not the other one on the same agent', async () => {
            // Same connection, same agent, different family: the agent that
            // confirms classes refuses quotes.
            await expect(send({ account: CONFIRMS_ACCOUNT, families: ['insurance'] }))
                .resolves.toBe('switched_off');
            await expect(send({ account: SILENT_ACCOUNT, families: ['insurance'] }))
                .resolves.toBe('sent');
        });

        it('prefers the nearer family, and falls through when the owner never set it', async () => {
            // `['gyms','insurance']` on the agent that confirms classes and
            // refuses quotes: the NEARER one decides, so it sends.
            await expect(send({ account: CONFIRMS_ACCOUNT, families: ['gyms', 'insurance'] }))
                .resolves.toBe('sent');
            // A family the owner never touched contributes no answer, so the
            // list falls through to the next one — which here says no.
            await expect(send({ account: CONFIRMS_ACCOUNT, families: ['petBoarding', 'insurance'] }))
                .resolves.toBe('switched_off');
        });

        it('sends for an operation with no thread, and never asks an agent', async () => {
            // Raised in the dashboard: no thread, no serving agent, and an
            // absent configuration has never meant "off" — while BOTH agents
            // that exist would have refused this family.
            await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT,
                { gyms: { enabled: true, emailConfirmations: false } });
            await expect(send({ account: null })).resolves.toBe('sent');
        });
    });

    describe('the recipient and the language', () => {
        it('prefers the address the operation captured over the contact record', async () => {
            await expect(send({ email: 'dictated@example.com' })).resolves.toBe('sent');
            expect(h.renderAndSend.mock.calls[0][2]).toBe('dictated@example.com');
        });

        it('falls back to the contact address when the operation captured none', async () => {
            await expect(send({ email: null })).resolves.toBe('sent');
            expect(h.renderAndSend.mock.calls[0][2]).toBe('ana@example.com');
        });

        it('names the customer from the contact, and never leaves the greeting blank', async () => {
            await send();
            expect(h.renderAndSend.mock.calls[0][3].customer_name).toBe('Ana');
        });

        it('renders in the tenant language, reduced to the two-letter code', async () => {
            await h.setTenantLanguage('pt-BR');
            await send();
            expect(h.renderAndSend.mock.calls[0][4]).toBe('pt');
        });

        it('falls back to Spanish for a language the templates do not carry', async () => {
            await h.setTenantLanguage('de-DE');
            await send();
            expect(h.renderAndSend.mock.calls[0][4]).toBe('es');
        });
    });
});
