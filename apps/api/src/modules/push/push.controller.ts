import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
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
        @Body() body: { token: string },
    ) {
        await this.pushService.subscribeExpo(user.id || user.sub, user.tenantId, body.token);
        return { success: true };
    }
}
