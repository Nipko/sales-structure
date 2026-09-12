import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import {
    humanOperatorAuthority, revalidateHumanOperator, type HumanOperatorAuthority,
} from './human-operator-authority';

/**
 * ═══ THE FOURTH THING THE DOCBLOCK PROMISED ═══
 *
 * `human-operator-authority.ts` lists what can change underneath a queued
 * human send — the account can be deactivated, the role can be reduced, the
 * user can be moved to another tenant, and *"the connection can stop being this
 * tenant's"* — and then says **"So the revision hashes exactly those"**.
 *
 * It hashed three. Neither `humanOperatorRevision` nor `revalidateHumanOperator`
 * read `channel_accounts` at all, so a reply queued before a number was
 * disconnected, deactivated or moved to another business was still admitted and
 * still sent. `AgentDispatchOutboxStore.admit` compares the scope's
 * `channelType`/`channelAccountId` against the row's binding, which proves the
 * scope and the row agree with each other — not that the connection is still
 * this tenant's, and not that it is still connected.
 *
 * A comment claiming an invariant the code does not enforce is worse than no
 * comment: the next person reads it and stops looking. These cases are the
 * connection half, against a real database, one revocation at a time.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a person sending from a connection', () => {
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const schema = `tenant_humanconn_${randomUUID().replace(/-/g, '')}`;
    const CHANNEL = 'whatsapp';
    const NUMBER = '15550007777';
    let client: PrismaClient;
    let userId: string;
    let accountRowId: string;
    jest.setTimeout(180_000);

    const exec = (text: string, ...params: any[]) => client.$executeRawUnsafe(text, ...params);
    /** The authority helpers take a query running inside one transaction. */
    const inTransaction = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        client.$transaction(async (tx: any) =>
            work(async (text: string, params: any[] = []) => tx.$queryRawUnsafe(text, ...params)));

    const build = () => inTransaction(query => humanOperatorAuthority(query, schema, {
        tenantId, userId, surface: 'agent_console', channelType: CHANNEL, channelAccountId: NUMBER,
    }));
    const revalidate = (scope: HumanOperatorAuthority) =>
        inTransaction(query => revalidateHumanOperator(query, schema, scope));

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await exec('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await exec('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            otherTenantId, `${schema}_other`);
        userId = randomUUID();
        await exec(
            `INSERT INTO public.users(id, first_name, last_name, role, tenant_id, is_active)
             VALUES($1::uuid, 'Ana', 'Agente', 'tenant_agent', $2::uuid, true)`,
            userId, tenantId);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            await exec('DELETE FROM public.channel_accounts WHERE tenant_id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
            await exec('DELETE FROM public.users WHERE id = $1::uuid', userId);
            await exec('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])',
                [tenantId, otherTenantId]);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await exec('DELETE FROM public.channel_accounts WHERE account_id = $1', NUMBER);
        accountRowId = randomUUID();
        await exec(
            `INSERT INTO public.channel_accounts(id, tenant_id, channel_type, account_id, is_active)
             VALUES($1::uuid, $2::uuid, $3, $4, true)`,
            accountRowId, tenantId, CHANNEL, NUMBER);
    });

    it('authorises the send while the connection is this tenant’s and live', async () => {
        const scope = await build();
        expect(scope?.kind).toBe('human_operator');
        expect(await revalidate(scope!)).toEqual({ kind: 'current' });
    });

    it('revokes it when the connection is disconnected before the message leaves', async () => {
        // The reply was queued while the number was connected. Somebody
        // disconnected it — which is exactly the moment an operator expects
        // sending from it to stop.
        const scope = await build();
        await exec('UPDATE public.channel_accounts SET is_active = false WHERE id = $1::uuid',
            accountRowId);
        expect(await revalidate(scope!)).toEqual({
            kind: 'revoked', detail: expect.stringContaining('connection'),
        });
    });

    it('revokes it when the connection has moved to another business', async () => {
        // The worst case of the four, because the message would leave from a
        // number that now belongs to somebody else's WABA — and be billed to
        // them.
        const scope = await build();
        await exec('UPDATE public.channel_accounts SET tenant_id = $2::uuid WHERE id = $1::uuid',
            accountRowId, otherTenantId);
        expect(await revalidate(scope!)).toEqual({
            kind: 'revoked', detail: expect.stringContaining('connection'),
        });
    });

    it('revokes it when the connection is gone entirely', async () => {
        const scope = await build();
        await exec('DELETE FROM public.channel_accounts WHERE id = $1::uuid', accountRowId);
        expect(await revalidate(scope!)).toEqual({
            kind: 'revoked', detail: expect.stringContaining('connection'),
        });
    });

    it('refuses to build one for a connection that is not this tenant’s', async () => {
        // Caught at prepare as well as at admit. A scope that could never be
        // revalidated should not be minted in the first place.
        await exec('UPDATE public.channel_accounts SET tenant_id = $2::uuid WHERE id = $1::uuid',
            accountRowId, otherTenantId);
        expect(await build()).toBeUndefined();
    });

    it('does not revoke over a promotion between two roles that may both send', async () => {
        // The property the existing revalidation deliberately protects, kept
        // here so the connection check cannot be written in a way that
        // reintroduces byte-equality by the back door: an agent promoted to
        // supervisor while their reply sat in the queue must still send.
        const scope = await build();
        await exec(`UPDATE public.users SET role = 'tenant_supervisor' WHERE id = $1::uuid`, userId);
        try {
            expect(await revalidate(scope!)).toEqual({ kind: 'current' });
        } finally {
            await exec(`UPDATE public.users SET role = 'tenant_agent' WHERE id = $1::uuid`, userId);
        }
    });
});
