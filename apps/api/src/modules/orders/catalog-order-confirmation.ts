import type { OperationConfirmationService } from '../email-templates/operation-confirmation.service';
import { escapeReceiptHtml, receiptMoney } from '../email-templates/receipt-format.util';

/**
 * ═══ THE ORDER CONFIRMATION THE SWITCH PROMISED AND NOBODY SENT ═══
 *
 * `tools.orders.emailConfirmations` is declared by the business-profile
 * contract, rendered by the agent editor as a switch that names the template it
 * governs — `order_confirmation` — and was read by NOTHING. The template was
 * seeded into every tenant on first access and never rendered once. So an owner
 * could switch order confirmations on, the screen would say they had, and no
 * customer ever received one; switching it off changed nothing either, which is
 * the worse half, because the screen still said it did something.
 *
 * ── WHICH FAMILY'S SWITCH, GIVEN THAT `catalog` WRITES THE ORDER ────────────
 *
 * `place_catalog_order` belongs to the `catalog` family, and `catalog` declares
 * no `emailConfirmations` at all. The OBJECT the operation produces is an
 * order, and `orders` is the family the contract gives an email switch to — the
 * same pairing the editor makes when it puts `order_confirmation` under the
 * Pedidos card. So `orders` is the switch, and there is no nearer one to
 * prefer: the list is `['orders']` and not a guess between two candidates.
 *
 * ── WHEN, EXACTLY ───────────────────────────────────────────────────────────
 *
 * When the order first reaches `confirmed` (or is created already at
 * `confirmed`/`paid` by a person in the dashboard) — never at `pending`.
 * An agent-placed order is created `pending` on purpose, because a request the
 * business has not accepted yet is not an accepted order; the seeded template
 * says "Pedido Confirmado", and sending it over a pending row would be the
 * product asserting a commercial outcome that has not happened.
 *
 * The once-only guarantee comes from the transition itself: `advance` commits
 * `pending → confirmed` under a row lock and answers `null` when the row was
 * already there, so a repeated call cannot produce a second email. From October
 * every repeat is also a charge, so "at most once" matters as much as "at all".
 *
 * Everything ABOUT WHETHER TO SEND — the schema's owner, the recipient, the
 * switch, the language — is `OperationConfirmationService`'s single decision.
 * What is left here is what only an order knows: its money and its lines.
 */

/** The facts a confirmation needs, read from the order row that just committed. */
export interface CatalogOrderNotice {
    readonly orderId: string;
    readonly contactId: string | null;
    readonly conversationId: string | null;
    readonly totalAmountCents: string;
    readonly currency: string;
    readonly paymentMethod: string;
    readonly items: ReadonlyArray<{
        readonly productName: string;
        readonly quantity: number;
        readonly totalPrice: number;
    }>;
}

export class CatalogOrderConfirmations {
    constructor(private readonly confirmations: OperationConfirmationService) {}

    async send(schema: string, notice: CatalogOrderNotice): Promise<void> {
        await this.confirmations.send({
            schemaName: schema,
            families: ['orders'],
            slug: 'order_confirmation',
            conversationId: notice.conversationId,
            contactId: notice.contactId,
            operation: `catalog order ${notice.orderId}`,
            variables: {
                order_id: notice.orderId,
                order_items_html: this.itemsHtml(notice),
                order_total: this.total(notice),
                payment_method: notice.paymentMethod,
            },
        });
    }

    /** Product names come from the tenant's own catalogue, so they are escaped. */
    private itemsHtml(notice: CatalogOrderNotice): string {
        return notice.items.map(item =>
            `<p style="margin:4px 0;font-size:14px;">${escapeReceiptHtml(item.productName)} `
            + `&times; ${escapeReceiptHtml(item.quantity)} — `
            + `${escapeReceiptHtml(receiptMoney(item.totalPrice, notice.currency))}</p>`,
        ).join('');
    }

    /** From the CENTS the writer froze, never from a re-multiplied float. */
    private total(notice: CatalogOrderNotice): string {
        const cents = Number(notice.totalAmountCents);
        return receiptMoney(Number.isFinite(cents) ? cents / 100 : 0, notice.currency);
    }
}
