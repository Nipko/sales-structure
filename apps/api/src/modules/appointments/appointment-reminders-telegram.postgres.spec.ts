import { randomUUID } from 'crypto';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-C03 — what the reminder sweep does for a contact that is not on
 * WhatsApp, now that the flag follows the effect.
 *
 *   Telegram   a plain-text reminder goes through the durable lane (Telegram has no
 *              template catalogue and no service window), once per appointment and
 *              kind, and only then is `reminder_24h_sent` written.
 *   other      a channel with no reminder message (Instagram, ...) is NOT flagged.
 *   no sender  a Telegram appointment with no conversation has no bot to speak as:
 *              nothing is written and the flag stays false.
 *   template   a WhatsApp contact whose `appointment_reminder` template is not
 *              approved is not flagged either.
 *
 * Oracle: the flag column and the outbox, never the return value.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-C03: reminders and the flag, by channel', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let emailSent: jest.Mock;
    const SENDER = '15550001111';

    beforeAll(async () => {
        lane = await openLane('n3remtx', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
                start_at TIMESTAMP, end_at TIMESTAMP, location TEXT, metadata JSONB DEFAULT '{}', assigned_to TEXT,
                customer_name TEXT, customer_email TEXT, status TEXT, reminder_24h_sent BOOLEAN DEFAULT false,
                reminder_2h_sent BOOLEAN DEFAULT false, updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE whatsapp_channels(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone_number_id TEXT, meta_waba_id TEXT,
                channel_status TEXT DEFAULT 'connected', connected_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE whatsapp_templates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE, name TEXT NOT NULL,
                language TEXT DEFAULT 'es', category TEXT, approval_status TEXT DEFAULT 'PENDING', last_sync_at TIMESTAMPTZ)`,
            'CREATE TABLE agent_personas(id UUID PRIMARY KEY, is_active BOOLEAN, version INT)',
        ]);
        const [channel] = await lane.sql("INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id) VALUES($1,'waba-1') RETURNING id", [SENDER]);
        await lane.sql("INSERT INTO whatsapp_templates(channel_id,name,approval_status,category) VALUES($1::uuid,'appointment_reminder','APPROVED','utility')", [channel.id]);
        emailSent = jest.fn(async () => undefined);
        service = Object.create(AppointmentRemindersService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            whatsappTemplates: { getTemplateByName: async () => ({ approval_status: 'APPROVED' }) },
            appointmentsService: { getReminderSettings: async () => ({ reminder24h: true, reminder2h: true }) },
            emailTemplates: { renderAndSend: emailSent },
            regionalProfile: { timezoneFor: async () => 'America/Bogota', timezoneForSchema: async () => 'America/Bogota' },
            eventEmitter: { emit: () => undefined },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.assertTenantCanSend = async () => undefined;
        service.getTenantLanguage = async () => 'es';
        service.appointmentEmailsEnabled = async () => true;
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        emailSent.mockClear();
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
    });

    const appointmentFor = async (channel: string, opts: { conversation?: boolean; email?: string; phone?: string | null; chatId?: string | null } = {}) => {
        const contactId = randomUUID(), conversationId = randomUUID(), id = randomUUID();
        // A Telegram contact is addressed by its chat id (`external_id`); a phone is optional there.
        const chatId = opts.chatId === undefined ? (channel === 'telegram' ? `tg-${contactId.slice(0, 8)}` : null) : opts.chatId;
        await lane.sql('INSERT INTO contacts(id,name,phone,email,channel_type,external_id) VALUES($1::uuid,$2,$3,$4,$5,$6)',
            [contactId, `Cliente ${channel}`, opts.phone === undefined ? '+573001112233' : opts.phone, opts.email ?? null, channel, chatId]);
        const withConversation = opts.conversation !== false;
        if (withConversation) {
            await lane.sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,$3,$4)`,
                [conversationId, contactId, channel, channel === 'whatsapp' ? SENDER : `${channel}-bot-1`]);
        }
        await lane.sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,start_at,end_at,status,reminder_24h_sent,reminder_2h_sent)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',(NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',
                   (NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours','confirmed',false,false)`,
        [id, contactId, withConversation ? conversationId : null]);
        return { id, contactId, chatId };
    };
    const flag = async (id: string) => (await lane.sql('SELECT reminder_24h_sent AS v FROM appointments WHERE id=$1::uuid', [id]))[0].v;
    const rowsFor = async (contactId: string) => (await lane.outboxRows()).filter((r: any) => r.contact_id === contactId);
    const recipientOf = async (contactId: string) => (await lane.sql('SELECT recipient FROM agent_dispatch_outbox WHERE contact_id=$1::uuid', [contactId]))[0]?.recipient;

    it('Telegram: one text row naming the appointment, then the flag', async () => {
        const tg = await appointmentFor('telegram');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        const rows = await rowsFor(tg.contactId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ item_kind: 'text', channel_account_id: 'telegram-bot-1' });
        expect(JSON.stringify(rows[0].payload)).toContain('Consulta');
        expect(await flag(tg.id)).toBe(true);
    });

    it('Telegram: the recipient is the chat id, never the phone', async () => {
        const tg = await appointmentFor('telegram');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await recipientOf(tg.contactId)).toBe(tg.chatId);
    });

    it('Telegram contact WITHOUT a phone is still reminded, to its chat id', async () => {
        const tg = await appointmentFor('telegram', { phone: null });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await recipientOf(tg.contactId)).toBe(tg.chatId);
        expect(await flag(tg.id)).toBe(true);
    });

    it('Telegram contact with a phone but no chat id: no address, nothing written, flag stays false', async () => {
        const tg = await appointmentFor('telegram', { chatId: null });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await rowsFor(tg.contactId)).toHaveLength(0);
        expect(await flag(tg.id)).toBe(false);
    });

    it('a refused message does not swallow the email: the email goes out and settles the flag', async () => {
        // No Telegram thread, so the lane refuses; the contact also has an email.
        const tg = await appointmentFor('telegram', { conversation: false, email: 'tg@example.invalid' });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await rowsFor(tg.contactId)).toHaveLength(0);
        expect(emailSent).toHaveBeenCalledTimes(1);
        expect(await flag(tg.id)).toBe(true);
    });

    it('Telegram: a second sweep finds its own row and writes no second reminder', async () => {
        const tg = await appointmentFor('telegram');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        await lane.sql('UPDATE appointments SET reminder_24h_sent = false WHERE id=$1::uuid', [tg.id]);
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await rowsFor(tg.contactId)).toHaveLength(1);
        expect(await flag(tg.id)).toBe(true);
    });

    it('Telegram without a conversation: no bot to speak as, nothing written, flag stays false', async () => {
        const tg = await appointmentFor('telegram', { conversation: false });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await rowsFor(tg.contactId)).toHaveLength(0);
        expect(await flag(tg.id)).toBe(false);
    });

    it('Instagram: there is no reminder message for the channel, so the flag stays false', async () => {
        const ig = await appointmentFor('instagram');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await rowsFor(ig.contactId)).toHaveLength(0);
        expect(await flag(ig.id)).toBe(false);
    });

    it('Instagram contact WITH an email: the email is the effect, so it is flagged', async () => {
        const ig = await appointmentFor('instagram', { email: 'ig@example.invalid' });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(emailSent).toHaveBeenCalledTimes(1);
        expect(await flag(ig.id)).toBe(true);
    });

    it('Instagram contact whose email fails: nothing reached them, so the flag stays false', async () => {
        emailSent.mockRejectedValueOnce(new Error('smtp down'));
        const ig = await appointmentFor('instagram', { email: 'ig@example.invalid' });
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect(await flag(ig.id)).toBe(false);
    });

    it('WhatsApp without an approved template: nothing sent, so not flagged', async () => {
        await lane.sql("UPDATE whatsapp_templates SET approval_status='REJECTED' WHERE name='appointment_reminder'");
        try {
            const wa = await appointmentFor('whatsapp');
            await service.processReminders(lane.tenantId, lane.schema, '24h');
            expect(await rowsFor(wa.contactId)).toHaveLength(0);
            expect(await flag(wa.id)).toBe(false);
        } finally {
            await lane.sql("UPDATE whatsapp_templates SET approval_status='APPROVED' WHERE name='appointment_reminder'");
        }
    });
});
