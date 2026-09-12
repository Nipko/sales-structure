import { randomUUID } from 'crypto';
import { ToursService } from './tours.service';
import { PropertiesService } from '../vacation-rental/properties.service';

/**
 * ═══ THE SAME DEFECT, IN THE TWO BOOKING WRITERS ═══
 *
 * `tours.emailConfirmations` and `properties.emailConfirmations` were both read
 * from `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`
 * — an unordered pick among the tenant's agents, so on a tenant with two the
 * owner's switch on the agent that TOOK the booking decided it only by luck.
 *
 * Both suites use TWO agents with opposite settings and assert the outcome
 * follows the connection the booking arrived on. The fake answers the
 * resolution query from the binding it was ASKED for and throws on the legacy
 * statement, so neither asking the wrong connection nor going back to the old
 * read can pass.
 */

const CONFIRMING_ACCOUNT = '15550001111';
const SILENT_ACCOUNT = '15559990000';

const CONFIRMS = (family: string) => ({ [family]: { enabled: true, emailConfirmations: true } });
const STAYS_SILENT = (family: string) => ({ [family]: { enabled: true, emailConfirmations: false } });

/**
 * The reads the post-commit confirmation makes, and nothing else.
 *
 * Anything unrecognised throws: the whole point is that a consumer which stops
 * asking about the booking's own connection fails loudly.
 */
function confirmationReads(options: {
    readonly conversationId: string | null;
    readonly bookedOn: string | null;
    readonly toolsByAccount: Record<string, any>;
}) {
    const asked: Array<{ sql: string; params: any[] }> = [];
    const read = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        asked.push({ sql, params });

        if (/FROM agent_personas\s+WHERE is_active = true LIMIT 1/i.test(sql)) {
            throw new Error('the first-active-agent read is back: '
                + 'the confirmation switch is being taken from an arbitrary agent');
        }
        if (sql.includes('WITH ranked AS')) {
            const [binding] = params as [string | null, string];
            const account = typeof binding === 'string' ? binding.split(':')[1] : null;
            const tools = account ? options.toolsByAccount[account] : undefined;
            return [{
                matches: tools ? [{
                    id: randomUUID(), name: 'Agent',
                    config_json: { persona: { name: 'Agent' }, tools },
                    version: 1, channels: ['whatsapp'],
                    channel_bindings: [binding], schedule_mode: '24_7',
                    is_active: true, is_default: false,
                }] : null,
                has_agents: true,
                legacy_config: null,
            }];
        }
        if (sql.includes('channel_type, channel_account_id FROM conversations')) {
            return options.conversationId && params[0] === options.conversationId
                ? [{ channel_type: 'whatsapp', channel_account_id: options.bookedOn }]
                : [];
        }
        throw new Error(`unrecognised statement: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
    });
    /** The binding the resolution was actually asked about, if it was asked. */
    const resolvedBinding = () =>
        asked.find(entry => entry.sql.includes('WITH ranked AS'))?.params[0];
    return { read, asked, resolvedBinding };
}

describe('the tour booking confirmation follows the agent that took the booking', () => {
    const SCHEMA = 'tenant_tours_policy';
    const PACKAGE = '11111111-1111-4111-8111-111111111111';

    const build = (over: { bookedOn: string | null; toolsByAccount: Record<string, any> }) => {
        const conversationId = over.bookedOn ? randomUUID() : null;
        const { read, resolvedBinding } = confirmationReads({ ...over, conversationId });
        const emailTemplates = { renderAndSend: jest.fn().mockResolvedValue(true) };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM contacts')) return [];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM tour_packages')) {
                return [{ id: PACKAGE, is_active: true, price: 100, currency: 'COP', child_discount_pct: 0 }];
            }
            if (sql.includes('FROM tour_inventory')) return [];
            if (sql.includes('INSERT INTO tour_bookings')) {
                return [{ id: randomUUID(), total_price: 200, currency: 'COP', conversation_id: conversationId }];
            }
            if (sql.includes('FROM tour_bookings')) return [];
            throw new Error(`Unexpected transactional SQL: ${sql}`);
        });
        const service = new ToursService(
            {
                executeInTenantSchema: read,
                transactionInTenantSchema: jest.fn(async (_s: string, cb: any) => cb(query)),
            } as any,
            { enforcePlanLimit: jest.fn() } as any,
            emailTemplates as any,
        );
        return { service, emailTemplates, resolvedBinding, conversationId };
    };

    const book = (service: ToursService, conversationId: string | null) =>
        service.createBooking(SCHEMA, {
            packageId: PACKAGE, departureDate: '2026-10-01', partySize: 2,
            guestName: 'Ana', guestEmail: 'ana@example.com',
            ...(conversationId ? { conversationId } : {}),
        } as any);

    it('stays silent when the booking arrived on the agent that says not to, while a sibling confirms', async () => {
        const { service, emailTemplates, resolvedBinding, conversationId } = build({
            bookedOn: SILENT_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: CONFIRMS('tours'),
                [SILENT_ACCOUNT]: STAYS_SILENT('tours'),
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
        expect(resolvedBinding()).toBe(`whatsapp:${SILENT_ACCOUNT}`);
    });

    it('sends when the booking arrived on the agent that confirms, while a sibling says not to', async () => {
        const { service, emailTemplates, resolvedBinding, conversationId } = build({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: CONFIRMS('tours'),
                [SILENT_ACCOUNT]: STAYS_SILENT('tours'),
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
        expect(emailTemplates.renderAndSend.mock.calls[0][1]).toBe('tour_booking_confirmation');
        expect(resolvedBinding()).toBe(`whatsapp:${CONFIRMING_ACCOUNT}`);
    });

    it('sends for a booking entered with no thread, and asks no agent about it', async () => {
        const { service, emailTemplates, resolvedBinding } = build({
            bookedOn: null,
            toolsByAccount: { [SILENT_ACCOUNT]: STAYS_SILENT('tours') },
        });

        await book(service, null);

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
        expect(resolvedBinding()).toBeUndefined();
    });

    it('is not decided by another family switched off on the same agent', async () => {
        // One agent, `properties` off and `tours` untouched. A consumer that
        // read the wrong family would suppress a tour confirmation over a
        // lodging setting.
        const { service, emailTemplates, conversationId } = build({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: { ...STAYS_SILENT('properties'), tours: { enabled: true } },
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });
});

describe('the stay confirmation follows the agent that took the booking', () => {
    const SCHEMA = 'tenant_lodging_policy';
    const PROPERTY = '22222222-2222-4222-8222-222222222222';
    const property = {
        id: PROPERTY, name: 'Casa Mar', is_active: true, max_guests: 4, min_nights: 1,
        night_price: '100.00', cleaning_fee: '20.00', currency: 'COP', check_in_instructions: null,
    };

    const build = (over: { bookedOn: string | null; toolsByAccount: Record<string, any> }) => {
        const conversationId = over.bookedOn ? randomUUID() : null;
        const { read, resolvedBinding } = confirmationReads({ ...over, conversationId });
        const emailTemplates = { renderAndSend: jest.fn().mockResolvedValue(true) };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM contacts')) return [];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('SELECT * FROM properties')) return [property];
            if (sql.includes(') conflicts LIMIT 1')) return [];
            if (sql.includes('SELECT id FROM property_bookings')) return [];
            if (sql.includes('INSERT INTO property_bookings')) {
                return [{ id: randomUUID(), total_price: 220, currency: 'COP', conversation_id: conversationId }];
            }
            throw new Error(`Unexpected transactional SQL: ${sql}`);
        });
        const service = new PropertiesService(
            {
                tenant: { findUnique: jest.fn() },
                executeInTenantSchema: read,
                transactionInTenantSchema: jest.fn(async (_s: string, cb: any) => cb(query)),
            } as any,
            { enforcePlanLimit: jest.fn() } as any,
            emailTemplates as any,
        );
        return { service, emailTemplates, resolvedBinding, conversationId };
    };

    const book = (service: PropertiesService, conversationId: string | null) =>
        service.createBooking(SCHEMA, PROPERTY, {
            guestName: 'Ana', guestEmail: 'ana@example.com', guestsCount: 2,
            checkIn: '2026-10-01', checkOut: '2026-10-03',
            ...(conversationId ? { conversationId } : {}),
        } as any);

    it('stays silent when the booking arrived on the agent that says not to, while a sibling confirms', async () => {
        const { service, emailTemplates, resolvedBinding, conversationId } = build({
            bookedOn: SILENT_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: CONFIRMS('properties'),
                [SILENT_ACCOUNT]: STAYS_SILENT('properties'),
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
        expect(resolvedBinding()).toBe(`whatsapp:${SILENT_ACCOUNT}`);
    });

    it('sends when the booking arrived on the agent that confirms, while a sibling says not to', async () => {
        const { service, emailTemplates, resolvedBinding, conversationId } = build({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: CONFIRMS('properties'),
                [SILENT_ACCOUNT]: STAYS_SILENT('properties'),
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
        expect(emailTemplates.renderAndSend.mock.calls[0][1]).toBe('property_booking_confirmation');
        expect(resolvedBinding()).toBe(`whatsapp:${CONFIRMING_ACCOUNT}`);
    });

    it('is not decided by another family switched off on the same agent', async () => {
        const { service, emailTemplates, conversationId } = build({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: { ...STAYS_SILENT('tours'), properties: { enabled: true } },
            },
        });

        await book(service, conversationId);

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });
});
