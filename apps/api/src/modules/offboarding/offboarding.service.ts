import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class OffboardingService {
    private readonly logger = new Logger(OffboardingService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private mediaService: MediaService,
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
            where: { tenantId, isActive: true },
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
    private decryptToken(encryptedValue: string): string {
        const encryptionKey = process.env.ENCRYPTION_KEY;
        if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');

        const key = Buffer.from(encryptionKey, 'hex');
        const parts = encryptedValue.split(':');
        if (parts.length !== 3) throw new Error('Invalid encrypted token format');

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = Buffer.from(parts[2], 'hex');

        const crypto = require('crypto');
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

    /**
     * Hard-delete a tenant: orchestrates the full purge in the correct order.
     *  1. Provider unlink (Meta DELETE subscribed_apps, Telegram deleteWebhook,
     *     Instagram revoke, Twilio webhook clear) — disconnectAllChannels.
     *  2. Drain queues + revoke sessions (so no in-flight job touches the
     *     schema while we're deleting it).
     *  3. Delete public-schema rows that reference the tenant_id.
     *  4. DROP SCHEMA tenant_X CASCADE (wipes contacts, conversations,
     *     messages, properties, treatment_plans, real_estate_listings,
     *     tour_packages, media_files, etc.).
     *  5. Delete the tenants row itself.
     *  6. Wipe /data/media/{tenantId}/ from disk (logos, photos, attachments).
     *  7. Clear Redis: tenant:*, vertical:*, tenant_plan:*, refresh:*<userId>:*.
     *  8. Audit log + emit event.
     *
     * Use case: super_admin "delete tenant" button, or final step of long
     * cancellation flow. Irreversible. Returns a summary to surface in the UI.
     */
    async purgeTenant(tenantId: string): Promise<{
        channelsDisconnected: number;
        publicRowsDeleted: Record<string, number>;
        schemaDropped: boolean;
        mediaFilesRemoved: number;
        usersRevoked: number;
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, schemaName: true },
        });
        if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

        this.logger.log(`[Purge ${tenantId}] Starting — tenant=${tenant.name}, schema=${tenant.schemaName}`);

        // 1. Detach providers + flag channel_accounts (reuse the existing flow)
        const beforeChannels = await this.prisma.channelAccount.count({ where: { tenantId } });
        try {
            await this.disconnectAllChannels(tenantId);
        } catch (err: any) {
            this.logger.warn(`[Purge ${tenantId}] Provider disconnect partial: ${err.message}`);
        }

        // 2. Capture user IDs before delete to revoke their refresh tokens later
        const users = await this.prisma.user.findMany({
            where: { tenantId },
            select: { id: true },
        });
        const userIds = users.map((u: { id: string }) => u.id);

        // 3. Drain queues so nothing inflight touches the schema after drop
        try {
            await this.drainTenantQueues(tenantId);
        } catch (err: any) {
            this.logger.warn(`[Purge ${tenantId}] Queue drain partial: ${err.message}`);
        }

        // 4. Delete public-schema rows in FK-safe order
        const publicRowsDeleted: Record<string, number> = {};
        const safeDelete = async (label: string, fn: () => Promise<{ count: number } | any>) => {
            try {
                const res = await fn();
                publicRowsDeleted[label] = res.count ?? 0;
            } catch (err: any) {
                this.logger.warn(`[Purge ${tenantId}] Failed to delete ${label}: ${err.message}`);
                publicRowsDeleted[label] = -1;
            }
        };

        // billing_events depends on billing_subscriptions; do it first
        try {
            const subs = await this.prisma.billingSubscription.findMany({
                where: { tenantId }, select: { id: true },
            });
            const subIds = subs.map((s: { id: string }) => s.id);
            if (subIds.length > 0) {
                const r = await this.prisma.billingEvent.deleteMany({ where: { subscriptionId: { in: subIds } } });
                publicRowsDeleted['billing_events'] = r.count;
            } else {
                publicRowsDeleted['billing_events'] = 0;
            }
        } catch (err: any) {
            this.logger.warn(`[Purge ${tenantId}] billing_events: ${err.message}`);
        }

        await safeDelete('billing_payments', () => this.prisma.billingPayment.deleteMany({ where: { tenantId } }));
        await safeDelete('billing_subscriptions', () => this.prisma.billingSubscription.deleteMany({ where: { tenantId } }));
        await safeDelete('audit_logs', () => this.prisma.auditLog.deleteMany({ where: { tenantId } }));
        await safeDelete('channel_accounts', () => this.prisma.channelAccount.deleteMany({ where: { tenantId } }));
        await safeDelete('whatsapp_onboardings', () => this.prisma.whatsappOnboarding.deleteMany({ where: { tenantId } }));
        await safeDelete('whatsapp_credentials', () => this.prisma.whatsappCredential.deleteMany({ where: { tenantId } }));
        await safeDelete('tenant_financial_snapshots', () => this.prisma.tenantFinancialSnapshot.deleteMany({ where: { tenantId } }));
        await safeDelete('crm_connections', () => this.prisma.crmConnection.deleteMany({ where: { tenantId } }));
        await safeDelete('feature_request_votes', () => this.prisma.featureRequestVote.deleteMany({ where: { tenantId } }));
        await safeDelete('feature_request_comments', () => this.prisma.featureRequestComment.deleteMany({ where: { tenantId } }));
        try {
            // FeatureRequestSubscriber is keyed by userId, not tenantId
            if (userIds.length > 0) {
                const r = await this.prisma.featureRequestSubscriber.deleteMany({
                    where: { userId: { in: userIds } },
                });
                publicRowsDeleted['feature_request_subscribers'] = r.count;
            } else {
                publicRowsDeleted['feature_request_subscribers'] = 0;
            }
        } catch { publicRowsDeleted['feature_request_subscribers'] = -1; }
        await safeDelete('feature_requests', () => this.prisma.featureRequest.deleteMany({ where: { authorTenantId: tenantId } }));
        await safeDelete('users', () => this.prisma.user.deleteMany({ where: { tenantId } }));

        // 5. DROP SCHEMA — wipes everything per-tenant in one shot
        let schemaDropped = false;
        try {
            // Sanitize: schemaName from DB but defense in depth
            const safeName = tenant.schemaName.replace(/[^a-zA-Z0-9_]/g, '');
            if (safeName === tenant.schemaName) {
                await this.prisma.$queryRawUnsafe(`DROP SCHEMA IF EXISTS "${safeName}" CASCADE`);
                schemaDropped = true;
                this.logger.log(`[Purge ${tenantId}] Schema "${safeName}" dropped`);
            } else {
                this.logger.warn(`[Purge ${tenantId}] Refusing to drop suspicious schema name: ${tenant.schemaName}`);
            }
        } catch (err: any) {
            this.logger.error(`[Purge ${tenantId}] DROP SCHEMA failed: ${err.message}`);
        }

        // 6. Wipe filesystem (uploads: logos, product photos, property photos, etc.)
        const mediaResult = await this.mediaService.deleteAllTenantFiles(tenantId);

        // 7. Delete the tenant row itself
        try {
            await this.prisma.tenant.delete({ where: { id: tenantId } });
            publicRowsDeleted['tenants'] = 1;
        } catch (err: any) {
            this.logger.warn(`[Purge ${tenantId}] tenants row delete failed (already gone?): ${err.message}`);
            publicRowsDeleted['tenants'] = 0;
        }

        // 8. Redis: tenant-scoped keys + every user's refresh tokens
        try {
            await this.redis.del(`tenant:${tenantId}:config`);
            await this.redis.del(`tenant:${tenantId}:schema`);
            await this.redis.del(`tenant_plan:${tenantId}`);
            await this.redis.del(`vertical:${tenantId}`);
            await this.redis.del(`offboard:past_due:${tenantId}`);
            // Wildcard cleanup for any tenant:<id>:* not covered above
            const pattern = await (this.redis as any).keys?.(`tenant:${tenantId}:*`).catch(() => []);
            if (Array.isArray(pattern)) {
                for (const k of pattern) await this.redis.del(k);
            }
            // Refresh tokens are namespaced by userId
            for (const uid of userIds) {
                const userKeys = await (this.redis as any).keys?.(`refresh:${uid}:*`).catch(() => []);
                if (Array.isArray(userKeys)) {
                    for (const k of userKeys) await this.redis.del(k);
                }
            }
        } catch (err: any) {
            this.logger.warn(`[Purge ${tenantId}] Redis cleanup partial: ${err.message}`);
        }

        // 9. Final event so downstream listeners (analytics, BI, etc.) react
        try {
            this.eventEmitter.emit('tenant.purged', {
                tenantId,
                tenantName: tenant.name,
                schemaName: tenant.schemaName,
                purgedAt: new Date(),
            });
        } catch { /* non-blocking */ }

        this.logger.log(
            `[Purge ${tenantId}] Done — schema=${schemaDropped} media=${mediaResult.removed} users=${userIds.length}`,
        );

        return {
            channelsDisconnected: beforeChannels,
            publicRowsDeleted,
            schemaDropped,
            mediaFilesRemoved: mediaResult.removed,
            usersRevoked: userIds.length,
        };
    }
}
