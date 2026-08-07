import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';
import { BillingService } from '../billing/billing.service';
import { OwnedLockLease } from '../../common/utils/owned-lock.util';

interface PurgeChannelCredential {
    channelType: string;
    accountId: string;
    wabaId?: string;
    encryptedCredential: string;
}

interface PurgeExternalPlan {
    version: 1;
    capturedAt: string;
    channels: PurgeChannelCredential[];
    googleOAuthTokens: string[];
}

@Injectable()
export class OffboardingService {
    private readonly logger = new Logger(OffboardingService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private mediaService: MediaService,
        private billing: BillingService,
        @InjectQueue('outbound-messages') private outboundQueue: Queue,
        @InjectQueue('broadcast-messages') private broadcastQueue: Queue,
        @InjectQueue('automation-jobs') private automationQueue: Queue,
        @InjectQueue('nurturing') private nurturingQueue: Queue,
        @InjectQueue('conversation-snooze') private snoozeQueue: Queue,
    ) {}

    /**
     * Voluntary cancellation — marks subscription as cancelled but keeps
     * the tenant active until the current billing period ends.
     */
    async voluntaryCancel(tenantId: string, reason?: string): Promise<{ cancelledAt: Date; periodEnd: Date | null }> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

        const now = new Date();

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { subscriptionStatus: 'cancelled' },
        });

        // Try to update billing subscription if it exists
        try {
            const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
            if (sub) {
                await this.prisma.billingSubscription.update({
                    where: { id: sub.id },
                    data: {
                        status: 'cancelled',
                        cancelAtPeriodEnd: true,
                        cancelledAt: now,
                        cancellationReason: reason ?? null,
                    },
                });
            }
        } catch (error) {
            this.logger.warn(`Failed to update billing subscription for tenant ${tenantId}: ${error}`);
        }

        // Audit log
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'voluntary_cancel',
                    resource: 'offboarding',
                    details: { reason, cancelledAt: now.toISOString() },
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to create audit log for voluntary cancel: ${error}`);
        }

        await this.redis.del(`tenant_plan:${tenantId}`);

        this.logger.log(`Tenant ${tenantId} voluntarily cancelled (reason: ${reason || 'none'})`);

        return {
            cancelledAt: now,
            periodEnd: tenant.currentPeriodEnd ?? null,
        };
    }

    /**
     * Admin suspension — immediately offboards the tenant.
     */
    async adminSuspend(tenantId: string, reason: string): Promise<void> {
        await this.executeOffboarding(tenantId, 'admin_suspension', reason);
    }

    /**
     * Full offboarding pipeline — each step in try/catch so failures
     * don't prevent subsequent steps from executing.
     */
    async executeOffboarding(tenantId: string, trigger: string, reason?: string): Promise<void> {
        this.logger.log(`Starting offboarding for tenant ${tenantId} (trigger: ${trigger}, reason: ${reason || 'none'})`);

        // Step 1: Disconnect all channels
        try {
            await this.disconnectAllChannels(tenantId);
            this.logger.log(`[Offboarding ${tenantId}] Step 1: Channels disconnected`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 1 failed (channels): ${error}`);
        }

        // Step 2: Revoke all user sessions
        try {
            await this.revokeAllSessions(tenantId);
            this.logger.log(`[Offboarding ${tenantId}] Step 2: Sessions revoked`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 2 failed (sessions): ${error}`);
        }

        // Step 3: Drain tenant queues
        try {
            await this.drainTenantQueues(tenantId);
            this.logger.log(`[Offboarding ${tenantId}] Step 3: Queues drained`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 3 failed (queues): ${error}`);
        }

        // Step 4: Deactivate tenant and all users
        try {
            await this.prisma.tenant.update({
                where: { id: tenantId },
                data: { isActive: false, subscriptionStatus: 'cancelled' },
            });
            await this.prisma.user.updateMany({
                where: { tenantId },
                data: { isActive: false },
            });
            this.logger.log(`[Offboarding ${tenantId}] Step 4: Tenant and users deactivated`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 4 failed (deactivate): ${error}`);
        }

        // Step 5: Invalidate Redis caches
        try {
            const client = this.redis.getClient();
            await this.redis.del(`tenant:${tenantId}:config`);
            await this.redis.del(`tenant:${tenantId}:schema`);
            await this.redis.del(`tenant_plan:${tenantId}`);

            // Clean up booking keys for this tenant
            let cursor = '0';
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `booking:*`, 'COUNT', 200);
                cursor = nextCursor;
                // Booking keys don't contain tenantId directly, but we clear what we can
            } while (cursor !== '0');

            // Clean up analytics keys
            cursor = '0';
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `analytics:${tenantId}:*`, 'COUNT', 200);
                cursor = nextCursor;
                if (keys.length > 0) {
                    await client.del(...keys);
                }
            } while (cursor !== '0');

            // Clean up channel token caches
            await this.redis.del(`wa_token:${tenantId}`);
            await this.redis.del(`instagram_token:${tenantId}`);
            await this.redis.del(`messenger_token:${tenantId}`);
            await this.redis.del(`telegram_token:${tenantId}`);
            await this.redis.del(`sms_token:${tenantId}`);

            this.logger.log(`[Offboarding ${tenantId}] Step 5: Redis caches invalidated`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 5 failed (cache): ${error}`);
        }

        // Step 6: Audit log
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'tenant_offboarded',
                    resource: 'offboarding',
                    details: { trigger, reason },
                },
            });
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 6 failed (audit): ${error}`);
        }

        // Step 7: Emit event
        try {
            this.eventEmitter.emit('tenant.offboarded', { tenantId, trigger, reason });
            this.logger.log(`[Offboarding ${tenantId}] Step 7: Event emitted`);
        } catch (error) {
            this.logger.error(`[Offboarding ${tenantId}] Step 7 failed (event): ${error}`);
        }

        this.logger.log(`Offboarding completed for tenant ${tenantId}`);
    }

    /**
     * Disconnect all active channels for a tenant.
     * Best-effort API calls for WhatsApp (Meta) and Telegram, then bulk deactivate.
     */
    async disconnectAllChannels(tenantId: string): Promise<void> {
        const accounts = await this.prisma.channelAccount.findMany({
            // Include inactive rows: normal offboarding marks the local route
            // inactive even when the remote unlink failed, recording that fact
            // in metadata.disconnected_at_provider=false.
            where: { tenantId },
        });

        if (accounts.length === 0) {
            this.logger.log(`No active channels to disconnect for tenant ${tenantId}`);
            return;
        }

        // Resolve schema_name once for the WhatsApp lookup below
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });

        // Track which channels we successfully detached at the provider so the
        // reactivate path knows whether bringing is_active=true is enough or
        // whether the user has to reconnect through OAuth again.
        const providerDisconnected: Record<string, boolean> = {};

        // Best-effort: unsubscribe WhatsApp WABAs
        for (const account of accounts) {
            if (account.channelType === 'whatsapp') {
                let unsubscribed = false;
                try {
                    // The WABA id lives in the tenant schema's whatsapp_channels
                    // table, NOT in channel_accounts.metadata (the previous
                    // implementation looked there and silently no-op'd).
                    let wabaId: string | undefined;
                    if (tenant?.schemaName) {
                        const rows = await this.prisma.executeInTenantSchema<any[]>(
                            tenant.schemaName,
                            `SELECT meta_waba_id FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
                            [account.accountId],
                        );
                        wabaId = rows?.[0]?.meta_waba_id;
                    }

                    if (wabaId) {
                        const cred = await this.prisma.whatsappCredential.findFirst({
                            where: { tenantId, credentialType: 'system_user_token' },
                            orderBy: { createdAt: 'desc' },
                        });
                        if (cred?.encryptedValue) {
                            const accessToken = this.decryptToken(cred.encryptedValue);
                            // Meta wants access_token as query param, not body
                            const res = await fetch(
                                `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps?access_token=${accessToken}`,
                                { method: 'DELETE' },
                            ).catch(() => null);
                            if (res?.ok) {
                                unsubscribed = true;
                                this.logger.log(`[Offboarding ${tenantId}] Meta WABA ${wabaId} unsubscribed`);
                            }
                        }
                    }
                } catch (error) {
                    this.logger.warn(`Failed to unsubscribe WhatsApp WABA for tenant ${tenantId}: ${error}`);
                }
                providerDisconnected[account.id] = unsubscribed;
            }

            if (account.channelType === 'telegram') {
                let unsubscribed = false;
                try {
                    const cred = await this.prisma.whatsappCredential.findFirst({
                        where: { tenantId, credentialType: 'telegram_token' },
                        orderBy: { createdAt: 'desc' },
                    });
                    if (cred?.encryptedValue) {
                        const botToken = this.decryptToken(cred.encryptedValue);
                        const res = await fetch(
                            `https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=true`,
                            { method: 'POST' },
                        ).catch(() => null);
                        if (res?.ok) unsubscribed = true;
                    }
                } catch (error) {
                    this.logger.warn(`Failed to delete Telegram webhook for tenant ${tenantId}: ${error}`);
                }
                providerDisconnected[account.id] = unsubscribed;
            }

            if (account.channelType === 'messenger') {
                let unsubscribed = false;
                try {
                    const cred = await this.prisma.whatsappCredential.findFirst({
                        where: { tenantId, credentialType: 'messenger_page_token' },
                        orderBy: { createdAt: 'desc' },
                    });
                    if (cred?.encryptedValue) {
                        const pageToken = this.decryptToken(cred.encryptedValue);
                        const res = await fetch(
                            `https://graph.facebook.com/v21.0/${account.accountId}/subscribed_apps?access_token=${pageToken}`,
                            { method: 'DELETE' },
                        ).catch(() => null);
                        if (res?.ok) unsubscribed = true;
                    }
                } catch (error) {
                    this.logger.warn(`Failed to unsubscribe Messenger app for tenant ${tenantId}: ${error}`);
                }
                providerDisconnected[account.id] = unsubscribed;
            }

            if (account.channelType === 'instagram') {
                let unsubscribed = false;
                try {
                    const cred = await this.prisma.whatsappCredential.findFirst({
                        where: { tenantId, credentialType: 'instagram_token' },
                        orderBy: { createdAt: 'desc' },
                    });
                    if (cred?.encryptedValue) {
                        const igToken = this.decryptToken(cred.encryptedValue);
                        const res = await fetch(
                            `https://graph.instagram.com/me/permissions?access_token=${igToken}`,
                            { method: 'DELETE' },
                        ).catch(() => null);
                        if (res?.ok) unsubscribed = true;
                    }
                } catch (error) {
                    this.logger.warn(`Failed to revoke Instagram permissions for tenant ${tenantId}: ${error}`);
                }
                providerDisconnected[account.id] = unsubscribed;
            }
        }

        // Per-account update so we can stamp metadata.disconnected_at_provider
        // — used by reactivate() to decide whether the channel can come back
        // online with just a flag flip or needs a full OAuth reconnect.
        for (const account of accounts) {
            const flagged = providerDisconnected[account.id] === true;
            await this.prisma.$queryRawUnsafe(
                `UPDATE channel_accounts
                   SET is_active = false,
                       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                           'disconnected_at', NOW()::text,
                           'disconnected_by', 'offboarding',
                           'disconnected_at_provider', $2::boolean
                       ),
                       updated_at = NOW()
                   WHERE id = $1::uuid`,
                account.id,
                flagged,
            );
        }

        // Bulk revoke credentials. Using the typed client because
        // whatsapp_credentials.tenant_id may be text (not uuid) in some
        // deployments and a raw `tenant_id = $1::uuid` crashes with
        // "operator does not exist: text = uuid".
        try {
            await this.prisma.whatsappCredential.updateMany({
                where: { tenantId },
                data: { rotationState: 'revoked' },
            });
        } catch (e: any) {
            this.logger.warn(`Failed to revoke whatsapp_credentials during offboarding for tenant ${tenantId}: ${e?.message}`);
        }

        // Deactivate calendar integrations in tenant schema
        try {
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE calendar_integrations SET is_active = false WHERE is_active = true`,
            );
        } catch (error) {
            this.logger.warn(`Failed to deactivate calendar integrations for tenant ${tenantId}: ${error}`);
        }

        this.logger.log(`Disconnected ${accounts.length} channels for tenant ${tenantId}`);
    }

    /**
     * Revoke all user sessions by scanning Redis refresh tokens.
     */
    async revokeAllSessions(tenantId: string): Promise<void> {
        const users = await this.prisma.user.findMany({
            where: { tenantId },
            select: { id: true },
        });

        const client = this.redis.getClient();
        let totalRevoked = 0;

        for (const user of users) {
            const pattern = `refresh:${user.id}:*`;
            let cursor = '0';
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;
                if (keys.length > 0) {
                    await client.del(...keys);
                    totalRevoked += keys.length;
                }
            } while (cursor !== '0');
        }

        this.logger.log(`Revoked ${totalRevoked} sessions for ${users.length} users in tenant ${tenantId}`);
    }

    /**
     * Drain BullMQ jobs belonging to this tenant from all queues.
     */
    async drainTenantQueues(tenantId: string): Promise<void> {
        const queues = [
            { queue: this.outboundQueue, name: 'outbound-messages' },
            { queue: this.broadcastQueue, name: 'broadcast-messages' },
            { queue: this.automationQueue, name: 'automation-jobs' },
            { queue: this.nurturingQueue, name: 'nurturing' },
            { queue: this.snoozeQueue, name: 'conversation-snooze' },
        ];

        for (const { queue, name } of queues) {
            try {
                let removed = 0;
                const waiting = await queue.getWaiting();
                const delayed = await queue.getDelayed();
                const jobs = [...waiting, ...delayed];

                for (const job of jobs) {
                    const jobTenantId = job.data?.tenantId || job.data?.outbound?.tenantId;
                    if (jobTenantId === tenantId) {
                        await job.remove();
                        removed++;
                    }
                }

                if (removed > 0) {
                    this.logger.log(`Removed ${removed} jobs from queue ${name} for tenant ${tenantId}`);
                }
            } catch (error) {
                this.logger.warn(`Failed to drain queue ${name} for tenant ${tenantId}: ${error}`);
            }
        }
    }

    /**
     * Globally pause each relevant BullMQ queue for the short schema-drop
     * critical section, remove every non-active job owned by the tenant, and
     * prove that no active tenant job remains.  Unlike the normal offboarding
     * drain, every queue error is fatal: dropping a schema while a worker may
     * still be using it is never safe.
     */
    private async fenceQueuesForPurge(tenantId: string): Promise<() => Promise<void>> {
        const queues = [
            { queue: this.outboundQueue, name: 'outbound-messages' },
            { queue: this.broadcastQueue, name: 'broadcast-messages' },
            { queue: this.automationQueue, name: 'automation-jobs' },
            { queue: this.nurturingQueue, name: 'nurturing' },
            { queue: this.snoozeQueue, name: 'conversation-snooze' },
        ];
        const paused: Array<{ queue: Queue; name: string }> = [];
        const belongsToTenant = (job: any) =>
            (job?.data?.tenantId || job?.data?.outbound?.tenantId) === tenantId;

        const resumeAll = async (): Promise<void> => {
            const failures: string[] = [];
            for (const item of [...paused].reverse()) {
                try {
                    await item.queue.resume();
                } catch (error: any) {
                    failures.push(`${item.name}: ${error.message}`);
                }
            }
            if (failures.length > 0) {
                throw new Error(`Failed to release purge queue fence (${failures.join('; ')})`);
            }
        };

        try {
            for (const item of queues) {
                await item.queue.pause();
                paused.push(item);
            }

            for (const { queue, name } of queues) {
                const jobs = await queue.getJobs(
                    ['active', 'wait', 'delayed', 'prioritized', 'paused', 'waiting-children', 'failed'],
                    0,
                    -1,
                    true,
                );
                // Removal is intentional before DROP: the durable `purging`
                // tenant checkpoint has already disabled new work, and these
                // queued jobs must never be replayed for a tenant selected for
                // deletion.  If a later gate fails, a retry simply observes an
                // already-clean queue; no customer data mutation is replayed.
                for (const job of jobs.filter(belongsToTenant)) {
                    const state = await job.getState();
                    if (state === 'active') {
                        throw new ConflictException({
                            error: 'tenant_purge_active_queue_job',
                            queue: name,
                            jobId: job.id,
                        });
                    }
                    await job.remove();
                }

                const remaining = await queue.getJobs(
                    ['active', 'wait', 'delayed', 'prioritized', 'paused', 'waiting-children', 'failed'],
                    0,
                    -1,
                    true,
                );
                const tenantJob = remaining.find(belongsToTenant);
                if (tenantJob) {
                    throw new Error(`Queue ${name} still contains tenant job ${tenantJob.id}`);
                }
            }
        } catch (error) {
            try {
                await resumeAll();
            } catch (resumeError: any) {
                this.logger.error(`[Purge ${tenantId}] Queue fence release also failed: ${resumeError.message}`);
            }
            throw error;
        }

        return resumeAll;
    }

    /**
     * Get current offboarding status for a tenant.
     */
    async getOffboardingStatus(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                isActive: true,
                subscriptionStatus: true,
                currentPeriodEnd: true,
                updatedAt: true,
            },
        });

        if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

        const channelCount = await this.prisma.channelAccount.count({
            where: { tenantId, isActive: true },
        });

        const userCount = await this.prisma.user.count({
            where: { tenantId, isActive: true },
        });

        const pastDueKey = `offboard:past_due:${tenantId}`;
        const pastDueSince = await this.redis.get(pastDueKey);

        return {
            tenantId: tenant.id,
            name: tenant.name,
            isActive: tenant.isActive,
            subscriptionStatus: tenant.subscriptionStatus,
            currentPeriodEnd: tenant.currentPeriodEnd,
            updatedAt: tenant.updatedAt,
            activeChannels: channelCount,
            activeUsers: userCount,
            pastDueSince: pastDueSince || null,
        };
    }

    /**
     * Reactivate a suspended or cancelled tenant — restores access.
     */
    async reactivate(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

        // Re-enable tenant
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { isActive: true, subscriptionStatus: 'active' },
        });

        // Re-enable all users
        await this.prisma.user.updateMany({
            where: { tenantId },
            data: { isActive: true },
        });

        // Re-enable channel_accounts that were turned off during offboarding,
        // BUT skip the ones we actually unsubscribed at the provider (Meta /
        // Telegram). Those need a fresh OAuth reconnect; flipping is_active
        // back to true would leave the dashboard saying "connected" while
        // Meta has already detached the webhook subscription.
        const channelsRestored = (await this.prisma.$queryRawUnsafe(
            `UPDATE channel_accounts
               SET is_active = true,
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                       'reactivated_at', NOW()::text
                   ),
                   updated_at = NOW()
             WHERE tenant_id = $1::uuid
               AND is_active = false
               AND COALESCE((metadata->>'disconnected_at_provider')::boolean, false) = false
             RETURNING id, channel_type, account_id`,
            tenantId,
        )) as any[];
        const skippedChannels = await this.prisma.channelAccount.count({
            where: {
                tenantId,
                isActive: false,
                metadata: { path: ['disconnected_at_provider'], equals: true },
            },
        }).catch(() => 0);
        if (channelsRestored.length > 0) {
            this.logger.log(`[Reactivate ${tenantId}] Restored ${channelsRestored.length} channel_account(s)`);
        }
        if (skippedChannels > 0) {
            this.logger.warn(`[Reactivate ${tenantId}] ${skippedChannels} channel(s) need OAuth reconnect (provider unsubscribed) — left inactive`);
        }

        // Update billing subscription if exists
        try {
            const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
            if (sub) {
                await this.prisma.billingSubscription.update({
                    where: { id: sub.id },
                    data: {
                        status: 'active',
                        cancelAtPeriodEnd: false,
                        cancelledAt: null,
                        cancellationReason: null,
                    },
                });
            }
        } catch (error) {
            this.logger.warn(`Failed to update billing subscription on reactivation for tenant ${tenantId}: ${error}`);
        }

        // Clear past_due Redis key
        await this.redis.del(`offboard:past_due:${tenantId}`);

        // Invalidate caches
        await this.redis.del(`tenant:${tenantId}:config`);
        await this.redis.del(`tenant:${tenantId}:schema`);
        await this.redis.del(`tenant_plan:${tenantId}`);

        // Audit log
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'tenant_reactivated',
                    resource: 'offboarding',
                    details: { previousStatus: tenant.subscriptionStatus, previousActive: tenant.isActive },
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to create audit log for reactivation: ${error}`);
        }

        this.logger.log(`Tenant ${tenantId} reactivated`);

        return {
            tenantId,
            name: tenant.name,
            isActive: true,
            subscriptionStatus: 'active',
        };
    }

    /**
     * Extend trial period for a tenant by the given number of days.
     */
    async extendTrial(tenantId: string, days: number) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

        const currentTrialEnd = tenant.trialEndsAt || new Date();
        const baseDate = currentTrialEnd > new Date() ? currentTrialEnd : new Date();
        const newTrialEndsAt = new Date(baseDate.getTime() + days * 86_400_000);

        // Update tenant
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                trialEndsAt: newTrialEndsAt,
                subscriptionStatus: 'trialing',
                isActive: true,
            },
        });

        // Update billing subscription if exists
        try {
            const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
            if (sub) {
                await this.prisma.billingSubscription.update({
                    where: { id: sub.id },
                    data: {
                        trialEndsAt: newTrialEndsAt,
                        status: 'trialing',
                    },
                });
            }
        } catch (error) {
            this.logger.warn(`Failed to update billing subscription trial extension for tenant ${tenantId}: ${error}`);
        }

        // Invalidate caches
        await this.redis.del(`tenant:${tenantId}:config`);
        await this.redis.del(`tenant_plan:${tenantId}`);

        // Audit log
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'trial_extended',
                    resource: 'offboarding',
                    details: {
                        days,
                        previousTrialEndsAt: tenant.trialEndsAt?.toISOString() || null,
                        newTrialEndsAt: newTrialEndsAt.toISOString(),
                    },
                },
            });
        } catch (error) {
            this.logger.warn(`Failed to create audit log for trial extension: ${error}`);
        }

        this.logger.log(`Tenant ${tenantId} trial extended by ${days} days (new end: ${newTrialEndsAt.toISOString()})`);

        return {
            tenantId,
            name: tenant.name,
            trialEndsAt: newTrialEndsAt,
            subscriptionStatus: 'trialing',
        };
    }

    /**
     * AES-256-GCM decryption — same pattern as ChannelTokenService.
     */
    /** Capture all schema-backed teardown credentials without external effects. */
    private async capturePurgeExternalPlan(
        tenantId: string,
        schemaName: string,
        settings: any,
    ): Promise<PurgeExternalPlan> {
        const existing = settings?.purgeSaga?.externalPlan;
        if (existing?.version === 1 && Array.isArray(existing.channels) && Array.isArray(existing.googleOAuthTokens)) {
            return existing as PurgeExternalPlan;
        }

        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, isActive: true },
        });
        const credentials = await this.prisma.whatsappCredential.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
        const credentialFor = (type: string): string | undefined =>
            credentials.find((credential: any) => credential.credentialType === type)?.encryptedValue;
        const channels: PurgeChannelCredential[] = [];

        for (const account of accounts) {
            const alreadyDisconnected = (account.metadata as any)?.disconnected_at_provider === true;
            if (alreadyDisconnected) continue;

            let encryptedCredential: string | undefined;
            let wabaId: string | undefined;
            if (account.channelType === 'whatsapp') {
                encryptedCredential = credentialFor('system_user_token') || account.accessToken;
                const rows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT meta_waba_id FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
                    [account.accountId],
                );
                wabaId = rows?.[0]?.meta_waba_id;
                if (!wabaId) {
                    const onboarding = await this.prisma.whatsappOnboarding.findFirst({
                        where: { tenantId, phoneNumberId: account.accountId },
                        orderBy: { createdAt: 'desc' },
                        select: { wabaId: true },
                    });
                    wabaId = onboarding?.wabaId || undefined;
                }
            } else if (account.channelType === 'telegram') {
                encryptedCredential = credentialFor('telegram_token') || account.accessToken;
            } else if (account.channelType === 'messenger') {
                encryptedCredential = credentialFor('messenger_page_token') || account.accessToken;
            } else if (account.channelType === 'instagram') {
                encryptedCredential = credentialFor('instagram_token') || account.accessToken;
            } else {
                // Channels without a remote unlink API are removed from local
                // routing by the atomic public purge.
                continue;
            }

            if (!encryptedCredential || (account.channelType === 'whatsapp' && !wabaId)) {
                throw new ConflictException({
                    error: 'tenant_purge_missing_provider_credential',
                    channelType: account.channelType,
                    accountId: account.accountId,
                });
            }
            channels.push({
                channelType: account.channelType,
                accountId: account.accountId,
                wabaId,
                encryptedCredential,
            });
        }

        const googleOAuthTokens: string[] = [];
        try {
            const integrations = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT provider, encrypted_refresh_token FROM calendar_integrations`,
            );
            for (const integration of integrations || []) {
                if (String(integration.provider || '').toLowerCase() === 'google' && integration.encrypted_refresh_token) {
                    googleOAuthTokens.push(integration.encrypted_refresh_token);
                }
            }
        } catch (error: any) {
            // A legacy schema may predate calendar_integrations.  Any other
            // read error blocks the purge so credentials are not lost unseen.
            if (error?.code !== '42P01' && !String(error?.message).includes('does not exist')) throw error;
        }
        const gbpToken = settings?.googleBusiness?.encryptedRefreshToken;
        if (gbpToken) googleOAuthTokens.push(gbpToken);

        return {
            version: 1,
            capturedAt: new Date().toISOString(),
            channels,
            googleOAuthTokens: [...new Set(googleOAuthTokens)],
        };
    }

    /** Execute the previously captured, idempotent provider teardown. */
    private async executePurgeExternalPlan(tenantId: string, plan: PurgeExternalPlan): Promise<void> {
        const failures: string[] = [];
        for (const channel of plan.channels) {
            try {
                const credential = this.decryptToken(channel.encryptedCredential);
                let url: string;
                let method: 'DELETE' | 'POST';
                if (channel.channelType === 'whatsapp') {
                    url = `https://graph.facebook.com/v21.0/${channel.wabaId}/subscribed_apps?access_token=${credential}`;
                    method = 'DELETE';
                } else if (channel.channelType === 'telegram') {
                    url = `https://api.telegram.org/bot${credential}/deleteWebhook?drop_pending_updates=true`;
                    method = 'POST';
                } else if (channel.channelType === 'messenger') {
                    url = `https://graph.facebook.com/v21.0/${channel.accountId}/subscribed_apps?access_token=${credential}`;
                    method = 'DELETE';
                } else {
                    url = `https://graph.instagram.com/me/permissions?access_token=${credential}`;
                    method = 'DELETE';
                }
                const response = await fetch(url, { method });
                if (!response.ok && response.status !== 404 && response.status !== 410) {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error: any) {
                failures.push(`${channel.channelType}/${channel.accountId}: ${error.message}`);
            }
        }

        for (const encryptedToken of plan.googleOAuthTokens) {
            try {
                const response = await fetch('https://oauth2.googleapis.com/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ token: this.decryptToken(encryptedToken) }).toString(),
                });
                if (!response.ok && response.status !== 400) {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error: any) {
                failures.push(`google_oauth: ${error.message}`);
            }
        }

        if (failures.length > 0) {
            throw new Error(`External teardown incomplete (${failures.join('; ')})`);
        }
        this.logger.log(`[Purge ${tenantId}] External provider teardown completed`);
    }

    private decryptToken(encryptedValue: string): string {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');

        const key = Buffer.from(encryptionKey, 'hex');
        const parts = encryptedValue.split(':');
        if (parts.length !== 3) throw new Error('Invalid encrypted token format');

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = Buffer.from(parts[2], 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Force-reactivate channel_accounts for a tenant that was previously
     * offboarded. Used to repair tenants that lost their channels during a
     * cron run (e.g. tenant got past_due then was rescued by hand without
     * also flipping channel_accounts). This does NOT re-link the channel at
     * the provider — channels marked disconnected_at_provider=true still
     * require a fresh OAuth reconnect.
     */
    async reactivateChannels(tenantId: string): Promise<{ restored: number; needsReconnect: number }> {
        const restored = (await this.prisma.$queryRawUnsafe(
            `UPDATE channel_accounts
               SET is_active = true,
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                       'reactivated_at', NOW()::text,
                       'reactivated_by', 'admin_force'
                   ),
                   updated_at = NOW()
             WHERE tenant_id = $1::uuid
               AND is_active = false
               AND COALESCE((metadata->>'disconnected_at_provider')::boolean, false) = false
             RETURNING id, channel_type, account_id`,
            tenantId,
        )) as any[];
        const needsReconnect = await this.prisma.channelAccount.count({
            where: {
                tenantId,
                isActive: false,
                metadata: { path: ['disconnected_at_provider'], equals: true },
            },
        }).catch(() => 0);

        // Invalidate cache so the webhook starts seeing the channel again on the next message.
        await this.redis.del(`tenant:${tenantId}:schema`);

        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'channels_force_reactivated',
                    resource: 'offboarding',
                    details: { restored: restored.length, needsReconnect },
                },
            });
        } catch { /* non-blocking */ }

        this.logger.log(`[reactivateChannels ${tenantId}] restored=${restored.length} needsReconnect=${needsReconnect}`);
        return { restored: restored.length, needsReconnect };
    }

    /** Strict Redis cleanup used only after the schema has been removed. */
    private async cleanupPurgeRedis(tenantId: string, userIds: string[]): Promise<void> {
        const client = this.redis.getClient();
        const fenceKey = `tenant:purging:${tenantId}`;
        const patterns = [
            `tenant:${tenantId}:*`,
            `vertical:${tenantId}*`,
            `analytics:${tenantId}:*`,
            `offboard:past_due:${tenantId}`,
            `wa_token:${tenantId}`,
            `instagram_token:${tenantId}`,
            `messenger_token:${tenantId}`,
            `telegram_token:${tenantId}`,
            `sms_token:${tenantId}`,
            ...userIds.map((userId) => `refresh:${userId}:*`),
        ];

        for (const pattern of patterns) {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
                cursor = nextCursor;
                const deletable = keys.filter((key: string) => key !== fenceKey);
                if (deletable.length > 0) await client.del(...deletable);
            } while (cursor !== '0');
        }
    }

    /**
     * Re-entrant tenant purge saga.  Read-only credential capture happens
     * before DROP; every remote irreversible effect happens after the verified
     * DROP.  Public data is then removed atomically with the tenant identity
     * row last, so any failure is retryable without releasing slug/schema.
     */
    async purgeTenant(tenantId: string): Promise<{
        channelsDisconnected: number;
        publicRowsDeleted: Record<string, number>;
        schemaDropped: boolean;
        mediaFilesRemoved: number;
        usersRevoked: number;
    }> {
        const lockKey = `lock:tenant-purge:${tenantId}`;
        const lockTtlSeconds = 120;
        const lockToken = await this.redis.acquireLockToken(lockKey, lockTtlSeconds);
        if (!lockToken) throw new ConflictException({ error: 'tenant_purge_in_progress' });
        const lease = new OwnedLockLease(
            this.redis,
            lockKey,
            lockToken,
            lockTtlSeconds,
            this.logger,
            `Tenant purge lock lost for ${tenantId}`,
        );
        lease.start();

        try {
            await lease.assertOwned();
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, name: true, schemaName: true, settings: true },
            });
            if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

            const beforeChannels = await this.prisma.channelAccount.count({ where: { tenantId } });
            const users = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true } });
            const userIds = users.map((user: { id: string }) => user.id);
            const settings = (tenant.settings || {}) as any;
            const externalPlan = await this.capturePurgeExternalPlan(
                tenantId,
                tenant.schemaName,
                settings,
            );

            // Durable, encrypted saga checkpoint + hot-path access fence.
            await lease.assertOwned();
            await this.redis.set(`tenant:purging:${tenantId}`, '1', 7 * 24 * 60 * 60);
            await this.prisma.$executeRawUnsafe(
                `UPDATE public.tenants
                    SET is_active = false,
                        settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
                            'purgeSaga', COALESCE(settings->'purgeSaga', '{}'::jsonb) || jsonb_build_object(
                                'externalPlan', $2::jsonb,
                                'startedAt', COALESCE(settings->'purgeSaga'->'startedAt', to_jsonb(NOW()::text))
                            )
                        ),
                        updated_at = NOW()
                  WHERE id = $1::uuid`,
                tenantId,
                JSON.stringify(externalPlan),
            );

            let releaseQueueFence: (() => Promise<void>) | null = null;
            try {
                await lease.assertOwned();
                releaseQueueFence = await this.fenceQueuesForPurge(tenantId);
                await lease.assertOwned();
                await this.prisma.dropTenantSchema(tenant.schemaName);
            } finally {
                if (releaseQueueFence) await releaseQueueFence();
            }
            this.logger.log(`[Purge ${tenantId}] Schema "${tenant.schemaName}" dropped and verified`);

            if (settings?.purgeSaga?.externalCompleted !== true) {
                await lease.assertOwned();
                await this.executePurgeExternalPlan(tenantId, externalPlan);
                const subscription = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
                if (subscription?.providerSubscriptionId && !['cancelled', 'expired'].includes(subscription.status)) {
                    await lease.assertOwned();
                    await this.billing.cancelSubscription(tenantId, { immediate: true, reason: 'tenant_purge' });
                }
                await lease.assertOwned();
                await this.prisma.$executeRawUnsafe(
                    `UPDATE public.tenants
                        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb),
                            '{purgeSaga,externalCompleted}', 'true'::jsonb, true),
                            updated_at = NOW()
                      WHERE id = $1::uuid`,
                    tenantId,
                );
            }

            // All remaining irreversible local cleanup precedes the public DB
            // commit; a failure therefore leaves the tenant identity barrier.
            await lease.assertOwned();
            const mediaResult = await this.mediaService.deleteAllTenantFiles(tenantId);
            if (mediaResult.tenantDir && fs.existsSync(mediaResult.tenantDir)) {
                throw new Error(`Tenant media directory still exists after wipe: ${mediaResult.tenantDir}`);
            }
            await lease.assertOwned();
            await this.cleanupPurgeRedis(tenantId, userIds);
            await lease.assertOwned();
            const publicRowsDeleted = await this.prisma.purgeTenantPublicDataAtomic(
                tenantId,
                { name: tenant.name, schemaName: tenant.schemaName },
            );

            // The identity row is already committed away here, so no further
            // ownership assertion may turn a completed purge into a false
            // failure.  Notification is downstream/best-effort only.
            try {
                this.eventEmitter.emit('tenant.purged', {
                    tenantId,
                    tenantName: tenant.name,
                    schemaName: tenant.schemaName,
                    purgedAt: new Date(),
                });
            } catch (error: any) {
                this.logger.error(`[Purge ${tenantId}] Post-commit event failed: ${error.message}`);
            }
            return {
                channelsDisconnected: beforeChannels,
                publicRowsDeleted,
                schemaDropped: true,
                mediaFilesRemoved: mediaResult.removed,
                usersRevoked: userIds.length,
            };
        } finally {
            lease.stop();
            await this.redis.releaseLockToken(lockKey, lockToken)
                .catch((error: any) => this.logger.warn(`Could not release tenant purge lock: ${error.message}`));
        }
    }
}
