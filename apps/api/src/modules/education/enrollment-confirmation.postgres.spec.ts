import { randomUUID } from 'crypto';
import { EducationEnrollmentCommands } from './education-enrollment-commands';
import {
    CONFIRMS_ACCOUNT, SILENT_ACCOUNT, productionTableDdl,
    startConfirmationHarness, type ConfirmationHarness,
} from '../email-templates/__fixtures__/confirmation-harness';

/**
 * ═══ A SEAT ASSIGNED, AND A WAITLIST THAT IS NOT ONE ═══
 *
 * `tools.education.emailConfirmations` was declared by the contract, drawn as a
 * switch by the editor — which names `education_enrollment_confirmation` — and
 * read by NOTHING.
 *
 * `enroll` produces `enrolled` OR `waitlisted` depending on the cohort's
 * remaining seats, and only the first is a place in the course. The other
 * thing this suite pins is the recipient: an enrolment captures its own
 * `student_email`, which for a parent enrolling a child is often the only
 * address the school was given.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the enrolment confirmation', () => {
    let h: ConfirmationHarness;
    let education: EducationEnrollmentCommands;
    jest.setTimeout(180_000);

    const AGENT_CONFIRMS = randomUUID();
    const AGENT_SILENT = randomUUID();

    beforeAll(async () => {
        h = await startConfirmationHarness('enrolconfirm', {
            ddl: [
                productionTableDdl('courses'),
                productionTableDdl('course_cohorts'),
                productionTableDdl('enrollments'),
                'ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS conversation_id UUID',
            ],
            tables: ['enrollments', 'course_cohorts', 'courses'],
        });
        education = new EducationEnrollmentCommands(h.prisma, h.confirmations);
    });
    afterAll(async () => { if (h) await h.teardown(); });

    beforeEach(async () => {
        await h.reset();
        await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT,
            { education: { enabled: true, emailConfirmations: true } });
        await h.saveAgent(AGENT_SILENT, SILENT_ACCOUNT,
            { education: { enabled: true, emailConfirmations: false } });
    });

    const enroll = async (account: string | null, over: {
        seats?: number; studentEmail?: string | null; allowWaitlist?: boolean;
    } = {}) => {
        const customer = await h.customer(account);
        const courseId = randomUUID();
        const cohortId = randomUUID();
        await h.query(`INSERT INTO courses(id,name,slug,price,currency,is_active)
            VALUES($1::uuid,'Inglés B1',$2,450000,'COP',true)`, [courseId, `ingles-${cohortId}`]);
        await h.query(`INSERT INTO course_cohorts(id,course_id,cohort_code,instructor_name,
                starts_at,schedule,max_capacity,available_seats,room,status)
            VALUES($1::uuid,$2::uuid,'2026-B1','Laura',
                (CURRENT_DATE + 30),'Lun-Mie 18:00-20:00',20,$3,'Aula 4','open')`,
            [cohortId, courseId, over.seats ?? 5]);
        const enrollment = await education.enroll(h.schema, {
            cohortId,
            contactId: customer.contactId,
            studentName: 'Ana',
            studentEmail: over.studentEmail === undefined ? undefined : over.studentEmail ?? undefined,
            allowWaitlist: over.allowWaitlist,
            conversationId: customer.conversationId,
        });
        return { ...customer, cohortId, enrollment };
    };

    it('confirms a seat assigned on the agent that confirms, with the cohort facts', async () => {
        const { enrollment } = await enroll(CONFIRMS_ACCOUNT);

        expect(enrollment.seatAssigned).toBe(true);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
        const [schema, slug, to, variables] = h.renderAndSend.mock.calls[0];
        expect({ schema, slug, to }).toEqual({
            schema: h.schema, slug: 'education_enrollment_confirmation', to: 'ana@example.com',
        });
        expect(variables).toMatchObject({
            service_name: 'Inglés B1',
            // The cohort's timetable is the only "time" an enrolment has.
            appointment_time: 'Lun-Mie 18:00-20:00',
            location: 'Aula 4',
            agent_name: 'Laura',
        });
        expect(variables.appointment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('stays silent for a seat assigned on the agent whose switch is off', async () => {
        const { enrollment } = await enroll(SILENT_ACCOUNT);

        expect(enrollment.seatAssigned).toBe(true);
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('records the thread on the enrolment, which is what names the agent', async () => {
        const { conversationId, enrollment } = await enroll(CONFIRMS_ACCOUNT);
        const rows = await h.query('SELECT conversation_id FROM enrollments WHERE id=$1::uuid',
            [enrollment.id]);
        expect(rows[0].conversation_id).toBe(conversationId);
    });

    it('does not tell a waitlisted student they have a seat', async () => {
        // No seats, on the agent that confirms: the refusal is the waitlist.
        const { enrollment } = await enroll(CONFIRMS_ACCOUNT, { seats: 0, allowWaitlist: true });

        expect(enrollment.waitlisted).toBe(true);
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('writes to the address the enrolment captured, over the contact record', async () => {
        await enroll(CONFIRMS_ACCOUNT, { studentEmail: 'estudiante@example.com' });
        expect(h.renderAndSend.mock.calls[0][2]).toBe('estudiante@example.com');
    });

    it('does not send a second receipt when the same student enrols again', async () => {
        const { cohortId, contactId, conversationId } = await enroll(CONFIRMS_ACCOUNT);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);

        const replay = await education.enroll(h.schema, {
            cohortId, contactId, studentName: 'Ana', conversationId,
        });

        expect(replay.idempotentReplay).toBe(true);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
    });
});
