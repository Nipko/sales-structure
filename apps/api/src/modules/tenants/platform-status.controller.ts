import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RedisService } from '../redis/redis.service';

/**
 * Platform-wide status & maintenance announcement system.
 *
 * super_admin writes a maintenance entry (enabled flag, message, severity)
 * which is shown as a banner on EVERY user's dashboard (any tenant, any
 * role) until they dismiss it or the operator clears it. Use cases:
 *   - Pre-deploy notice ("Mantenimiento programado el viernes 22:00")
 *   - Active incident ("Estamos investigando latencia elevada en mensajes")
 *   - Post-incident resolved confirmation
 *
 * Storage: Redis singleton key. We don't put this in platform_settings
 * because it's operational state that should reset cleanly on Redis flush
 * — and we want sub-second propagation across instances.
 */

const REDIS_KEY = 'platform:maintenance';

interface MaintenanceConfig {
    enabled: boolean;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    /** Optional ISO timestamp — banner auto-clears past this time */
    expiresAt?: string | null;
    /** Server-set: who and when */
    setBy?: string | null;
    setAt?: string | null;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
    enabled: false,
    message: '',
    severity: 'info',
    expiresAt: null,
};

@ApiTags('platform-status')
@Controller('platform-status')
export class PlatformStatusController {
    constructor(private readonly redis: RedisService) {}

    /**
     * Public — every dashboard polls this every ~60s. Returns the current
     * maintenance config or the default disabled state. No auth so the
     * login page can show maintenance notices too.
     */
    @Get()
    @ApiOperation({ summary: 'Public read — current platform maintenance status' })
    async getStatus() {
        const cfg = await this.redis.getJson<MaintenanceConfig>(REDIS_KEY);
        const resolved = cfg || DEFAULT_CONFIG;

        // Auto-expire on read so we don't keep showing a stale banner
        if (resolved.enabled && resolved.expiresAt) {
            const exp = new Date(resolved.expiresAt).getTime();
            if (!Number.isNaN(exp) && exp < Date.now()) {
                const expired = { ...resolved, enabled: false };
                await this.redis.setJson(REDIS_KEY, expired);
                return { success: true, data: expired };
            }
        }

        return { success: true, data: resolved };
    }

    /**
     * super_admin only — set or clear the maintenance banner.
     * Pass enabled=false (with empty message) to clear.
     */
    @Put()
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Set maintenance banner — super_admin only' })
    async setStatus(@Body() body: Partial<MaintenanceConfig> & { actor?: string }) {
        const config: MaintenanceConfig = {
            enabled: !!body.enabled,
            message: (body.message || '').trim().substring(0, 500),
            severity: (body.severity === 'critical' || body.severity === 'warning') ? body.severity : 'info',
            expiresAt: body.expiresAt || null,
            setBy: body.actor || 'super_admin',
            setAt: new Date().toISOString(),
        };
        await this.redis.setJson(REDIS_KEY, config);
        return { success: true, data: config };
    }
}
