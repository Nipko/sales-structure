import { Controller, Post, Body, UseGuards, Logger, Get, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { PushService } from './push.service';

@ApiTags('push')
@Controller('push')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PushController {
    private readonly logger = new Logger(PushController.name);

    constructor(private readonly pushService: PushService) {}

    @Get('preferences')
    @ApiOperation({ summary: 'Read notification preferences for the authenticated user' })
    async preferences(@CurrentUser() user: any) {
        return { success: true, data: await this.pushService.getPreferences(user.id || user.sub, user.tenantId) };
    }

    @Put('preferences')
    @ApiOperation({ summary: 'Replace notification preferences for the authenticated user' })
    async updatePreferences(@CurrentUser() user: any, @Body() body: unknown) {
        return { success: true, data: await this.pushService.updatePreferences(
            user.id || user.sub, user.tenantId, body,
        ) };
    }

    @Post('subscribe')
    @ApiOperation({ summary: 'Register push notification subscription' })
    async subscribe(
        @CurrentUser() user: any,
        @Body() body: { subscription: any },
    ) {
        await this.pushService.subscribe(user.id || user.sub, user.tenantId, body.subscription);
        return { success: true };
    }

    @Post('unsubscribe')
    @ApiOperation({ summary: 'Remove push notification subscription' })
    async unsubscribe(
        @CurrentUser() user: any,
        @Body() body: { endpoint: string },
    ) {
        await this.pushService.unsubscribe(user.id || user.sub, user.tenantId, body.endpoint);
        return { success: true };
    }

    @Post('expo-subscribe')
    @ApiOperation({ summary: 'Register a native Expo push token (mobile app)' })
    async expoSubscribe(
        @CurrentUser() user: any,
        @Body() body: { token: string; installationId: string },
    ) {
        await this.pushService.subscribeExpo(
            user.id || user.sub,
            user.tenantId,
            body.token,
            body.installationId,
        );
        return { success: true };
    }

    @Post('expo-unsubscribe')
    @ApiOperation({ summary: 'Remove native Expo push token(s) for the authenticated account' })
    async expoUnsubscribe(
        @CurrentUser() user: any,
        @Body() body: { token?: string },
    ) {
        await this.pushService.unsubscribeExpo(user.id || user.sub, user.tenantId, body?.token);
        return { success: true };
    }
}
