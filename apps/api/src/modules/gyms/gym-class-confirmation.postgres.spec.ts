import { randomUUID } from 'crypto';
import { GymsService } from './gyms.service';
import {
    CONFIRMS_ACCOUNT, SILENT_ACCOUNT, productionTableDdl,
    startConfirmationHarness, type ConfirmationHarness,
} from '../email-templates/__fixtures__/confirmation-harness';

/**
 * ═══ A CONFIRMED CLASS, AND A WAITLIST THAT IS NOT ONE ═══
 *
 * `tools.gyms.emailConfirmations` was declared by the contract, drawn as a
 * switch by the editor — which names `gym_class_confirmation` — and read by
 * NOTHING, so the owner's toggle changed nothing in either direction.
 *
 * Two questions here, and the second is the one that could have shipped a lie:
 * whose switch decides (two connections, opposite answers), and WHEN a receipt
 * is owed. `bookClass` also produces `waitlist` bookings, and telling somebody
 * their spot is confirmed while they are third in line is exactly the class of
 * claim this programme removes.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the gym class confirmation', () => {
    let h: ConfirmationHarness;
    let gyms: GymsService;
    jest.setTimeout(180_000);

    const AGENT_CONFIRMS = randomUUID();
    const AGENT_SILENT = randomUUID();

    beforeAll(async () => {
        h = await startConfirmationHarness('gymconfirm', {
            ddl: [
                productionTableDdl('fitness_classes'),
                productionTableDdl('membership_plans'),
                productionTableDdl('members'),
                productionTableDdl('class_bookings'),
                'ALTER TABLE class_bookings ADD COLUMN IF NOT EXISTS conversation_id UUID',
            ],
            tables: ['class_bookings', 'members', 'fitness_classes', 'membership_plans'],
        });
        gyms = new GymsService(h.prisma, h.confirmations);
    });
    afterAll(async () => { if (h) await h.teardown(); });

    beforeEach(async () => {
        await h.reset();
        await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT,
            { gyms: { enabled: true, emailConfirmations: true } });
        await h.saveAgent(AGENT_SILENT, SILENT_ACCOUNT,
            { gyms: { enabled: true, emailConfirmations: false } });
    });

    /** One class with `spots` places, and one active member with credits. */
    const book = async (account: string | null, spots = 5) => {
        const customer = await h.customer(account);
        const classId = randomUUID();
        const memberId = randomUUID();
        await h.query(`INSERT INTO fitness_classes(id,name,class_type,instructor_name,scheduled_at,
                duration_minutes,max_capacity,available_spots,room,credits_required)
            VALUES($1::uuid,'Yoga matutino','yoga','Sofia',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',60,10,$2,'Sala 2',1)`,
            [classId, spots]);
        await h.query(`INSERT INTO members(id,contact_id,status,class_credits_remaining)
            VALUES($1::uuid,$2::uuid,'active',10)`, [memberId, customer.contactId]);
        const booking = await gyms.bookClass(
            h.schema, classId, memberId, undefined, customer.conversationId);
        return { ...customer, classId, memberId, booking };
    };

    it('confirms a booking taken on the agent that confirms, with the class facts', async () => {
        const { booking } = await book(CONFIRMS_ACCOUNT);

        expect(booking.status).toBe('confirmed');
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
        const [schema, slug, to, variables] = h.renderAndSend.mock.calls[0];
        expect({ schema, slug, to }).toEqual({
            schema: h.schema, slug: 'gym_class_confirmation', to: 'ana@example.com',
        });
        expect(variables).toMatchObject({
            service_name: 'Yoga matutino', location: 'Sala 2', agent_name: 'Sofia',
        });
        expect(variables.appointment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(variables.appointment_time).toMatch(/^\d{2}:\d{2}$/);
    });

    it('stays silent for a booking taken on the agent whose switch is off', async () => {
        const { booking } = await book(SILENT_ACCOUNT);

        expect(booking.status).toBe('confirmed');
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('records the thread on the booking, which is what names the agent', async () => {
        const { conversationId, booking } = await book(CONFIRMS_ACCOUNT);
        const rows = await h.query('SELECT conversation_id FROM class_bookings WHERE id=$1::uuid',
            [booking.id]);
        expect(rows[0].conversation_id).toBe(conversationId);
    });

    it('does not tell a waitlisted member their class is confirmed', async () => {
        // Zero spots, on the agent that confirms: the refusal is the waitlist,
        // not the switch.
        const { booking } = await book(CONFIRMS_ACCOUNT, 0);

        expect(booking.status).toBe('waitlist');
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('does not send a second receipt when the same member books again', async () => {
        const { classId, memberId, conversationId } = await book(CONFIRMS_ACCOUNT);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);

        const replay = await gyms.bookClass(h.schema, classId, memberId, undefined, conversationId);

        expect(replay.idempotentReplay).toBe(true);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
    });

    it('confirms a booking made at the front desk, with no thread at all', async () => {
        // No connection, no serving agent to ask, and the only agents that
        // exist are split — an absent configuration has never meant "off".
        const { booking } = await book(null);

        expect(booking.status).toBe('confirmed');
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
    });
});
