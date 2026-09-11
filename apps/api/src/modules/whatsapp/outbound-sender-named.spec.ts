import { AppointmentRemindersService } from '../appointments/appointment-reminders.service';
import { DripSequenceService } from '../automation/drip-sequence.service';
import { AutomationJobsProcessor } from '../automation/automation-jobs.processor';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { permissiveSpendGate } from '../channels/__fixtures__/spend-gate-double';

/**
 * ═══ EVERY CHARGED SEND SAYS WHICH ACCOUNT PAYS ═══
 *
 * From 1 October 2026 Meta charges the business's own WhatsApp Business Account
 * for each delivered service message. Parallly is a Tech Provider: it does not
 * pay, it decides which of the tenant's accounts does — and until now several
 * producers decided that by accident. They asked the resolver for "a WhatsApp
 * token" without naming a number, and the resolver answered with the tenant's
 * OLDEST connection. On a two-number tenant every reminder, every drip step and
 * every automation template was billed to whichever number happened to connect
 * first, which is a property of row order and not of any decision.
 *
 * The resolver refuses now instead of choosing, so these producers do not merely
 * bill the wrong account: they stop. Both halves matter and both are asserted —
 * the sender that IS known is passed, and the sender that genuinely is not stays
 * `undefined` rather than becoming a guess.
 *
 * Each case drives the real method with doubles and reads the argument the
 * producer actually handed to the transport. A producer that "looks like" it
 * names its sender is not the same as one that does.
 */
describe('every charged WhatsApp producer names the account that pays', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';
    const SCHEMA = 'tenant_sender';
    const NUMBER = '15550001111';

    describe('appointment reminders', () => {
        /** Both reminder crons run the same path; only the flag column differs. */
        const remindersWith = (appointment: Record<string, unknown>) => {
            const messaging = { sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'm' }) };
            const queries: string[] = [];
            const prisma = {
                $queryRaw: jest.fn().mockResolvedValue([{ id: TENANT, schema_name: SCHEMA, settings: {} }]),
                tenant: { findUnique: jest.fn().mockResolvedValue({ isInternal: true, subscriptionStatus: 'active' }) },
                executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                    queries.push(sql);
                    if (sql.includes('FROM appointments')) return [appointment];
                    // The reminder refuses to send without an approved template,
                    // so the double has to have one or nothing is ever sent and
                    // every assertion below passes vacuously.
                    if (sql.includes('FROM whatsapp_templates')) {
                        return [{ id: 't', name: 'appointment_reminder', approval_status: 'APPROVED', language: 'es' }];
                    }
                    return [];
                }),
            };
            const service = new AppointmentRemindersService(
                prisma as any, messaging as any,
                { getTemplateByName: jest.fn().mockResolvedValue({ approval_status: 'APPROVED' }) } as any,
                { getReminderSettings: jest.fn().mockResolvedValue({ reminder24h: true, reminder2h: true }) } as any,
                { runExclusive: jest.fn() } as any,
                { emit: jest.fn() } as any,
                { renderAndSend: jest.fn() } as any,
                {
                    timezoneFor: jest.fn().mockResolvedValue('America/Bogota'),
                    timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota'),
                } as any,
            );
            return { service, messaging, queries };
        };

        const appointment = (extra: Record<string, unknown> = {}) => ({
            id: '22222222-2222-4222-8222-222222222222',
            service_name: 'Consulta', start_at: new Date(Date.now() + 86_400_000).toISOString(),
            end_at: new Date(Date.now() + 90_000_000).toISOString(), location: 'Sede',
            metadata: {}, contact_id: '33333333-3333-4333-8333-333333333333',
            contact_name: 'Ana', contact_phone: '+573001112233', contact_channel: 'whatsapp',
            conversation_channel: 'whatsapp',
            staff_name: 'Dr. Pérez', ...extra,
        });

        it('bills the number the appointment was booked through', async () => {
            const { service, messaging } = remindersWith(appointment({ conversation_account_id: NUMBER }));
            await service.send24hReminders();
            expect(messaging.sendTemplate).toHaveBeenCalledTimes(1);
            // Argument six is the sender. Asserting only that it was called
            // would pass just as well when the argument is missing.
            expect(messaging.sendTemplate.mock.calls[0][5]).toBe(NUMBER);
        });

        it('leaves the sender unset for an appointment that had no conversation', async () => {
            // A booking made by hand or through the public page arrived through
            // no connection. Filling one in would charge an account nobody chose;
            // leaving it undefined lets the resolver serve a single-number tenant
            // and refuse a multi-number one.
            const { service, messaging } = remindersWith(appointment({ conversation_account_id: null }));
            await service.send24hReminders();
            expect(messaging.sendTemplate.mock.calls[0][5]).toBeUndefined();
        });

        it('does not treat a blank string as a connection', async () => {
            const { service, messaging } = remindersWith(appointment({ conversation_account_id: '   ' }));
            await service.send24hReminders();
            expect(messaging.sendTemplate.mock.calls[0][5]).toBeUndefined();
        });

        it.each(['instagram', 'messenger', 'telegram', 'web_widget'])(
            'lends nothing from an appointment booked over %s', async channel => {
                // The column holds whichever account the customer wrote to, and
                // an Instagram id is a perfectly well-formed string. Handing it
                // to `sendTemplate` asked the WhatsApp resolver for a connection
                // called `IG_ACCOUNT`.
                const { service, messaging } = remindersWith(appointment({
                    conversation_account_id: 'IG_ACCOUNT', conversation_channel: channel,
                }));
                await service.send24hReminders();
                expect(messaging.sendTemplate.mock.calls[0][5]).toBeUndefined();
            });

        it('asks the database for the connection, not just for the appointment', async () => {
            // The column has to be selected or the argument is always undefined
            // and the two cases above agree with each other about nothing.
            const { service, queries } = remindersWith(appointment({ conversation_account_id: NUMBER }));
            await service.send24hReminders();
            const select = queries.find(sql => sql.includes('FROM appointments'));
            expect(select).toContain('channel_account_id');
            expect(select).toContain('JOIN conversations');
            // And its channel, without which the account means nothing.
            expect(select).toContain('channel_type');
        });
    });

    describe('drip sequences', () => {
        const dripWith = (channelAccountId: string | null, channelType = 'whatsapp') => {
            const messaging = { sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'm' }) };
            const channelToken = { getChannelToken: jest.fn().mockResolvedValue({ accessToken: 't', accountId: NUMBER }) };
            const prisma = {
                executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
                    if (sql.includes('FROM conversations')) {
                        return [{ channel_account_id: channelAccountId, channel_type: channelType }];
                    }
                    if (sql.includes('FROM contacts')) return [{ id: 'c', name: 'Ana', phone: '+573001112233' }];
                    return [];
                }),
            };
            // queue, prisma, redis, throttle, outboundQueue, channelToken,
            // persona, llmRouter, compliance, segments, whatsappMessaging.
            const service = new DripSequenceService(
                { add: jest.fn() } as any, prisma as any, {} as any, {} as any, {} as any,
                channelToken as any, {} as any, {} as any, {} as any, {} as any,
                messaging as any,
            );
            return { service, messaging, channelToken };
        };

        const step = { message_type: 'template', template_name: 'follow_up', template_language: 'es' };
        const enrolment = { contact_id: 'c', conversation_id: '44444444-4444-4444-8444-444444444444' };

        it('bills the number the enrolment’s conversation belongs to', async () => {
            const { service, messaging, channelToken } = dripWith(NUMBER);
            await (service as any).executeStepAction(TENANT, SCHEMA, enrolment, step);
            expect(messaging.sendTemplate.mock.calls[0][5]).toBe(NUMBER);
            // And the credential is resolved for the same number, not separately:
            // a token from one account with another account's identity is the
            // defect this whole batch exists to close.
            expect(channelToken.getChannelToken).toHaveBeenCalledWith(TENANT, 'whatsapp', NUMBER);
        });

        it('leaves it unset when the conversation names no connection', async () => {
            const { service, messaging, channelToken } = dripWith(null);
            await (service as any).executeStepAction(TENANT, SCHEMA, enrolment, step);
            expect(messaging.sendTemplate.mock.calls[0][5]).toBeUndefined();
            expect(channelToken.getChannelToken).toHaveBeenCalledWith(TENANT, 'whatsapp', undefined);
        });

        it('lends nothing from an enrolment whose conversation is not WhatsApp', async () => {
            const { service, messaging, channelToken } = dripWith('IG_ACCOUNT', 'instagram');
            await (service as any).executeStepAction(TENANT, SCHEMA, enrolment, step);
            expect(messaging.sendTemplate.mock.calls[0][5]).toBeUndefined();
            // And the credential is not resolved for it either: the same wrong
            // id would have picked the same wrong account.
            expect(channelToken.getChannelToken).toHaveBeenCalledWith(TENANT, 'whatsapp', undefined);
        });
    });

    describe('automation rules', () => {
        const processorWith = () => {
            const messaging = { sendTemplate: jest.fn().mockResolvedValue({ success: true, messageId: 'm' }) };
            const processor = new AutomationJobsProcessor(
                {} as any, messaging as any, {} as any, {} as any, {} as any,
            );
            return { processor, messaging };
        };
        const send = async (action: Record<string, unknown>, event: Record<string, unknown>) => {
            const { processor, messaging } = processorWith();
            await (processor as any).handleSendTemplate(SCHEMA,
                { type: 'send_template', template_name: 'welcome', ...action },
                { tenantId: TENANT, schemaName: SCHEMA, leadId: 'l', contactId: 'c',
                    phone: '+573001112233', source: 'whatsapp_inbound', ...event });
            return messaging.sendTemplate.mock.calls[0][5];
        };

        it('bills the number the lead wrote to', async () => {
            expect(await send({}, { channelAccountId: NUMBER, channelAccountType: 'whatsapp' }))
                .toBe(NUMBER);
        });

        it.each(['instagram', 'messenger', 'telegram'])(
            'lends nothing from a %s lead, even though the id looks fine', async channel => {
                // Reproduced by the review: an Instagram event ended up with
                // `IG_ACCOUNT` as a WhatsApp `fromPhoneNumberId`.
                expect(await send({}, {
                    channelAccountId: 'IG_ACCOUNT', channelAccountType: channel, channel,
                })).toBeUndefined();
            });

        it('falls back to the event channel when the account type was not carried', async () => {
            // Older events in a queue have no `channelAccountType`. The channel
            // field is the next best thing, and it is still not "assume WhatsApp".
            expect(await send({}, { channelAccountId: 'IG_ACCOUNT', channel: 'instagram' }))
                .toBeUndefined();
            expect(await send({}, { channelAccountId: NUMBER, channel: 'whatsapp' })).toBe(NUMBER);
        });

        it('lets the rule override it, which is the only answer for a form lead', async () => {
            // A lead from a landing form arrived through no connection, so the
            // event cannot name one and the rule has to. The same override is
            // what answers an Instagram lead over WhatsApp.
            expect(await send({ channel_account_id: '15559998888' },
                { channelAccountId: NUMBER, channelAccountType: 'whatsapp' }))
                .toBe('15559998888');
            expect(await send({ channel_account_id: '15559998888' },
                { channelAccountId: 'IG_ACCOUNT', channelAccountType: 'instagram' }))
                .toBe('15559998888');
            expect(await send({ channel_account_id: '15559998888' }, {})).toBe('15559998888');
        });

        it('leaves it unset when neither the rule nor the lead names one', async () => {
            expect(await send({}, {})).toBeUndefined();
            expect(await send({ channel_account_id: '  ' }, {})).toBeUndefined();
        });
    });

    describe('the three sends that could not name a sender at all', () => {
        // `sendInteractiveMessage`, `sendMediaMessage` and `sendLocationMessage`
        // took no sender parameter, so `whatsapp.controller` had no way to supply
        // one even when the operator knew which number they meant.
        const messagingWith = () => {
            const getValidAccessToken = jest.fn().mockResolvedValue({
                accessToken: 't', phoneNumberId: NUMBER, channelId: 'ch', wabaId: 'w',
            });
            // prisma, httpService, connectionService, spendGate.
            const service = new WhatsappMessagingService(
                { executeInTenantSchema: jest.fn().mockResolvedValue([]) } as any,
                { post: jest.fn().mockReturnValue({ subscribe: jest.fn() }) } as any,
                { getValidAccessToken } as any,
                permissiveSpendGate(),
            );
            // The transport is not the subject here; the resolver argument is.
            (service as any).sendToMeta = jest.fn().mockResolvedValue({ success: true, messageId: 'm' });
            return { service, getValidAccessToken };
        };

        it('carries the sender into the interactive send', async () => {
            const { service, getValidAccessToken } = messagingWith();
            await service.sendInteractiveMessage(SCHEMA, '+573001112233',
                { type: 'button', body: { text: 'hola' }, action: {} }, undefined, NUMBER);
            expect(getValidAccessToken).toHaveBeenCalledWith(SCHEMA, NUMBER);
        });

        it('carries the sender into the media send', async () => {
            const { service, getValidAccessToken } = messagingWith();
            await service.sendMediaMessage(SCHEMA, '+573001112233', 'image', 'https://x/y.jpg',
                undefined, undefined, undefined, NUMBER);
            expect(getValidAccessToken).toHaveBeenCalledWith(SCHEMA, NUMBER);
        });

        it('carries the sender into the location send', async () => {
            const { service, getValidAccessToken } = messagingWith();
            await service.sendLocationMessage(SCHEMA, '+573001112233', 4.6, -74.1,
                undefined, undefined, undefined, NUMBER);
            expect(getValidAccessToken).toHaveBeenCalledWith(SCHEMA, NUMBER);
        });

        it('still asks unnamed when no sender is given, so one number keeps working', async () => {
            const { service, getValidAccessToken } = messagingWith();
            await service.sendLocationMessage(SCHEMA, '+573001112233', 4.6, -74.1);
            expect(getValidAccessToken).toHaveBeenCalledWith(SCHEMA, undefined);
        });
    });
});
