import { randomUUID } from 'crypto';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { AppointmentRemindersService } from './appointment-reminders.service';

/**
 * ═══ WHOSE SWITCH DECIDED THE CONFIRMATION, AND WHOSE SHOULD HAVE ═══
 *
 * `tools.<family>.emailConfirmations` is a per-AGENT switch, and every consumer
 * of it read the agent like this:
 *
 *     SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1
 *
 * There is no ORDER BY in that statement. On a tenant with two agents — a
 * WhatsApp agent that confirms by email and an Instagram agent that does not —
 * the switch that decided a booking's confirmation was whichever row the
 * planner returned first, not the agent that took the booking.
 *
 * So the assertions here are all of the same kind: TWO agents with OPPOSITE
 * settings, and the outcome must follow the connection the booking arrived on.
 * A test that used one agent would pass against the defect.
 *
 * ── HOW THE FAKE AVOIDS AGREEING WITH THE CODE ──────────────────────────────
 *
 * The fake does NOT re-implement `readServingPersona`'s ranking. It answers the
 * resolution query from a map keyed by the BINDING it was asked for, so asking
 * about the wrong connection returns the other agent's configuration and the
 * outcome assertion fails. It also THROWS on any statement it does not
 * recognise — including the legacy first-active-agent read — so a consumer that
 * goes back to guessing fails loudly instead of quietly passing.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHEMA = 'tenant_confirmation_policy';
const CONTACT = '22222222-2222-4222-8222-222222222222';

/** The two connections of one tenant, and the agent bound to each. */
const CONFIRMING_ACCOUNT = '15550001111';
const SILENT_ACCOUNT = '15559990000';

const agentRow = (over: { id: string; bindings: string[]; tools: any }) => ({
    id: over.id,
    name: 'Agent',
    config_json: { persona: { name: 'Agent' }, tools: over.tools },
    version: 1,
    channels: ['whatsapp'],
    channel_bindings: over.bindings,
    schedule_mode: '24_7',
    is_active: true,
    is_default: false,
});

interface Scenario {
    /** Which of the tenant's connections the booking arrived on. */
    readonly bookedOn: string | null;
    /** `tools` of the agent bound to each connection. */
    readonly toolsByAccount: Record<string, any>;
    readonly testDrive?: boolean;
}

/** Every statement the fake answered, so a test can assert what was asked. */
interface Recorded { sql: string; params: any[] }

function fakePrisma(scenario: Scenario) {
    const asked: Recorded[] = [];
    const conversationId = scenario.bookedOn ? randomUUID() : null;

    const executeInTenantSchema = async (schema: string, sql: string, params: any[] = []) => {
        expect(schema).toBe(SCHEMA);
        asked.push({ sql, params });

        // ── THE LEGACY READ MUST BE GONE ────────────────────────────────
        // Matched before anything else so a consumer that reinstates it
        // cannot be rescued by a later, looser branch.
        if (/FROM agent_personas\s+WHERE is_active = true LIMIT 1/i.test(sql)) {
            throw new Error('the first-active-agent read is back: '
                + 'the confirmation switch is being taken from an arbitrary agent');
        }

        // The persona resolution, answered from the binding it asked about.
        if (sql.includes('WITH ranked AS')) {
            const [binding] = params as [string | null, string];
            const account = typeof binding === 'string' ? binding.split(':')[1] : null;
            const tools = account ? scenario.toolsByAccount[account] : undefined;
            return [{
                matches: tools
                    ? [agentRow({ id: randomUUID(), bindings: [binding as string], tools })]
                    : null,
                has_agents: true,
                legacy_config: null,
            }] as any;
        }

        if (sql.includes('FROM contacts')) {
            // No phone on purpose: the channel notice is a separate lane with
            // its own connection resolution, and this suite is about the email.
            return [{ name: 'Ana', phone: null, email: 'ana@example.com', channel_type: 'whatsapp' }] as any;
        }

        if (sql.includes('FROM appointments a')) {
            return [{
                id: randomUUID(),
                service_name: 'Revisión',
                start_at: '2026-10-01T15:00:00',
                end_at: '2026-10-01T16:00:00',
                location: null,
                metadata: scenario.testDrive ? { testDrive: true } : {},
                customer_name: 'Ana',
                customer_email: 'ana@example.com',
                conversation_id: conversationId,
                staff_name: null,
            }] as any;
        }

        // The origin connection, and the language read — both single-thread
        // reads, told apart by the column list they ask for.
        if (sql.includes('channel_type, channel_account_id FROM conversations')) {
            return (conversationId && params[0] === conversationId
                ? [{ channel_type: 'whatsapp', channel_account_id: scenario.bookedOn }]
                : []) as any;
        }
        if (sql.includes('SELECT metadata FROM conversations')) return [] as any;

        throw new Error(`unrecognised statement: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
    };

    return {
        asked,
        conversationId,
        prisma: {
            executeInTenantSchema: jest.fn(executeInTenantSchema),
            $queryRaw: jest.fn().mockResolvedValue([{ id: TENANT }]),
            // One row serving both readers: the language lookup and the
            // subscription entitlement the reminder lane checks before it sends.
            // A tenant the entitlement reader cannot clear never reaches the
            // switch at all, which is how the reminder assertions below first
            // passed for the wrong reason.
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    language: 'es-CO',
                    isInternal: false,
                    subscriptionStatus: 'active',
                    subscription: {
                        status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                        currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                    },
                }),
            },
        },
    };
}

function notificationsFor(scenario: Scenario) {
    const { prisma, asked, conversationId } = fakePrisma(scenario);
    const emailTemplates = { renderAndSend: jest.fn().mockResolvedValue(true) };
    const service = new AppointmentNotificationsService(
        prisma as any,
        { emit: jest.fn() } as any,
        // The channel lane. Never reached: the contact has no phone.
        { resolve: jest.fn() } as any,
        emailTemplates as any,
        { timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota') } as any,
        { send: jest.fn(), conversationFor: jest.fn(), policyAuthority: jest.fn() } as any,
    );
    return { service, emailTemplates, asked, conversationId };
}

const created = (over: Record<string, any> = {}) => ({
    schemaName: SCHEMA,
    appointment: {
        id: randomUUID(), status: 'confirmed', contactId: CONTACT,
        serviceName: 'Revisión', startAt: '2026-10-01T15:00:00',
        ...over,
    },
});

const CONFIRMS = { appointments: { enabled: true, emailConfirmations: true } };
const STAYS_SILENT = { appointments: { enabled: true, emailConfirmations: false } };

describe('the appointment confirmation email follows the agent that took the booking', () => {
    it('sends when the booking arrived on the agent that confirms, while a sibling agent says not to', async () => {
        const { service, emailTemplates, asked } = notificationsFor({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: { [CONFIRMING_ACCOUNT]: CONFIRMS, [SILENT_ACCOUNT]: STAYS_SILENT },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
        // The connection it asked about, not merely the answer it got.
        const resolution = asked.find(entry => entry.sql.includes('WITH ranked AS'));
        expect(resolution?.params[0]).toBe(`whatsapp:${CONFIRMING_ACCOUNT}`);
    });

    it('stays silent when the booking arrived on the agent that says not to, while a sibling agent confirms', async () => {
        const { service, emailTemplates, asked } = notificationsFor({
            bookedOn: SILENT_ACCOUNT,
            toolsByAccount: { [CONFIRMING_ACCOUNT]: CONFIRMS, [SILENT_ACCOUNT]: STAYS_SILENT },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
        const resolution = asked.find(entry => entry.sql.includes('WITH ranked AS'));
        expect(resolution?.params[0]).toBe(`whatsapp:${SILENT_ACCOUNT}`);
    });

    it('sends for an appointment with no thread, and asks no agent about it', async () => {
        // Entered by hand or through the public booking page. There is no
        // serving agent, and an absent configuration has never meant "off".
        const { service, emailTemplates, asked } = notificationsFor({
            bookedOn: null,
            toolsByAccount: { [SILENT_ACCOUNT]: STAYS_SILENT },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
        expect(asked.some(entry => entry.sql.includes('WITH ranked AS'))).toBe(false);
    });

    it('sends when the serving agent never set the switch', async () => {
        const { service, emailTemplates } = notificationsFor({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: { [CONFIRMING_ACCOUNT]: { appointments: { enabled: true } } },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });
});

describe('a test drive follows the vehicles switch, and a plain appointment never does', () => {
    it('is suppressed by vehicles.emailConfirmations even though appointments says nothing', async () => {
        const { service, emailTemplates } = notificationsFor({
            bookedOn: CONFIRMING_ACCOUNT, testDrive: true,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: {
                    appointments: { enabled: true },
                    vehicles: { enabled: true, emailConfirmations: false },
                },
            },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
    });

    it('is sent by vehicles.emailConfirmations even though appointments says not to', async () => {
        // The nearer family wins. A dealership that switched appointment
        // confirmations off and test-drive confirmations on means both.
        const { service, emailTemplates } = notificationsFor({
            bookedOn: CONFIRMING_ACCOUNT, testDrive: true,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: {
                    appointments: { enabled: true, emailConfirmations: false },
                    vehicles: { enabled: true, emailConfirmations: true },
                },
            },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });

    it('does not let the vehicles switch touch an appointment that is not a test drive', async () => {
        const { service, emailTemplates } = notificationsFor({
            bookedOn: CONFIRMING_ACCOUNT, testDrive: false,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: {
                    appointments: { enabled: true },
                    vehicles: { enabled: true, emailConfirmations: false },
                },
            },
        });

        await service.onAppointmentCreated(created());

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });
});

/**
 * The reminder sweep already JOINs the booking thread in, because the WhatsApp
 * reminder has to name the number Meta bills. So the reminder email has the
 * origin connection in hand and must use the same one — reading a different
 * agent's switch for the reminder than for the confirmation of the same booking
 * is the same defect wearing a second hat.
 */
describe('the reminder email follows the same connection as the booking it reminds about', () => {
    const remindersFor = (scenario: Scenario) => {
        const { prisma, asked } = fakePrisma(scenario);
        const emailTemplates = { renderAndSend: jest.fn().mockResolvedValue(true) };
        const service = new AppointmentRemindersService(
            prisma as any,
            { sendTemplate: jest.fn() } as any,
            {} as any,
            { getReminderSettings: jest.fn() } as any,
            {} as any,
            { emit: jest.fn() } as any,
            emailTemplates as any,
            {
                timezoneFor: jest.fn().mockResolvedValue('America/Bogota'),
                timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota'),
            } as any,
            { send: jest.fn(), conversationFor: jest.fn() } as any,
        );
        return { service, emailTemplates, asked };
    };

    const appt = (account: string | null, over: Record<string, any> = {}) => ({
        id: randomUUID(), service_name: 'Revisión',
        start_at: '2026-10-01T15:00:00', end_at: '2026-10-01T16:00:00',
        contact_email: 'ana@example.com', contact_name: 'Ana',
        metadata: {}, location: null, staff_name: null,
        conversation_channel: account ? 'whatsapp' : null,
        conversation_account_id: account,
        ...over,
    });

    it('stays silent for a booking taken on the agent that says not to', async () => {
        const { service, emailTemplates, asked } = remindersFor({
            bookedOn: SILENT_ACCOUNT,
            toolsByAccount: { [CONFIRMING_ACCOUNT]: CONFIRMS, [SILENT_ACCOUNT]: STAYS_SILENT },
        });

        await (service as any).sendReminderEmail(TENANT, SCHEMA, appt(SILENT_ACCOUNT));

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
        expect(asked.find(entry => entry.sql.includes('WITH ranked AS'))?.params[0])
            .toBe(`whatsapp:${SILENT_ACCOUNT}`);
    });

    it('sends for a booking taken on the agent that confirms', async () => {
        const { service, emailTemplates } = remindersFor({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: { [CONFIRMING_ACCOUNT]: CONFIRMS, [SILENT_ACCOUNT]: STAYS_SILENT },
        });

        await (service as any).sendReminderEmail(TENANT, SCHEMA, appt(CONFIRMING_ACCOUNT));

        expect(emailTemplates.renderAndSend).toHaveBeenCalledTimes(1);
    });

    it('follows the vehicles switch for a test-drive reminder', async () => {
        const { service, emailTemplates, asked } = remindersFor({
            bookedOn: CONFIRMING_ACCOUNT,
            toolsByAccount: {
                [CONFIRMING_ACCOUNT]: {
                    appointments: { enabled: true },
                    vehicles: { enabled: true, emailConfirmations: false },
                },
            },
        });

        await (service as any).sendReminderEmail(
            TENANT, SCHEMA, appt(CONFIRMING_ACCOUNT, { metadata: { testDrive: true } }),
        );

        expect(emailTemplates.renderAndSend).not.toHaveBeenCalled();
        // Not by bailing out before the switch: the resolution was asked, and
        // it was asked about the booking's own connection. Without this the
        // assertion above is satisfied by any early return.
        expect(asked.find(entry => entry.sql.includes('WITH ranked AS'))?.params[0])
            .toBe(`whatsapp:${CONFIRMING_ACCOUNT}`);
    });
});
