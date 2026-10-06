import { randomUUID } from 'crypto';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-C03 — DEFECT (red on purpose). The reminder sweep marks an
 * appointment as reminded (`reminder_24h_sent = true`) for a Telegram contact
 * although the reminder is a WhatsApp template that is never sent to Telegram:
 * `sendReminderTemplate` returns early for non-WhatsApp contacts and
 * `processReminders` writes the flag afterwards anyway.
 *
 * The product's own rule for that flag (appointment-reminders.service.ts, the
 * block comment above `dispatchTemplate`): "reminder_24h_sent means the customer
 * was told ... the flag follows the effect, never the attempt".
 *
 * Oracle: the flag column and the outbox, for a Telegram and a WhatsApp contact.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 DEFECT AUT-C03: a Telegram contact is marked reminded without a reminder', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    const SENDER = '15550001111';

    beforeAll(async () => {
        lane = await openLane('n3remtg', [
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
        for (const name of ['appointment_reminder', 'attendance_check']) {
            await lane.sql("INSERT INTO whatsapp_templates(channel_id,name,approval_status,category) VALUES($1::uuid,$2,'APPROVED','utility')", [channel.id, name]);
        }
        service = Object.create(AppointmentRemindersService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            whatsappTemplates: { getTemplateByName: async () => ({ approval_status: 'APPROVED' }) },
            appointmentsService: { getReminderSettings: async () => ({ reminder24h: true, reminder2h: true }) },
            emailTemplates: { renderAndSend: async () => undefined },
            regionalProfile: { timezoneFor: async () => 'America/Bogota', timezoneForSchema: async () => 'America/Bogota' },
            eventEmitter: { emit: () => undefined },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.assertTenantCanSend = async () => undefined;
        service.getTenantLanguage = async () => 'es';
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => { await lane.sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE'); });

    const appointmentFor = async (channel: 'whatsapp' | 'telegram') => {
        const contactId = randomUUID(), conversationId = randomUUID(), id = randomUUID();
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, `Cliente ${channel}`, '+573001112233', channel]);
        await lane.sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,$3,$4)`,
            [conversationId, contactId, channel, channel === 'whatsapp' ? SENDER : 'telegram-bot-1']);
        await lane.sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,start_at,end_at,status,reminder_24h_sent,reminder_2h_sent)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',(NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',
                   (NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours','confirmed',false,false)`, [id, contactId, conversationId]);
        return { id, contactId };
    };
    const flag = async (id: string) => (await lane.sql('SELECT reminder_24h_sent AS v FROM appointments WHERE id=$1::uuid', [id]))[0].v;

    it('AUT-C03: WhatsApp contact: one template row and the flag set (control)', async () => {
        const wa = await appointmentFor('whatsapp');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        expect((await lane.outboxRows()).filter((r: any) => r.contact_id === wa.contactId)).toHaveLength(1);
        expect(await flag(wa.id)).toBe(true);
    });

    it('AUT-C03: Telegram contact: no template is sent, so the appointment must NOT be marked reminded', async () => {
        const tg = await appointmentFor('telegram');
        await service.processReminders(lane.tenantId, lane.schema, '24h');
        const rows = (await lane.outboxRows()).filter((r: any) => r.contact_id === tg.contactId);
        const marked = await flag(tg.id);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-C03] telegramOutboxRows=${rows.length} reminder_24h_sent=${marked}`);
        // The flag may be set only if the customer was told: an effect exists.
        expect(marked === true ? rows.length > 0 : true).toBe(true);
    });
});
