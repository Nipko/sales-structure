import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    applyFundingSignal, clearPause, describePause, isPaused, readPause, type SendPause,
} from './account-send-pause';
import { fundingSignalFrom } from './meta-funding-signals';

/**
 * The pause state could not be read.
 *
 * Its own type rather than a `null`, because `null` already means something
 * precise — "this account is not paused" — and the whole defect was those two
 * answers being the same value.
 */
export class PauseStateUnavailable extends Error {
    constructor(readonly channelAccountId: string, readonly cause?: unknown) {
        super(`pause_state_unavailable:${channelAccountId}`);
        this.name = 'PauseStateUnavailable';
    }
}

/**
 * Where a paused number's state is written, read and undone.
 *
 * Kept apart from the pure model in `account-send-pause.ts` so the rules can be
 * tested without a database and the storage can be tested without re-deriving
 * the rules. The split is not ceremony: every interesting question here — does a
 * second failure restart the clock, does a malformed field mean paused, does
 * clearing keep the history — is answered by the pure half, and a store that
 * also decided them would have to be tested against a real PostgreSQL to
 * establish things that are true of the arithmetic.
 *
 * The cache is short and one-way. A pause is READ on the send path, and holding
 * a stale "not paused" for a few seconds costs a handful of messages that fail
 * the way they already were. Holding a stale "paused" would keep an account
 * silent after somebody fixed it, so clearing writes through immediately.
 */
@Injectable()
export class AccountPauseStore {
    private readonly logger = new Logger(AccountPauseStore.name);
    private readonly cache = new Map<string, { pause: SendPause | null; until: number }>();
    private readonly TTL_MS = 15_000;

    constructor(@Optional() private readonly prisma?: PrismaService) {}

    private key(tenantId: string, channelAccountId: string) {
        return `${tenantId}:${channelAccountId}`;
    }

    /**
     * Is this number currently stopped from sending anything chargeable?
     *
     * ═══ AND WHY AN UNREADABLE ANSWER IS NOT "NO" ═══
     *
     * This used to catch a database failure and return `null`, on the argument
     * that a database problem must not silence an account and that the messages
     * which then fail do so visibly at the provider.
     *
     * That argument was true while a failed WhatsApp message cost nothing. From
     * 1 October 2026 the pause exists precisely because every attempt from a
     * number Meta will not bill is an attempt against a wall: the queue fills,
     * the customer hears nothing, and the logs fill with one identical error.
     * "I could not read whether this account is stopped" is not evidence that
     * it is running, and answering as if it were turns a thirty-second
     * PostgreSQL blip into the exact storm the pause was built to prevent.
     *
     * So it raises. A caller that can defer defers; a caller that cannot treats
     * it as a refusal. Neither may read it as permission.
     */
    async current(tenantId: string, channelAccountId: string): Promise<SendPause | null> {
        const key = this.key(tenantId, channelAccountId);
        const cached = this.cache.get(key);
        if (cached && cached.until > Date.now()) return cached.pause;
        let pause: SendPause | null = null;
        try {
            const account = await this.prisma?.channelAccount.findFirst({
                where: { tenantId, channelType: 'whatsapp', accountId: channelAccountId },
                select: { metadata: true },
            });
            pause = readPause(account?.metadata);
        } catch (error: any) {
            this.logger.warn(`[Pause] state unreadable for ${channelAccountId}: ${error?.message}`);
            throw new PauseStateUnavailable(channelAccountId, error);
        }
        this.cache.set(key, { pause, until: Date.now() + this.TTL_MS });
        return pause;
    }

    /**
     * The same question for a caller that wants a boolean.
     *
     * An unreadable state answers TRUE — "treat this as stopped" — because the
     * only two mistakes available are "held a message that could have gone" and
     * "spent money on an account that cannot pay", and only the second is
     * irreversible.
     */
    async isPaused(tenantId: string, channelAccountId: string): Promise<boolean> {
        try {
            return isPaused(await this.current(tenantId, channelAccountId));
        } catch (error) {
            if (error instanceof PauseStateUnavailable) return true;
            throw error;
        }
    }

    /**
     * Record a funding refusal, pausing the account if it is not already.
     *
     * Returns the pause when one is in force, so the caller can log the line an
     * operator needs without re-deriving it. Never throws: this runs on a path
     * where a message has just failed, and failing to record why must not turn
     * into a second failure that hides the first.
     */
    async observeFunding(tenantId: string, channelAccountId: string, input: {
        readonly source: 'http_response' | 'status_webhook';
        readonly code?: unknown;
        readonly detail?: unknown;
    }): Promise<SendPause | null> {
        const signal = fundingSignalFrom(input);
        if (!signal) return null;
        try {
            const existing = await this.current(tenantId, channelAccountId);
            const pause = applyFundingSignal(existing, signal);
            await this.write(tenantId, channelAccountId, pause);
            if (pause.observations === 1) {
                // Said once, loudly, on the transition. Repeating it per message
                // would bury it under the thing it is trying to explain.
                this.logger.error(`[Pause] ${describePause(pause)}`);
            }
            return pause;
        } catch (error: any) {
            this.logger.error(`[Pause] could not record a funding refusal for `
                + `${channelAccountId}: ${error?.message}`);
            return null;
        }
    }

    /**
     * Lift a pause on evidence.
     *
     * `provider_accepted` is produced by the platform — Meta took a message from
     * this account — and is the only proof that billing works again. `operator`
     * is a person saying they fixed the card and want to try; without it a
     * paused account could only recover by being sent from, which it cannot be.
     */
    async clear(tenantId: string, channelAccountId: string, input: {
        readonly by: 'provider_accepted' | 'operator';
        readonly note?: string;
    }): Promise<SendPause | null> {
        const existing = await this.current(tenantId, channelAccountId);
        if (!isPaused(existing)) return existing;
        const cleared = clearPause(existing, input);
        await this.write(tenantId, channelAccountId, cleared);
        this.logger.log(`[Pause] WhatsApp ${channelAccountId} of tenant ${tenantId} resumed `
            + `(${input.by}${input.note ? `: ${input.note}` : ''})`);
        return cleared;
    }

    private async write(tenantId: string, channelAccountId: string, pause: SendPause | null) {
        const account = await this.prisma?.channelAccount.findFirst({
            where: { tenantId, channelType: 'whatsapp', accountId: channelAccountId },
            select: { id: true, metadata: true },
        });
        if (!account) return;
        await this.prisma!.channelAccount.update({
            where: { id: account.id },
            data: { metadata: { ...((account.metadata ?? {}) as object), sendPause: pause } as any },
        });
        // Written through rather than invalidated: the next read must see the
        // new state, and a clear that only invalidated the cache would leave the
        // account silent for the rest of the window.
        this.cache.set(this.key(tenantId, channelAccountId), { pause, until: Date.now() + this.TTL_MS });
    }
}
