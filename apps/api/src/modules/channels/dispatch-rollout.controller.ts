import { BadRequestException, Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DispatchRolloutService } from './dispatch-rollout.service';

/**
 * The operator's view of the durable dispatch switch.
 *
 * A kill switch nobody can read is not one. These endpoints exist so the state
 * can be inspected, changed deliberately, and turned off in a single call — with
 * the change audited and effective at once rather than after a cache expires.
 *
 * super_admin only, and platform-wide by design: this decides how replies leave
 * the system, which is never a tenant's own setting.
 */
@ApiTags('Dispatch rollout')
@Controller('dispatch-rollout')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class DispatchRolloutController {
    constructor(private readonly rollout: DispatchRolloutService) {}

    @Get()
    @ApiOperation({ summary: 'Effective durable dispatch rollout state (super_admin only)' })
    async state() {
        return { success: true, data: await this.rollout.state() };
    }

    @Put()
    @ApiOperation({ summary: 'Update the durable dispatch rollout (super_admin only)' })
    async set(@Body() body: any, @Req() request: any) {
        try {
            return { success: true, data: await this.rollout.set(body, {
                userId: request?.user?.id ?? null, email: request?.user?.email ?? null }) };
        } catch (error: any) {
            // A refused configuration is an operator mistake to surface now, not
            // a value to store and quietly ignore later.
            throw new BadRequestException(String(error?.message || 'dispatch_rollout_invalid'));
        }
    }

    @Post('disable')
    @ApiOperation({ summary: 'Turn the durable dispatch off for everyone (super_admin only)' })
    async disable(@Req() request: any) {
        return { success: true, data: await this.rollout.disable({
            userId: request?.user?.id ?? null, email: request?.user?.email ?? null }) };
    }
}
