import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OffboardingService {
    private readonly logger = new Logger(OffboardingService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
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

        // Best-effort: unsubscribe WhatsApp WABAs
        for (const account of accounts) {
            if (account.channelType === 'whatsapp') {
                try {
                    const metadata = account.metadata as any;
                    const wabaId = metadata?.wabaId || metadata?.meta_waba_id;
                    if (wabaId) {
                        const cred = await this.prisma.whatsappCredential.findFirst({
                            where: { tenantId, credentialType: 'system_user_token' },
                            orderBy: { createdAt: 'desc' },
                        });
                        if (cred?.encryptedValue) {
                            const accessToken = this.decryptToken(cred.encryptedValue);
                            await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ access_token: accessToken }),
                            }).catch(() => { /* best effort */ });
                        }
                    }
                } catch (error) {
                    this.logger.warn(`Failed to unsubscribe WhatsApp WABA for tenant ${tenantId}: ${error}`);
                }
            }

            if (account.channelType === 'telegram') {
                try {
                    const cred = await this.prisma.whatsappCredential.findFirst({
                        where: { tenantId, credentialType: 'telegram_token' },
                        orderBy: { createdAt: 'desc' },
                    });
                    if (cred?.encryptedValue) {
                        const botToken = this.decryptToken(cred.encryptedValue);
                        await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
                            method: 'POST',
                        }).catch(() => { /* best effort */ });
                    }
                } catch (error) {
                    this.logger.warn(`Failed to delete Telegram webhook for tenant ${tenantId}: ${error}`);
                }
            }
        }

        // Bulk deactivate all channel accounts
        await this.prisma.channelAccount.updateMany({
            where: { tenantId },
            data: { isActive: false },
        });

        // Bulk revoke credentials
        await this.prisma.$queryRawUnsafe(
            `UPDATE whatsapp_credentials SET rotation_state = 'revoked' WHERE tenant_id = $1::uuid`,
            tenantId,
        );

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
}
