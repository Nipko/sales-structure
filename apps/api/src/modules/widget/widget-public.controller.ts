import { Controller, Get, Post, Body, Param, Headers, Logger, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WidgetService } from './widget.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('widget-public')
@Controller('widget')
export class WidgetPublicController {
    private readonly logger = new Logger(WidgetPublicController.name);

    constructor(
        private readonly widgetService: WidgetService,
        private readonly redis: RedisService,
    ) {}

    @Get('config/:widgetId')
    @ApiOperation({ summary: 'Get widget config (public)' })
    async getConfig(@Param('widgetId') widgetId: string) {
        const config = await this.widgetService.getConfig(widgetId);
        if (!config) return { success: false, error: 'Widget not found' };

        return {
            success: true,
            data: {
                widgetId: config.widget_id,
                primaryColor: config.primary_color,
                position: config.position,
                welcomeMessage: config.welcome_message,
                agentName: config.agent_name,
                agentAvatar: config.agent_avatar,
                preChatEnabled: config.pre_chat_enabled,
                preChatFields: config.pre_chat_fields,
                locale: config.locale,
                tenantName: config.tenant_name,
            },
        };
    }

    @Post('sessions')
    @ApiOperation({ summary: 'Create or resume a widget session (public)' })
    async createSession(
        @Body() body: { widgetId: string; visitorId: string; name?: string; email?: string; phone?: string; page?: string },
        @Headers('origin') origin: string,
    ) {
        const config = await this.widgetService.getConfig(body.widgetId);
        if (!config) return { success: false, error: 'Widget not found' };

        if (config.allowed_domains?.length > 0 && origin) {
            const allowed = config.allowed_domains.some((d: string) =>
                origin.endsWith(d) || origin.includes(d),
            );
            if (!allowed) throw new ForbiddenException('Origin not allowed');
        }

        const rateLimitKey = `widget:rate:${body.visitorId}:${body.widgetId}`;
        const current = await this.redis.get(rateLimitKey);
        if (current && parseInt(current) >= 5) {
            return { success: false, error: 'Rate limit exceeded' };
        }
        await this.redis.set(rateLimitKey, String((parseInt(current || '0')) + 1), 3600);

        const session = await this.widgetService.createSession(config, {
            visitorId: body.visitorId,
            name: body.name,
            email: body.email,
            phone: body.phone,
            page: body.page,
        });

        return { success: true, data: session };
    }

    @Post('sessions/refresh')
    @ApiOperation({ summary: 'Refresh a widget session token' })
    async refreshSession(@Body() body: { token: string }) {
        const session = await this.widgetService.getSessionByToken(body.token);
        if (!session) return { success: false, error: 'Invalid session' };

        return {
            success: true,
            data: {
                sessionId: session.id,
                conversationId: session.conversation_id,
            },
        };
    }
}
