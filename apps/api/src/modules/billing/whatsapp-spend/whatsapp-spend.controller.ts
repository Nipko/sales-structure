import {
    BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { SPEND_BLOCK_CODES } from './spend-diagnosis';
import { AccountPauseStore, PauseStateUnavailable } from '../../channels/account-pause-store';
import { describePause, isPaused } from '../../channels/account-send-pause';

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
        private readonly pauses: AccountPauseStore,
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

    /**
     * The effects nobody can decide without a person.
     *
     * `indeterminate` past the grace period: the request went out and no answer
     * ever came back — no receipt, no rejection, nothing. The money is counted
     * against the account and no amount of waiting will settle it, because Meta
     * sends a status for everything it accepted, so a row still here is either a
     * lost webhook or a message that never existed. Those have opposite answers.
     *
     * Read by the same three roles that read the summary: the person watching
     * the inbox is usually the first to notice, and making them ask somebody
     * else to look is how a stuck figure stays stuck for a month.
     */
    @Get('awaiting-resolution')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'WhatsApp effects whose delivery nobody can confirm' })
    async awaitingResolution(@Request() req: any, @Query('graceHours') graceHours?: string) {
        const schema = await this.schemaFor(req);
        const grace = Math.min(720, Math.max(1, Number(graceHours) || 72));
        const rows = await this.spend.awaitingResolution(schema, { graceHours: grace, limit: 200 });
        return {
            success: true,
            data: {
                graceHours: grace,
                // Only what a person needs to decide, and nothing that would
                // put a customer's phone number on a screen that does not
                // already show it: the ledger holds a hash, and it stays a hash.
                effects: rows.map(row => ({
                    effectKey: row.effectKey,
                    channelAccountId: row.identity.channelAccountId,
                    category: row.identity.category,
                    currency: row.identity.currency,
                    reservedMinor: row.money.reservedMinor,
                    basis: row.money.basis,
                    providerMessageId: row.providerMessageId,
                    reason: row.reason,
                    attempts: row.attempts,
                    createdAt: row.createdAt,
                })),
            },
        };
    }

    /**
     * A person deciding one of them.
     *
     * `tenant_supervisor` is deliberately NOT here. Reading the list is
     * operational; changing what a business is recorded as having spent is not,
     * and the reason is stored against whoever did it.
     */
    @Post('resolve')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Decide an effect whose delivery could not be confirmed' })
    async resolve(@Request() req: any, @Body() body: {
        effectKey?: string; decision?: string; reason?: string; chargedMinor?: number;
    }) {
        const schema = await this.schemaFor(req);
        const effectKey = String(body?.effectKey ?? '').trim();
        if (!effectKey) throw new BadRequestException('effectKey is required');
        if (body?.decision !== 'delivered' && body?.decision !== 'not_delivered') {
            throw new BadRequestException('decision must be "delivered" or "not_delivered"');
        }
        const reason = String(body?.reason ?? '').trim();
        // Required, and required HERE rather than only in the service: a
        // spending record adjusted with no stated reason is indistinguishable
        // from a mistake six months later, and the person making it is the only
        // one who can say which it was.
        if (reason.length < 8) {
            throw new BadRequestException(
                'reason is required and must say what evidence this decision is based on');
        }
        const charged = body?.chargedMinor;
        if (charged !== undefined && (!Number.isInteger(charged) || charged < 0)) {
            throw new BadRequestException('chargedMinor must be a whole number of minor units');
        }
        const resolved = await this.spend.resolveManually(schema, {
            effectKey, decision: body.decision, reason,
            actorId: String(req.user?.id ?? req.user?.userId ?? 'unknown'),
            chargedMinor: charged ?? null,
        });
        if (!resolved) {
            // Either it does not exist, or its money already moved. Both are
            // "there is nothing here to decide", and neither is a server fault.
            throw new BadRequestException(
                'That effect is not awaiting a decision: it does not exist, or it was already '
                + 'settled or released.');
        }
        return {
            success: true,
            data: {
                effectKey: resolved.effectKey,
                state: resolved.state,
                chargedMinor: resolved.chargedMinor,
                currency: resolved.identity.currency,
            },
        };
    }

    /**
     * Which of this tenant's numbers Meta has stopped billing, and what to do.
     *
     * A paused number is not a fault in Parallly and cannot be fixed here: Meta
     * refused to bill the business's own WhatsApp Business Account, and the
     * repair is a card added in Meta's interface. What this surface owes the
     * business is the FACT, in their own panel, next to the number it is about
     * — because from the outside "the agent stopped replying" looks like our
     * outage, and the one sentence that fixes it in ninety seconds is invisible
     * unless we say it.
     */
    @Get('pauses')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'WhatsApp numbers paused because Meta will not bill them' })
    async pausedNumbers(@Request() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, channelType: 'whatsapp' },
            select: { accountId: true, displayName: true },
        });
        const rows = await Promise.all(accounts.map(async account => {
            try {
                return { account, pause: await this.pauses.current(tenantId, account.accountId), unknown: false };
            } catch (error) {
                // The screen says UNKNOWN rather than "running". A panel that
                // renders an unreadable state as a healthy one is how an
                // operator concludes nothing is wrong while nothing is going
                // out — the same mistake the admission used to make, wearing a
                // user interface.
                if (!(error instanceof PauseStateUnavailable)) throw error;
                return { account, pause: null, unknown: true };
            }
        }));
        return {
            success: true,
            data: {
                numbers: rows.map(({ account, pause, unknown }) => ({
                    channelAccountId: account.accountId,
                    displayName: account.displayName ?? null,
                    paused: isPaused(pause),
                    /** True when we could not find out. Never the same as `false`. */
                    stateUnknown: unknown,
                    // The operator's sentence, built where the rule lives rather
                    // than assembled again in a component.
                    explanation: unknown
                        ? 'No pudimos leer el estado de cobro de este número. No es una pausa: '
                            + 'es que no pudimos comprobarlo, y mientras tanto no se envía.'
                        : (pause ? describePause(pause) : null),
                    since: pause?.since ?? null,
                    observations: pause?.observations ?? 0,
                    clearedAt: pause?.clearedAt ?? null,
                })),
            },
        };
    }

    /**
     * A person saying they fixed it, which is the only way out that does not
     * require the thing the pause prevents.
     *
     * ── THE DEADLOCK THIS EXISTS TO BREAK ───────────────────────────────────
     *
     * A pause lifts by itself when Meta accepts a message from the number —
     * proof produced by the platform rather than claimed by anybody, and the
     * best evidence there is. But a paused number sends nothing, so that proof
     * can never arrive: the only way to clear the pause would be to make a POST
     * the pause itself prevents.
     *
     * So a person may say "I added the card, try again". It is a claim, not
     * proof, and it is recorded as one — with who said it and when. If they are
     * wrong the very next message refuses and pauses the number again, which
     * costs one refusal rather than an afternoon of silence.
     *
     * `tenant_supervisor` may READ the list and may not do this: resuming is a
     * decision about the business's own billing.
     */
    @Post('pauses/:channelAccountId/resume')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Resume a WhatsApp number after fixing its payment method' })
    async resumeNumber(@Request() req: any, @Param('channelAccountId') channelAccountId: string,
        @Body() body: { note?: string }) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const account = String(channelAccountId ?? '').trim();
        if (!account) throw new BadRequestException('channelAccountId is required');
        // Scoped to this tenant's own numbers, by lookup rather than by trust:
        // the id comes out of a URL.
        const owned = await this.prisma.channelAccount.findFirst({
            where: { tenantId, channelType: 'whatsapp', accountId: account },
            select: { id: true },
        });
        if (!owned) throw new BadRequestException('That WhatsApp number does not belong to this tenant');

        const cleared = await this.pauses.clear(tenantId, account, {
            by: 'operator',
            note: String(body?.note ?? '').trim().slice(0, 300) || undefined,
        });
        return {
            success: true,
            data: {
                channelAccountId: account,
                paused: isPaused(cleared),
                // Said plainly, because the honest promise is narrow: sending is
                // allowed again, and whether it WORKS is Meta's answer to the
                // next message.
                message: 'Los envíos de este número quedan habilitados otra vez. Si Meta '
                    + 'vuelve a rechazar el cobro, el número se pausará solo en el próximo '
                    + 'intento y verás el motivo acá.',
            },
        };
    }

    private async schemaFor(req: any): Promise<string> {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new BadRequestException('Tenant has no schema');
        return schema;
    }
}
