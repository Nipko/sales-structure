import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Header,
    Headers,
    HttpException,
    HttpStatus,
    Param,
    Post,
    Req,
    Res,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { WidgetService } from './widget.service';
import { WidgetTriggersService } from './widget-triggers.service';
import { getLoaderScript } from './widget-loader';
import {
    CreateWidgetSessionDto,
    RefreshWidgetSessionDto,
    WidgetIdParamDto,
} from './dto/widget-public.dto';
import { isWidgetOriginAllowed, resolveWidgetHttpIp } from './widget-security';
import { WidgetRateLimitService } from './widget-rate-limit.service';

@ApiTags('widget-public')
@Controller('widget')
@UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
}))
export class WidgetPublicController {
    private cachedLoader: string | null = null;

    constructor(
        private readonly widgetService: WidgetService,
        private readonly triggersService: WidgetTriggersService,
        private readonly rateLimit: WidgetRateLimitService,
    ) {}

    @Get('loader.js')
    @ApiOperation({ summary: 'Serve embeddable widget script' })
    @Header('Content-Type', 'application/javascript; charset=utf-8')
    @Header('Cache-Control', 'public, max-age=3600')
    @Header('Access-Control-Allow-Origin', '*')
    async serveLoader(@Res() res: Response) {
        if (!this.cachedLoader) {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'https://api.parallly-chat.cloud/api/v1';
            this.cachedLoader = getLoaderScript(apiBase);
        }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(this.cachedLoader);
    }

    @Get('config/:widgetId')
    @ApiOperation({ summary: 'Get widget config (public)' })
    async getConfig(
        @Param() params: WidgetIdParamDto,
        @Headers('origin') origin?: string,
    ) {
        const config = await this.widgetService.getConfig(params.widgetId);
        if (!config) return { success: false, error: 'Widget not found' };
        this.assertOrigin(origin, config.allowed_domains);

        let triggers: any[] = [];
        try {
            triggers = await this.triggersService.getTriggersForWidget(config.tenant_id, config.id);
        } catch {
            // Table may not exist yet — ignore
        }

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
                triggers,
            },
        };
    }

    @Post('sessions')
    @ApiOperation({ summary: 'Create or resume a widget session (public)' })
    async createSession(
        @Body() body: CreateWidgetSessionDto,
        @Headers('origin') origin: string | undefined,
        @Req() request: Request,
    ) {
        const config = await this.widgetService.getConfig(body.widgetId);
        if (!config) return { success: false, error: 'Widget not found' };
        this.assertOrigin(origin, config.allowed_domains);

        const limit = await this.rateLimit.consumeSession({
            ip: resolveWidgetHttpIp(request),
            visitorId: body.visitorId,
            widgetId: config.widget_id,
            tenantId: config.tenant_id,
        });
        if (!limit.allowed) this.throwRateLimited(limit.retryAfterSeconds);

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
    async refreshSession(
        @Body() body: RefreshWidgetSessionDto,
        @Headers('origin') origin: string | undefined,
        @Req() request: Request,
    ) {
        const session = await this.widgetService.getSessionByToken(body.token);
        if (!session) return { success: false, error: 'Invalid session' };
        this.assertOrigin(origin, session.allowed_domains);

        const limit = await this.rateLimit.consumeSession({
            ip: resolveWidgetHttpIp(request),
            visitorId: session.visitor_id,
            widgetId: session.widget_id,
            tenantId: session.tenant_id,
        });
        if (!limit.allowed) this.throwRateLimited(limit.retryAfterSeconds);

        return {
            success: true,
            data: {
                sessionId: session.id,
                conversationId: session.conversation_id,
            },
        };
    }

    private assertOrigin(origin: string | undefined, allowedDomains: unknown): void {
        if (!isWidgetOriginAllowed(origin, allowedDomains)) {
            throw new ForbiddenException('Origin not allowed');
        }
    }

    private throwRateLimited(retryAfterSeconds: number): never {
        throw new HttpException(
            { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Rate limit exceeded', retryAfterSeconds },
            HttpStatus.TOO_MANY_REQUESTS,
        );
    }
}
