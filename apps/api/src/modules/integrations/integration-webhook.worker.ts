import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
    ClaimedWebhookInboxEntry,
    IntegrationWebhookHandler,
} from '@parallext/shared';
import { CronLockService } from '../redis/cron-lock.service';
import { IntegrationOutboxService } from './integration-outbox.service';

const BATCH_PER_PROVIDER = 50;

/**
 * Processes webhook events after a provider-specific ingress verified their
 * signature and recorded them in the durable inbox. This worker owns only the
 * provider-neutral mechanics: lease, retry, dedupe and terminal failure.
 * Registering a handler does not require credentials and never enables writes.
 */
@Injectable()
export class IntegrationWebhookWorker {
    private readonly logger = new Logger(IntegrationWebhookWorker.name);
    private readonly handlers = new Map<string, IntegrationWebhookHandler>();

    constructor(
        private readonly inbox: IntegrationOutboxService,
        private readonly cronLock: CronLockService,
    ) {}

    register(handler: IntegrationWebhookHandler): void {
        const provider = String(handler.provider || '').trim().toLowerCase();
        if (!provider) throw new Error('Un webhook handler necesita proveedor');
        if (this.handlers.has(provider)) throw new Error(`Ya hay un webhook handler para ${provider}`);
        this.handlers.set(provider, handler);
    }

    registeredProviders(): string[] {
        return [...this.handlers.keys()];
    }

    @Cron('47 * * * * *')
    async drainCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'integration-webhook-inbox.drain',
            30,
            () => this.drainAll(),
            { prefer: 'worker' },
        );
    }

    async drainAll(): Promise<{ processed: number; failed: number }> {
        const tenants = await this.inbox.trackedTenants('webhook').catch((error: any) => {
            this.logger.warn(`[WebhookInbox] no se pudo listar tenants con trabajo: ${error?.message}`);
            return [] as Array<{ id: string; schemaName: string }>;
        });
        let processed = 0;
        let failed = 0;
        for (const tenant of tenants) {
            for (const [provider, handler] of this.handlers) {
                const entries = await this.inbox.claimWebhooks(
                    tenant.schemaName,
                    provider,
                    BATCH_PER_PROVIDER,
                ).catch(() => [] as ClaimedWebhookInboxEntry[]);
                for (const entry of entries) {
                    const result = await this.processOne(tenant.id, tenant.schemaName, handler, entry);
                    if (result) processed += 1;
                    else failed += 1;
                }
            }
        }
        return { processed, failed };
    }

    private async processOne(
        tenantId: string,
        schemaName: string,
        handler: IntegrationWebhookHandler,
        entry: ClaimedWebhookInboxEntry,
    ): Promise<boolean> {
        const supported = !handler.eventTypes?.length || handler.eventTypes.includes(entry.eventType);
        if (!supported) {
            await this.inbox.markWebhookFailed(
                schemaName,
                entry,
                `event_type_not_supported:${entry.eventType}`,
                false,
            );
            return false;
        }
        try {
            const result = await handler.handle(entry, { tenantId, schemaName });
            if (result.ok) {
                const committed = await this.inbox.markWebhookProcessed(schemaName, entry);
                if (committed) return true;
                this.logStaleClaim(entry);
                return false;
            }
            const state = await this.inbox.markWebhookFailed(
                schemaName,
                entry,
                result.error || 'webhook_handler_rejected',
                result.retryable !== false,
            );
            if (state === 'stale_claim') this.logStaleClaim(entry);
            return false;
        } catch (error: any) {
            const state = await this.inbox.markWebhookFailed(
                schemaName,
                entry,
                error?.message || 'webhook_handler_failed',
                true,
            );
            if (state === 'stale_claim') this.logStaleClaim(entry);
            return false;
        }
    }

    private logStaleClaim(entry: ClaimedWebhookInboxEntry): void {
        this.logger.warn(
            `[WebhookInbox] resultado tardío ignorado id=${entry.id} generation=${entry.claim.generation}`,
        );
    }
}
