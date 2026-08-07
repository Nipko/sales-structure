import type { Logger } from '@nestjs/common';

/**
 * Raised when a distributed critical section can no longer prove that it owns
 * its Redis lock. Callers must stop before their next durable side effect.
 */
export class LockOwnershipLostError extends Error {
    readonly code = 'lock_ownership_lost';

    constructor(
        readonly lockKey: string,
        readonly cause?: unknown,
    ) {
        super(`Lost ownership of distributed lock ${lockKey}`);
        this.name = 'LockOwnershipLostError';
    }
}

interface TokenLockRedis {
    renewLockToken(key: string, token: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Heartbeats keep long provisioning jobs alive, while assertOwned() is the
 * fencing boundary used immediately before durable writes/stage commits.
 *
 * A renewal error is treated exactly like a negative ownership check. We
 * cannot safely distinguish a transient Redis outage from a lock that expired
 * and was acquired by another worker, so continuing would risk split brain.
 */
export class OwnedLockLease {
    private heartbeat?: NodeJS.Timeout;
    private renewalInFlight?: Promise<void>;
    private lost?: LockOwnershipLostError;

    constructor(
        private readonly redis: TokenLockRedis,
        readonly key: string,
        readonly token: string,
        private readonly ttlSeconds: number,
        private readonly logger: Logger,
        private readonly context: string,
    ) {}

    start(): void {
        if (this.heartbeat) return;
        const intervalMs = Math.max(1_000, Math.floor(this.ttlSeconds * 1_000 / 3));
        this.heartbeat = setInterval(() => {
            void this.renew().catch((error: unknown) => {
                this.logger.error(`${this.context}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, intervalMs);
        this.heartbeat.unref?.();
    }

    stop(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
    }

    hasLostOwnership(): boolean {
        return this.lost !== undefined;
    }

    /** Renew-and-compare immediately before a durable side effect. */
    async assertOwned(): Promise<void> {
        if (this.lost) throw this.lost;
        await this.renew();
        if (this.lost) throw this.lost;
    }

    private async renew(): Promise<void> {
        if (this.lost) throw this.lost;
        if (!this.renewalInFlight) {
            this.renewalInFlight = (async () => {
                try {
                    const renewed = await this.redis.renewLockToken(
                        this.key,
                        this.token,
                        this.ttlSeconds,
                    );
                    if (!renewed) {
                        this.lost = new LockOwnershipLostError(this.key);
                        throw this.lost;
                    }
                } catch (error: unknown) {
                    if (error instanceof LockOwnershipLostError) throw error;
                    this.lost = new LockOwnershipLostError(this.key, error);
                    throw this.lost;
                }
            })().finally(() => {
                this.renewalInFlight = undefined;
            });
        }
        await this.renewalInFlight;
    }
}
