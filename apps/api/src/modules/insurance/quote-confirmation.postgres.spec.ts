import { randomUUID } from 'crypto';
import { InsuranceService } from './insurance.service';
import {
    CONFIRMS_ACCOUNT, SILENT_ACCOUNT, productionTableDdl,
    startConfirmationHarness, type ConfirmationHarness,
} from '../email-templates/__fixtures__/confirmation-harness';

/**
 * ═══ A QUOTE IS A QUOTE ═══
 *
 * `tools.insurance.emailConfirmations` was declared by the contract, drawn as a
 * switch by the editor — which names `insurance_quote_confirmation` — and read
 * by NOTHING.
 *
 * The event is the quote being ISSUED, and that is the whole honesty question
 * here: the row is written `sent`, not `accepted`, and the template says a
 * premium was calculated and a formal proposal is coming. No policy is bound
 * and the email must not imply one.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the insurance quote confirmation', () => {
    let h: ConfirmationHarness;
    let insurance: InsuranceService;
    jest.setTimeout(180_000);

    const AGENT_CONFIRMS = randomUUID();
    const AGENT_SILENT = randomUUID();

    beforeAll(async () => {
        h = await startConfirmationHarness('quoteconfirm', {
            ddl: [
                productionTableDdl('insurance_plans'),
                productionTableDdl('insurance_quotes'),
                'ALTER TABLE insurance_quotes ADD COLUMN IF NOT EXISTS conversation_id UUID',
            ],
            tables: ['insurance_quotes', 'insurance_plans'],
        });
        insurance = new InsuranceService(h.prisma, h.confirmations);
    });
    afterAll(async () => { if (h) await h.teardown(); });

    beforeEach(async () => {
        await h.reset();
        await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT,
            { insurance: { enabled: true, emailConfirmations: true } });
        await h.saveAgent(AGENT_SILENT, SILENT_ACCOUNT,
            { insurance: { enabled: true, emailConfirmations: false } });
    });

    const quote = async (account: string | null, applicantEmail?: string | null) => {
        const customer = await h.customer(account);
        const planId = randomUUID();
        await h.query(`INSERT INTO insurance_plans(id,name,insurance_type,coverage_level,
                monthly_premium_min,monthly_premium_max,currency,min_age,max_age,is_active)
            VALUES($1::uuid,'Auto Todo Riesgo','auto','premium',90000,190000,'COP',18,75,true)`,
            [planId]);
        const issued = await insurance.createQuote(h.schema, {
            contactId: customer.contactId,
            planId,
            applicantName: 'Ana',
            applicantAge: 34,
            applicantEmail: applicantEmail ?? undefined,
            conversationId: customer.conversationId,
        });
        return { ...customer, issued };
    };

    it('confirms a quote issued on the agent that confirms, with the plan facts', async () => {
        const { issued } = await quote(CONFIRMS_ACCOUNT);

        expect(issued.status).toBe('sent');
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
        const [schema, slug, to, variables] = h.renderAndSend.mock.calls[0];
        expect({ schema, slug, to }).toEqual({
            schema: h.schema, slug: 'insurance_quote_confirmation', to: 'ana@example.com',
        });
        expect(variables.service_name).toBe('Auto Todo Riesgo');
        expect(variables.appointment_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(variables.appointment_time).toMatch(/^\d{2}:\d{2}$/);
    });

    it('stays silent for a quote issued on the agent whose switch is off', async () => {
        const { issued } = await quote(SILENT_ACCOUNT);

        expect(issued.status).toBe('sent');
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('records the thread on the quote, which is what names the agent', async () => {
        const { conversationId, issued } = await quote(CONFIRMS_ACCOUNT);
        const rows = await h.query('SELECT conversation_id FROM insurance_quotes WHERE id=$1::uuid',
            [issued.id]);
        expect(rows[0].conversation_id).toBe(conversationId);
    });

    it('writes to the address the applicant dictated, over the contact record', async () => {
        await quote(CONFIRMS_ACCOUNT, 'solicitante@example.com');
        expect(h.renderAndSend.mock.calls[0][2]).toBe('solicitante@example.com');
    });

    it('confirms a quote raised by a broker with no thread at all', async () => {
        await quote(null);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
    });
});
