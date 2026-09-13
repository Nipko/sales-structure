import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from './email-templates.service';
import {
    emailConfirmationsForOperation,
    type ConfirmationFamilies,
} from '../../common/utils/served-confirmation-policy.util';

/**
 * ═══ ONE PLACE THAT DECIDES WHETHER A CUSTOMER RECEIPT GOES OUT ═══
 *
 * Nine `emailConfirmations` controls needed the same five-step decision, in
 * nine writers across nine modules. Written nine times it would have drifted
 * nine ways — and the first two copies already had: one read the tenant with a
 * raw `$queryRaw`, the other with the Prisma client, and only one of them
 * survived its own mutation test, because the other's language read crashed
 * before the guard could be observed refusing.
 *
 * So the decision lives here once, with the refusal REPORTED rather than
 * logged-and-swallowed: "no email went out" has five different causes and only
 * one of them is the owner's switch. A caller that cannot tell them apart
 * cannot explain itself to the owner, and neither can a test.
 */

/** Why nothing was sent — or that it was. Never a bare boolean. */
export type OperationConfirmationOutcome =
    /** Handed to the transport. Not proof of delivery; `renderAndSend` is a boolean. */
    | 'sent'
    /** No active tenant owns this schema. An isolated evaluation's clone lands here. */
    | 'schema_unowned'
    /** Nobody to write to: no contact, or a contact with no address. */
    | 'no_recipient'
    /** The agent that served the operation has this family's switch off. */
    | 'switched_off'
    /** The template is missing, or the transport refused. The operation stands. */
    | 'failed';

export interface OperationConfirmationInput {
    readonly schemaName: string;
    /**
     * The families whose `emailConfirmations` govern this operation, nearest
     * first. One entry for a family that owns its own writer; two when the
     * operation belongs to two, as an appointment-shaped one does.
     */
    readonly families: ConfirmationFamilies;
    /** The tenant template that describes THIS operation, and no other. */
    readonly slug: string;
    /** The thread the operation originated in, when it originated in one. */
    readonly conversationId: string | null | undefined;
    readonly contactId: string | null | undefined;
    /** An address the operation itself captured; preferred over the contact's. */
    readonly email?: string | null;
    readonly variables: Record<string, string>;
    /** What to call the operation in the log, e.g. `class booking 9f2…`. */
    readonly operation: string;
}

/** The four languages the seeded templates carry; anything else reads as `es`. */
const LANGUAGES = new Set(['es', 'en', 'pt', 'fr']);

@Injectable()
export class OperationConfirmationService {
    private readonly logger = new Logger(OperationConfirmationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailTemplates: EmailTemplatesService,
    ) {}

    /**
     * Send the receipt, or decide honestly not to.
     *
     * Never throws. Every caller is a writer that has ALREADY committed: an
     * unreachable mail server must not turn a placed order, a booked class or
     * an approved rental into a failed operation, and an operation that rolled
     * back must never have produced a receipt — which is why every caller
     * invokes this after its transaction, not inside it.
     */
    async send(input: OperationConfirmationInput): Promise<OperationConfirmationOutcome> {
        const schema = String(input.schemaName ?? '').trim();
        if (!schema) return 'failed';
        try {
            // ── A SCHEMA NO REGISTERED TENANT OWNS IS NOT A CUSTOMER ────────
            //
            // An isolated evaluation runs the real writer inside a CLONE of the
            // tenant schema (`tenant_eval_*`), and that clone has no row in
            // `public.tenants`. Keying the refusal on OWNERSHIP rather than on
            // the schema's name is deliberate in both directions: a production
            // caller can never lose a customer's receipt by looking like a
            // test, and an evaluation can never mail a real address by being
            // named well.
            const owner = await this.prisma.tenant.findFirst({
                where: { schemaName: schema, isActive: true },
                select: { id: true, language: true },
            });
            if (!owner) {
                this.logger.warn(`No active tenant owns ${schema} — ${input.operation} `
                    + 'produced no confirmation email');
                return 'schema_unowned';
            }

            const query = <T>(sql: string, params: any[] = []) =>
                this.prisma.executeInTenantSchema<T>(schema, sql, params);

            const to = await this.recipient(query, input);
            // Not a refusal worth logging loudly: most customers reached over a
            // messaging channel have a phone and no address at all.
            if (!to.email) return 'no_recipient';

            // ── THE OWNER'S SWITCH, ON THE AGENT THAT SERVED THE OPERATION ──
            //
            // Resolved from the thread the operation originated in, so on a
            // tenant with two connections the answer is the one the owner set
            // on the agent that served the customer — never whichever active
            // agent an unordered `LIMIT 1` happened to return. An operation
            // raised from the dashboard has no thread, no serving agent, and is
            // confirmed: an absent configuration has never meant "off".
            if (!await emailConfirmationsForOperation(query, input.families, input.conversationId)) {
                this.logger.log(`${input.families[0]}.emailConfirmations is off for the agent `
                    + `that served ${input.operation} — no confirmation email`);
                return 'switched_off';
            }

            // Read AFTER the guards and defensively, so the ownership guard
            // above is the only thing standing between an unowned schema and a
            // sent email. Dereferencing `owner` eagerly made deleting that
            // guard produce a TypeError instead of a send, and the test meant
            // to pin it survived its own mutation.
            const raw = String(owner?.language ?? 'es').slice(0, 2).toLowerCase();
            const lang = LANGUAGES.has(raw) ? raw : 'es';

            const delivered = await this.emailTemplates.renderAndSend(
                schema, input.slug, to.email,
                { customer_name: to.name || 'Cliente', ...input.variables },
                lang,
            );
            // `renderAndSend` answers `false` for a missing template and for a
            // transport that refused. Reporting that as `sent` is the same lie
            // as a flag written for a message that never left.
            if (!delivered) {
                this.logger.warn(`The transport did not accept "${input.slug}" for `
                    + `${input.operation}`);
                return 'failed';
            }
            return 'sent';
        } catch (error: any) {
            this.logger.warn(`Confirmation email failed for ${input.operation}: ${error?.message}`);
            return 'failed';
        }
    }

    /**
     * Who the receipt is for.
     *
     * The address the customer dictated during the operation counts as much as
     * the one on the contact record, and is often the only one there is — an
     * enrolment captures `student_email`, a quote captures `applicant_email`.
     * The NAME still comes from the contact when there is one, because that is
     * the name the business knows them by.
     */
    private async recipient(
        query: <T>(sql: string, params?: any[]) => Promise<T>,
        input: OperationConfirmationInput,
    ): Promise<{ email: string; name: string }> {
        const captured = String(input.email ?? '').trim();
        const contactId = String(input.contactId ?? '').trim();
        if (!contactId) return { email: captured, name: '' };
        const rows = await query<any[]>(
            'SELECT name, email FROM contacts WHERE id = $1::uuid LIMIT 1', [contactId],
        );
        const row = rows?.[0];
        return {
            email: captured || String(row?.email ?? '').trim(),
            name: String(row?.name ?? '').trim(),
        };
    }
}
