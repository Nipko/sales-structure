import { AccountPauseStore, PauseStateUnavailable } from './account-pause-store';
import { ChannelTokenService } from './channel-token.service';
import { isConnectionRefusal } from './connection-refusal';

/**
 * ═══ THREE PLACES THAT READ "I DON'T KNOW" AS "YES" ═══
 *
 * Each of these is a question whose answer authorises spending, and each one
 * had the same shape of defect: a storage failure produced the permissive
 * value, because the permissive value was also the ordinary one.
 *
 *   · the pause state. `catch → null`, and `null` already meant "not paused".
 *     A thirty-second PostgreSQL blip re-armed every number Meta had refused
 *     to bill, and each attempt from one of those is identical, fails
 *     identically, and fills the queue while the customer hears nothing;
 *   · the global `channel_accounts` row. `catch → undefined`, and `undefined`
 *     already meant "this tenant predates the table, allow it". So the same
 *     blip made every DISCONNECTED number usable again — that row is where the
 *     disconnect endpoint writes, and nothing else records the decision;
 *   · the revocation epoch. A failed `INCR` was logged and abandoned, so a
 *     Redis hiccup during a disconnect left every warm cache entry answering
 *     with the revoked token for the rest of its TTL.
 *
 * The fix in all three is the same: give "could not tell" its own value, and
 * make every reader choose deliberately. The two mistakes available are
 * "held a message that could have gone" and "spent money on an account that
 * cannot pay", and only the second is irreversible.
 */
describe('an authority that cannot answer does not answer yes', () => {
    describe('the pause state', () => {
        const store = (findFirst: () => Promise<any>) => {
            const service = new AccountPauseStore({ channelAccount: { findFirst } } as any);
            jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
            return service;
        };

        it('raises rather than reporting "not paused"', async () => {
            const broken = store(async () => { throw new Error('pool exhausted'); });
            await expect(broken.current('t', '15550001111'))
                .rejects.toBeInstanceOf(PauseStateUnavailable);
        });

        it('answers `isPaused` as TRUE when it cannot tell', async () => {
            // Fail closed: hold the message. The alternative is spending on an
            // account Meta may already have refused.
            const broken = store(async () => { throw new Error('pool exhausted'); });
            expect(await broken.isPaused('t', '15550001111')).toBe(true);
        });

        it('still says "not paused" when it really is not', async () => {
            // The control. Without it, "fail closed" could be "never send".
            const open = store(async () => ({ metadata: {} }));
            expect(await open.isPaused('t', '15550001111')).toBe(false);
            expect(await open.current('t', '15550001111')).toBeNull();
        });

        it('keeps the two answers distinguishable by type, not by value', () => {
            // The whole defect was `null` meaning both. A caller that wants to
            // treat them the same now has to say so.
            expect(new PauseStateUnavailable('15550001111')).toBeInstanceOf(Error);
        });
    });

    describe('the connection state', () => {
        const tokens = (findFirst: () => Promise<any>) => {
            const service: any = Object.create(ChannelTokenService.prototype);
            service.prisma = { channelAccount: { findFirst } };
            service.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };
            return service;
        };

        const ask = (service: any, channelStatus = 'connected') =>
            service.connectionUsable('t', { phone_number_id: '15550001111', channel_status: channelStatus });

        it('refuses when the global account row cannot be read', async () => {
            const broken = tokens(async () => { throw new Error('pool exhausted'); });
            const error = await ask(broken).catch((raised: unknown) => raised);
            expect(isConnectionRefusal(error)).toBe(true);
            expect((error as any).code).toBe('connection_state_unreadable');
        });

        it('still allows a tenant that genuinely has no global row', async () => {
            // `undefined` has to keep meaning "no row", or every legacy tenant
            // is disconnected at once. That is why unreadable needed its own
            // answer instead of borrowing this one.
            const legacy = tokens(async () => null);
            expect((await ask(legacy)).usable).toBe(true);
        });

        it('still refuses a row that is switched off', async () => {
            const off = tokens(async () => ({ isActive: false }));
            expect((await ask(off)).usable).toBe(false);
        });
    });

    describe('the revocation epoch', () => {
        const service = (client: any) => {
            const token: any = Object.create(ChannelTokenService.prototype);
            token.redis = { getClient: () => client, del: jest.fn(async () => undefined) };
            token.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() };
            token.EPOCH_TTL = 86_400;
            token.CACHE_TTL = 300;
            return token;
        };

        it('clears the counter when it cannot increment it', async () => {
            // A missing epoch reads as 0 and every stamped value carries a
            // non-zero one, so deleting revokes exactly as bumping would — and
            // it is the one operation still available when `INCR` is not.
            const token = service({
                incr: async () => { throw new Error('redis down'); },
                expire: async () => 1,
            });
            await token.revokeCachedCredentials('whatsapp', 'tenant-1');
            expect(token.redis.del).toHaveBeenCalledWith('whatsapp_token_epoch:tenant-1');
        });

        it('does not delete when the increment worked', async () => {
            const token = service({ incr: async () => 4, expire: async () => 1 });
            await token.revokeCachedCredentials('whatsapp', 'tenant-1');
            expect(token.redis.del).not.toHaveBeenCalled();
        });

        it('says so loudly when neither worked', async () => {
            const token = service({
                incr: async () => { throw new Error('redis down'); },
                expire: async () => 1,
            });
            token.redis.del = jest.fn(async () => { throw new Error('still down'); });
            await token.revokeCachedCredentials('whatsapp', 'tenant-1');
            // Two errors, because two things failed and an operator needs to
            // know the cache may answer for another five minutes.
            expect(token.logger.error).toHaveBeenCalledTimes(2);
        });
    });
});
