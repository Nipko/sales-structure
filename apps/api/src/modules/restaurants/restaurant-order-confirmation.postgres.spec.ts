import { randomUUID } from 'crypto';
import { RestaurantsService } from './restaurants.service';
import {
    CONFIRMS_ACCOUNT, SILENT_ACCOUNT, productionTableDdl,
    startConfirmationHarness, type ConfirmationHarness,
} from '../email-templates/__fixtures__/confirmation-harness';

/**
 * ═══ A FOOD ORDER, NOT A TABLE ═══
 *
 * `tools.restaurants.emailConfirmations` was read by nothing, and the editor
 * pointed it at `restaurant_reservation_confirmation` — "Tu Mesa está
 * Reservada", with an hour and a 15-minute tolerance. The only writer in this
 * family produces a FOOD ORDER; table reservations go through the appointments
 * module. Wiring the control to that template would have promised customers a
 * table nobody booked, so `restaurant_order_confirmation` was built for the
 * operation that actually exists.
 *
 * The assertions therefore check the SLUG as hard as the switch.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the restaurant order confirmation', () => {
    let h: ConfirmationHarness;
    let restaurants: RestaurantsService;
    jest.setTimeout(180_000);

    const AGENT_CONFIRMS = randomUUID();
    const AGENT_SILENT = randomUUID();

    beforeAll(async () => {
        h = await startConfirmationHarness('foodconfirm', {
            ddl: [
                productionTableDdl('food_orders'),
                productionTableDdl('food_order_items'),
                'CREATE TABLE leads(id UUID PRIMARY KEY, contact_id UUID)',
                `CREATE TABLE opportunities(id UUID PRIMARY KEY, lead_id UUID,
                    conversation_id UUID, won_at TIMESTAMPTZ, lost_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW())`,
                'CREATE TABLE contact_identities(contact_id UUID, customer_profile_id UUID)',
            ],
            tables: ['food_order_items', 'food_orders', 'opportunities', 'leads', 'contact_identities'],
        });
        restaurants = new RestaurantsService(
            h.prisma, { emit: () => undefined } as any, h.confirmations);
    });
    afterAll(async () => { if (h) await h.teardown(); });

    beforeEach(async () => {
        await h.reset();
        await h.saveAgent(AGENT_CONFIRMS, CONFIRMS_ACCOUNT,
            { restaurants: { enabled: true, emailConfirmations: true } });
        await h.saveAgent(AGENT_SILENT, SILENT_ACCOUNT,
            { restaurants: { enabled: true, emailConfirmations: false } });
    });

    const place = async (account: string | null, over: Record<string, any> = {}) => {
        const customer = await h.customer(account);
        const order = await restaurants.createOrder(h.schema, {
            contactId: customer.contactId,
            conversationId: customer.conversationId ?? undefined,
            orderType: 'delivery',
            customerName: 'Ana',
            deliveryAddress: 'Calle 1 #2-3',
            paymentMethod: 'cash',
            currency: 'COP',
            items: [
                { name: 'Bandeja paisa', quantity: 2, unitPrice: 32000, prepTimeMinutes: 20 },
            ],
            ...over,
        } as any);
        return { ...customer, order };
    };

    it('confirms an order placed on the agent that confirms, with the order receipt template', async () => {
        const { order } = await place(CONFIRMS_ACCOUNT);

        expect(order.status).toBe('received');
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
        const [schema, slug, to, variables] = h.renderAndSend.mock.calls[0];
        expect({ schema, slug, to }).toEqual({
            schema: h.schema, slug: 'restaurant_order_confirmation', to: 'ana@example.com',
        });
        // Not the reservation template, under any circumstances.
        expect(slug).not.toBe('restaurant_reservation_confirmation');
        expect(variables).toMatchObject({
            reference: order.id, order_type: 'delivery', delivery_address: 'Calle 1 #2-3',
        });
        expect(variables.order_items_html).toContain('Bandeja paisa');
        expect(variables.order_total).toContain('64.000');
    });

    it('stays silent for an order placed on the agent whose switch is off', async () => {
        const { order } = await place(SILENT_ACCOUNT);

        expect(order.status).toBe('received');
        expect(h.renderAndSend).not.toHaveBeenCalled();
    });

    it('records the thread on the order, which is what names the agent', async () => {
        const { conversationId, order } = await place(CONFIRMS_ACCOUNT);
        const rows = await h.query('SELECT conversation_id FROM food_orders WHERE id=$1::uuid',
            [order.id]);
        expect(rows[0].conversation_id).toBe(conversationId);
    });

    it('escapes a menu name the tenant controls', async () => {
        await place(CONFIRMS_ACCOUNT, {
            items: [{ name: '<script>x()</script>', quantity: 1, unitPrice: 1000, prepTimeMinutes: 5 }],
        });
        const html = h.renderAndSend.mock.calls[0][3].order_items_html as string;
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
    });

    it('confirms an order raised with no thread at all', async () => {
        await place(null);
        expect(h.renderAndSend).toHaveBeenCalledTimes(1);
    });
});
