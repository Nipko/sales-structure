import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { appointmentsWithoutAgreedTermsSql } from './appointment-service-terms';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';
import { isMissingAgreedTermsRefusal } from '../tenant-payments/agreed-terms-orphans';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * What an appointment charge actually takes, against real PostgreSQL.
 *
 * The change that made the till read the agreed price was covered by asserting
 * the SQL TEXT — that the expression mentions `serviceTerms` and not
 * `service.price`. That is a check on a string. It cannot tell whether the
 * expression selects the right number from a row, whether a catalogue price
 * moving underneath moves the charge, or what happens to the two shapes of
 * legacy row. The sibling family — catalogue orders — was proven against a real
 * database, positive and negative, and this is the same proof for the family
 * that sells the most: health, beauty, aesthetics.
 *
 * The last case is the one that reopened the review. `amount_due` is the deposit
 * column and it predates the terms binding, so a row created between the two
 * comes back with a NUMBER and no currency — refused, correctly, on the
 * three-letter check, and until recently refused in silence.
 */

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = databaseUrl ? describe : describe.skip;

const TARGET = PAYMENT_REFERENCE_TARGETS.appointment;

integration('what an appointment charge takes', () => {
    const schema = `tenant_appt_charge_${randomUUID().replace(/-/g, '')}`;
    const serviceId = randomUUID();
    let client: Client;

    const sql = async (text: string, params: any[] = []) => {
        const result = await client.query(text, params);
        return result.rows as any[];
    };

    /** Exactly what the payment resolver reads, through the declared target. */
    const payable = async (id: string) => (await sql(
        `SELECT ${TARGET.amountExpression} AS amount, ${TARGET.currencyExpression} AS currency
           FROM ${TARGET.table} target
           ${TARGET.join ?? ''}
          WHERE target.id = $1::uuid`, [id]))[0];

    const insert = async (metadata: unknown, extra: { amountDue?: number } = {}) => {
        const id = randomUUID();
        await sql(
            `INSERT INTO appointments (id, service_id, start_at, end_at, status, metadata, amount_due)
             VALUES ($1::uuid, $2::uuid, NOW(), NOW() + INTERVAL '30 minutes', 'confirmed', $3::jsonb, $4)`,
            [id, serviceId, JSON.stringify(metadata ?? {}), extra.amountDue ?? null]);
        return id;
    };

    beforeAll(async () => {
        if (!isDisposableDatabase(databaseUrl)) throw new Error('disposable_loopback_database_required');
        client = new Client({ connectionString: databaseUrl });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}", public`);
        // The production DDL for the two tables, so the column types under test
        // are the ones a tenant actually has — `price` is DECIMAL(15,2) and
        // `amount_due` is too, and a fixture inventing INTEGER would hide a
        // rounding defect rather than find one.
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        for (const table of ['services', 'appointments']) {
            const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
            if (start < 0) throw new Error(`production_ddl_missing:${table}`);
            await client.query(ddl.slice(start, ddl.indexOf('\n);', start) + 3)
                .replaceAll('{{SCHEMA_NAME}}', schema)
                .replaceAll('uuid_generate_v4()', 'pg_catalog.gen_random_uuid()')
                .replace(/REFERENCES "[^"]+"\."[^"]+"\("[^"]+"\)( ON DELETE \w+( \w+)?)?/g, ''));
        }
        await client.query(`ALTER TABLE appointments
            ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS amount_due DECIMAL(15,2)`);
        await sql(`INSERT INTO services (id, name, price, currency) VALUES ($1::uuid, 'Control', 80000, 'COP')`,
            [serviceId]);
    }, 120000);

    afterAll(async () => {
        if (!client) return;
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        await client.end().catch(() => undefined);
    });

    it('takes the price the customer agreed to, not the catalogue price today', async () => {
        const id = await insert({ serviceTerms: { price: '65000', currency: 'COP' } });
        expect(await payable(id)).toEqual({ amount: '65000', currency: 'COP' });

        // The catalogue moves — the tenant raises the price — and the charge
        // does not follow it. That is the whole change: a number the customer
        // never saw cannot become the number they are asked to pay.
        await sql(`UPDATE services SET price = 999999 WHERE id = $1::uuid`, [serviceId]);
        expect(Number((await payable(id)).amount)).toBe(65000);
        await sql(`UPDATE services SET price = 80000 WHERE id = $1::uuid`, [serviceId]);
    }, 60000);

    it('refuses a legacy appointment instead of charging what the service costs now', async () => {
        const legacy = await insert({});
        // Both halves NULL: the row exists and nobody recorded an agreement, so
        // there is nothing to charge. Refusing is the direction to err in.
        expect(await payable(legacy)).toEqual({ amount: null, currency: null });
        expect(isMissingAgreedTermsRefusal(await payable(legacy), 'appointment')).toBe(true);
    }, 60000);

    it('refuses a legacy deposit, and says so instead of looking like a typo', async () => {
        // The shape that survives `COALESCE(amount_due, …)`: a deposit taken
        // before terms were bound. The amount is real and the currency is not,
        // so the resolver refuses on the three-letter check — and the refusal
        // has to be counted, or a person is holding a link that will not work
        // and nobody is told.
        const deposit = await insert({}, { amountDue: 25000 });
        const row = await payable(deposit);
        expect(Number(row.amount)).toBe(25000);
        expect(row.currency).toBeNull();
        expect(isMissingAgreedTermsRefusal(row, 'appointment')).toBe(true);
    }, 60000);

    it('keeps a deposit payable when the terms are there', async () => {
        // The positive of the same shape, so the refusal above is about the
        // missing agreement and not about deposits.
        const deposit = await insert(
            { serviceTerms: { price: '65000', currency: 'COP' } }, { amountDue: 25000 });
        const row = await payable(deposit);
        expect(Number(row.amount)).toBe(25000);
        expect(row.currency).toBe('COP');
        expect(isMissingAgreedTermsRefusal(row, 'appointment')).toBe(false);
    }, 60000);

    it('counts the live rows the refusal would bite, and ignores the ones nobody charges', async () => {
        // Failing closed is only responsible if somebody can see how many rows
        // it reaches before it does. Cancelled and completed rows are not among
        // them: nobody is going to charge those either way.
        const [before] = await sql(appointmentsWithoutAgreedTermsSql());
        await insert({});
        const done = await insert({});
        await sql(`UPDATE appointments SET status = 'completed' WHERE id = $1::uuid`, [done]);
        const [after] = await sql(appointmentsWithoutAgreedTermsSql());
        expect(Number(after.orphans) - Number(before.orphans)).toBe(1);
    }, 60000);
});
