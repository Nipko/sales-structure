import { buildWorld, isolationUrl, type World } from './__fixtures__/n3-money-identity.harness';

/**
 * DEFECT SPEC (kept red on purpose) - get_check_in_instructions.
 *
 * Promise: the street address and the access instructions of a property are given only to a
 * verified guest whose stay is real. A reservation that was never paid (`pending_payment`) or
 * whose payment hold lapsed (`expired`, set by expired-hold-sweeper.service.ts) is not a stay.
 *
 * Cause: ai-tool-executor.service.ts:3896-3905 (getCheckInInstructions) only excludes
 * `status NOT IN ('cancelled','rejected')`, so `pending_payment` and `expired` rows that
 * overlap today pass and the handler returns `address`, `checkInInstructions` and `houseRules`.
 */
(isolationUrl ? describe : describe.skip)('DEFECT N3: check-in instructions released for unpaid / expired bookings', () => {
    jest.setTimeout(120_000);
    let w: World;
    const ADDRESS = 'Calle 10 # 5-20 apto 301';
    const ACCESS = 'Codigo de la caja: 4821';
    beforeAll(async () => { w = await buildWorld('unp'); await (w.controls as any).ensureControlTables(w.schema); });
    afterAll(async () => { await w?.destroy(); });

    it.each(['pending_payment', 'expired'])('a verified guest with a %s stay today must not receive address or access code', async status => {
        const propertyId = (await w.q(
            `INSERT INTO properties(id,name,address,check_in_time,check_out_time,check_in_instructions,house_rules)
             VALUES(gen_random_uuid(),'Casa N3',$1,'15:00','11:00',$2,'Sin fiestas') RETURNING id::text AS id`, [ADDRESS, ACCESS]))[0].id;
        const contactId = await w.newContact();
        const conversationId = await w.newConversation(contactId);
        await w.inbound(conversationId, 'Hola, ¿cómo llego?');
        await w.verify(conversationId, contactId);
        await w.q(`INSERT INTO property_bookings(property_id,contact_id,check_in,check_out,status)
                   VALUES($1::uuid,$2::uuid,CURRENT_DATE-1,CURRENT_DATE+2,$3)`, [propertyId, contactId, status]);

        const result = await w.run(contactId, conversationId, 'get_check_in_instructions', { propertyId });

        const text = JSON.stringify(result);
        expect({ status, leakedAddress: text.includes(ADDRESS), leakedAccess: text.includes(ACCESS) })
            .toEqual({ status, leakedAddress: false, leakedAccess: false });
    });
});
