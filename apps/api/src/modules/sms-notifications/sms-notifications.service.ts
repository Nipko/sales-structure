import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';

/**
 * Per-tenant opt-in config for transactional SMS notifications, stored in
 * tenant.settings.smsNotifications (mirrors SlackService). SMS costs money and
 * requires a connected tenant SMS channel, so it is OFF by default; the tenant
 * enables it explicitly. Plan access is gated separately via the
 * `smsNotifications` plan feature (see SmsNotificationListenerService).
 */
export interface SmsNotificationsConfig {
    enabled: boolean;
    events: {
        handoff: boolean;
    };
}

const DEFAULT_CONFIG: SmsNotificationsConfig = {
    enabled: false,
    events: { handoff: true },
};

@Injectable()
export class SmsNotificationsService {
    private readonly logger = new Logger(SmsNotificationsService.name);

    constructor(private prisma: PrismaService) {}

    async getConfig(tenantId: string): Promise<SmsNotificationsConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as Record<string, any>) || {};
        const cfg = settings.smsNotifications as SmsNotificationsConfig | undefined;
        return {
            enabled: cfg?.enabled ?? false,
            events: { handoff: cfg?.events?.handoff ?? true },
        };
    }

    async updateConfig(tenantId: string, updates: Partial<SmsNotificationsConfig>): Promise<SmsNotificationsConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new BadRequestException('Tenant not found');

        const merged = await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'smsNotifications',
            (value): SmsNotificationsConfig => {
                const current = (value && typeof value === 'object'
                    ? value
                    : DEFAULT_CONFIG) as SmsNotificationsConfig;
                return {
                    enabled: updates.enabled ?? current.enabled ?? false,
                    events: { handoff: updates.events?.handoff ?? current.events?.handoff ?? true },
                };
            },
        );
        return merged;
    }
}
