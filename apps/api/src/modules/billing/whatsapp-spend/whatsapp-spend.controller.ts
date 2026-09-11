import { BadRequestException, Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { SPEND_BLOCK_CODES } from './spend-diagnosis';

/**
 * ═══ WHAT META IS CHARGING THIS BUSINESS, AND WHY ═══
 *
 * From 1 October 2026 the tenant's own WhatsApp Business Account is billed for
 * every delivered service message. Parallly does not pay it and does not
 * receive it — which is exactly why this has to be visible inside Parallly.
 * From the outside the agent replying and the bill arriving look like one
 * product, and a business owner who cannot see the second inside the first
 * concludes that we are charging them twice.
 *
 * So this endpoint answers four questions, in the order somebody actually asks
 * them:
 *
 *   1. how much has this month cost, per currency, and how much of it is
 *      settled rather than merely at risk;
 *   2. how many of the free thousand are gone;
 *   3. where it went — which contacts, which categories, which markets;
 *   4. what is currently stopping anything from being sent, and what to do.
 *
 * Money is returned in MINOR UNITS with its currency beside it, never summed
 * across currencies and never pre-formatted: a number formatted on the server
 * is a number formatted in the wrong locale for somebody.
 */
@ApiTags('whatsapp-spend')
@Controller('whatsapp/spend')
export class WhatsappSpendController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly spend: WhatsappSpendService,
    ) {}

    /**
     * This period's exposure and where it went.
     *
     * `tenant_supervisor` can read it as well as an admin: the person watching
     * the inbox is usually the first to notice that messages stopped, and
     * making them ask somebody else to look at the reason is how an outage
     * lasts an afternoon.
     */
    @Get('summary')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'WhatsApp spend for the current period, per currency and per scope' })
    async summary(@Request() req: any, @Query('channelAccountId') channelAccountId?: string,
        @Query('days') days?: string) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new BadRequestException('Tenant has no schema');

        // Bounded here rather than trusted: an unbounded window is a full scan
        // of the busiest table this tenant has, asked for by a query string.
        const window = Math.min(370, Math.max(1, Number(days) || 30));
        const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
        const account = channelAccountId?.trim() || null;

        const [exposure, signals] = await Promise.all([
            this.spend.exposure(schema, { since, channelAccountId: account }),
            this.spend.signals(schema, { since, channelAccountId: account, limit: 10 }),
        ]);

        return {
            success: true,
            data: {
                windowDays: window,
                since: since.toISOString(),
                channelAccountId: account,
                // Per currency, never summed. A single total across pesos and
                // dollars is wrong in the way nobody notices until they act on it.
                exposure,
                signals,
                // The vocabulary the UI translates. Sent from the server so a
                // code added here cannot silently become an untranslated string
                // on a screen somebody is reading during an outage.
                refusalCodes: SPEND_BLOCK_CODES,
            },
        };
    }
}
