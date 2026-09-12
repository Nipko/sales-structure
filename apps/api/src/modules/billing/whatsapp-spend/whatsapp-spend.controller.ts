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
import { wabaCalendarMonth } from '../whatsapp-rates/whatsapp-rate-resolver';
import { SPEND_SCOPE_KINDS, TENANT_DECLARABLE_SCOPE_KINDS, isTenantDeclarableScope }
    from './spend-scopes';
import { estimateCampaign } from './campaign-estimate';
import { approvedTemplateCategory } from '../../channels/dispatch-price-facts';
import { WHATSAPP_MESSAGE_CATEGORIES } from '../whatsapp-rates';
import { FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH } from './free-allowance';
import { AccountPauseStore, PauseStateUnavailable } from '../../channels/account-pause-store';
import { describePause, isPaused } from '../../channels/account-send-pause';
import {
    deliveryReadiness, neverAsked, readFundingFromRefusal, FUNDING_READINESS_STATES,
    type FundingReadiness,
} from '../../channels/whatsapp-funding-readiness';

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
     * What each number consumed, by the calendar the invoice uses.
     *
     * `summary` answers about a rolling window, which is the right shape for
     * "what is happening right now" and the wrong one for the two questions an
     * operator has before an invoice arrives. The thousand free service
     * deliveries reset at midnight on the first of the month IN THE WHATSAPP
     * ACCOUNT'S OWN TIME ZONE, and Meta invoices by calendar month. A rolling
     * thirty days straddles that boundary by construction, so somebody
     * comparing our figure to their allowance was comparing two different
     * periods and being told they disagreed.
     *
     * Read by the same three roles as the summary, for the same reason: the
     * person watching the inbox is usually the first to notice.
     */
    /**
     * `YYYY-MM` in the WABA's own zone, or `null` when we cannot say.
     *
     * `waba_timezone` is nullable — Meta does not always tell us, and the
     * backfill is best effort — and an unknown zone must NOT fall back to the
     * server's: that is the defect this exists to remove, and guessing would
     * put it back while looking as though it had been handled.
     */
    private async localMonthFor(tenantId: string, channelAccountId: string): Promise<string | null> {
        try {
            const [account] = await this.prisma.channelAccount.findMany({
                where: { tenantId, channelType: 'whatsapp', accountId: channelAccountId },
                select: { wabaTimezone: true },
                take: 1,
            });
            const zone = String(account?.wabaTimezone ?? '').trim();
            return zone ? wabaCalendarMonth(new Date(), zone) : null;
        } catch {
            // A reporting window is not worth failing a read for.
            return null;
        }
    }

    @Get('consumption')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'WhatsApp consumption per number per WABA-local calendar month' })
    async consumption(@Request() req: any, @Query('channelAccountId') channelAccountId?: string,
        @Query('months') months?: string) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new BadRequestException('Tenant has no schema');

        // Bounded here rather than trusted, the same as the summary window.
        const window = Math.min(24, Math.max(1, Number(months) || 3));
        const account = channelAccountId?.trim() || null;
        // ── THE WINDOW COUNTS BACK FROM THE ACCOUNT'S MONTH, NOT OURS ───────
        //
        // The rows are stamped `applied_local_date` in the WABA's own zone, and
        // the query used to bound them against the SERVER's month. At 23:30 on
        // 30 September in Bogota the server is already in October, so the
        // window gained or lost a whole month at exactly the boundary the
        // allowance resets on.
        //
        // Only resolvable for ONE account: asked about all of them, they can be
        // in different zones and there is no single month to count back from.
        // Then the server month stands, as a documented fallback rather than a
        // claim about anybody's calendar.
        const anchorMonth = account ? await this.localMonthFor(tenantId, account) : null;
        const rows = await this.spend.calendarMonthConsumption(schema, {
            channelAccountId: account, months: window, anchorMonth,
        });
        return {
            success: true,
            data: {
                months: window,
                /**
                 * The allowance every number gets, sent alongside so the client
                 * does not carry its own copy of a number Meta sets. A figure
                 * hardcoded in a dashboard is a figure that will be wrong the
                 * month Meta changes it and right nowhere.
                 */
                freeServiceDeliveriesPerNumberMonth: FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH,
                consumption: rows,
            },
        };
    }

    /**
     * Is each number ready to keep delivering after 1 October?
     *
     * The engine already reacts AFTER the fact — 131042 pauses the account and
     * shows the administrator what to resolve — and that is too late: the
     * tenant finds out when their customers stop getting answers. This is the
     * question asked before.
     *
     * ── WHAT THIS CAN AND CANNOT ANSWER TODAY ───────────────────────────────
     *
     * It reports what we KNOW, from evidence we already hold: a payment
     * eligibility refusal Meta actually made, which is `restricted`, and
     * otherwise `not_checked`. It does NOT reach out to Meta, so it cannot
     * return `attached` or `absent` — and it says so in `probe`, rather than
     * rendering a number nobody has checked as though it were healthy.
     *
     * That distinction is the whole point of the state machine behind it.
     * `not_checked` is not `absent`: telling a tenant their funding is missing
     * when nobody looked would send them to fix a problem they may not have,
     * and a tenant sent on one false errand does not act on the next warning.
     */
    @Get('funding-readiness')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Whether each number can still be charged, from evidence already held' })
    async fundingReadiness(@Request() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, channelType: 'whatsapp' },
            select: { accountId: true, displayName: true },
        });
        const numbers = await Promise.all(accounts.map(async account => {
            let reading: FundingReadiness = neverAsked();
            try {
                const pause = await this.pauses.current(tenantId, account.accountId);
                // A pause Meta caused for payment eligibility IS evidence about
                // funding, and it is the strongest we have: a refusal on a real
                // send outranks any reading of a configuration field.
                const observed = isPaused(pause)
                    ? readFundingFromRefusal(
                        { errorCode: pause!.code, detail: pause!.detail },
                        new Date(pause!.lastSeen))
                    : null;
                if (observed) reading = observed;
            } catch (error) {
                // Unreadable is not healthy, and it is not "no card" either.
                if (!(error instanceof PauseStateUnavailable)) throw error;
                reading = neverAsked();
            }
            return {
                channelAccountId: account.accountId,
                displayName: account.displayName ?? null,
                state: reading.state,
                source: reading.source,
                detail: reading.detail,
                checkedAt: reading.checkedAt?.toISOString() ?? null,
                actionable: reading.actionable,
                delivery: deliveryReadiness(reading),
            };
        }));
        return {
            success: true,
            data: {
                states: FUNDING_READINESS_STATES,
                numbers,
                /**
                 * Said out loud rather than implied by an absence. A screen that
                 * renders "we have not checked" the same as "checked and fine"
                 * is the defect this whole module exists to avoid, and a client
                 * cannot avoid it without being told which one it is looking at.
                 */
                probe: {
                    reachesMeta: false,
                    note: 'Hoy esto informa lo que ya sabemos: un rechazo de elegibilidad de pago '
                        + 'que Meta hizo de verdad. No consulta a Meta, así que no puede afirmar '
                        + 'que haya tarjeta ni que falte. «No comprobado» no es «sin tarjeta».',
                },
            },
        };
    }

    /**
     * The standing ceilings somebody set on this tenant's sending.
     *
     * The ledger has honoured these since it was built and nothing ever wrote
     * one, so a tenant could not say "never more than fifty dollars a month on
     * this number" — the first thing anybody asks for when messages start
     * costing money. The mechanism was there; the door was not.
     */
    @Get('ceilings')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Standing WhatsApp spend ceilings and what is committed against them' })
    async ceilings(@Request() req: any, @Query('period') period?: string,
        @Query('scopeKind') scopeKind?: string) {
        const schema = await this.schemaFor(req);
        const kind = scopeKind?.trim() || null;
        if (kind && !(SPEND_SCOPE_KINDS as readonly string[]).includes(kind)) {
            throw new BadRequestException(`scopeKind must be one of ${SPEND_SCOPE_KINDS.join(', ')}`);
        }
        return {
            success: true,
            data: {
                /**
                 * What a caller may SET, which is not what it may READ.
                 *
                 * This field sits beside the ceilings a form is about to
                 * edit, so it is the list that form offers. Advertising
                 * `SPEND_SCOPE_KINDS` here offered `number_month` — which
                 * the POST refuses, and refuses for a reason: that row IS
                 * Meta's free thousand, so a tenant writing to it either
                 * mints free deliveries Meta bills in full or destroys the
                 * allowance outright. A menu whose entries the server
                 * rejects is a 400 the screen walked into.
                 *
                 * The wider list stays, named for what it is: the
                 * `scopeKind` FILTER above accepts every kind, because
                 * reading a `number_month` ceiling is exactly how somebody
                 * checks how much of the free allowance is left.
                 */
                scopeKinds: TENANT_DECLARABLE_SCOPE_KINDS,
                readableScopeKinds: SPEND_SCOPE_KINDS,
                ceilings: await this.spend.ceilings(schema, {
                    periodKey: period?.trim() || null, scopeKind: kind as any,
                }),
                /**
                 * Said by the server, once, so no screen has to compose it and
                 * none can quietly omit it. A ceiling bounds what PARALLLY
                 * sends; the same WhatsApp account can be charged by another
                 * app or by Meta's own inbox, and the invoice shows all of it.
                 */
                scopeNote: 'Estos topes acotan lo que envía Parallly desde esta cuenta. '
                    + 'Los cargos que otra aplicación, o la bandeja de Meta, hagan sobre la misma '
                    + 'cuenta de WhatsApp quedan fuera y aparecerán igual en la factura de Meta.',
            },
        };
    }

    /**
     * Set, change or remove one.
     *
     * `tenant_admin` and above only: a supervisor reads the figures because
     * they are the first to notice messages stopping, but changing what the
     * business is allowed to spend is not their decision.
     */
    @Post('ceilings')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Set a standing WhatsApp spend ceiling' })
    async setCeiling(@Request() req: any, @Body() body: {
        scopeKind?: string; scopeKey?: string; period?: string;
        capMinor?: number | null; capDeliveries?: number | null; currency?: string | null;
        warnPermille?: number; softPermille?: number;
    }) {
        const schema = await this.schemaFor(req);
        const kind = String(body?.scopeKind ?? '').trim();
        const key = String(body?.scopeKey ?? '').trim();
        const period = String(body?.period ?? '').trim();
        // Not `SPEND_SCOPE_KINDS`: that list includes `number_month`, which is
        // Meta's free allowance rather than a ceiling anybody set. Accepting it
        // here let a tenant_admin mint free deliveries Meta bills in full, or
        // destroy the allowance so every message was charged from the first.
        if (!isTenantDeclarableScope(kind)) {
            throw new BadRequestException('scopeKind must be one of '
                + `${TENANT_DECLARABLE_SCOPE_KINDS.join(', ')}. `
                + 'La franquicia gratuita del número no es un techo editable.');
        }
        // A ceiling on nothing, or on every period at once, is not a ceiling.
        if (!key || key.length > 200) throw new BadRequestException('scopeKey is required');
        if (!/^\d{4}-\d{2}$/.test(period)) {
            throw new BadRequestException('period must be a calendar month, as YYYY-MM');
        }
        try {
            return {
                success: true,
                data: await this.spend.setCeiling(schema, {
                    scope: { kind, key, period },
                    capMinor: body?.capMinor ?? null,
                    capDeliveries: body?.capDeliveries ?? null,
                    currency: body?.currency ?? null,
                    warnPermille: body?.warnPermille,
                    softPermille: body?.softPermille,
                }),
            };
        } catch (error: any) {
            // The ledger's refusals are answers, not outages: a money ceiling
            // with no currency, thresholds that cross over. They come back as
            // a 400 with the code, never as a 500.
            if (typeof error?.code === 'string' && error.code.startsWith('spend_ceiling_')) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }

    /**
     * What a campaign would cost, before anybody presses send.
     *
     * A campaign to four thousand people is a purchase, and the product asked
     * an operator to confirm it with no figure attached — the first time
     * anybody saw the number was on Meta's invoice.
     *
     * The template's approved CATEGORY is read here rather than taken from the
     * caller: Meta charges by it, it is synced into this tenant's own
     * catalogue, and a category supplied by a client is a category a client can
     * get wrong in the cheap direction.
     */
    @Post('campaign-estimate')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Upper bound on what a campaign costs, per market' })
    async campaignEstimate(@Request() req: any, @Body() body: {
        channelAccountId?: string; templateName?: string; currency?: string;
        wabaTimeZone?: string;
        recipients?: { recipientRef?: string; address?: string | null }[];
    }) {
        const schema = await this.schemaFor(req);
        const channelAccountId = String(body?.channelAccountId ?? '').trim();
        const templateName = String(body?.templateName ?? '').trim();
        const recipients = Array.isArray(body?.recipients) ? body!.recipients! : [];
        if (!channelAccountId) throw new BadRequestException('channelAccountId is required');
        if (!recipients.length) throw new BadRequestException('recipients is required');
        // Bounded: an estimate is cheap per recipient and not free, and an
        // unbounded list is a request that pins a worker.
        if (recipients.length > 50_000) {
            throw new BadRequestException('estimate at most 50000 recipients at a time');
        }

        // `null` when the catalogue does not have it. Deliberately not a
        // default: every recipient then comes back unpriced with that reason,
        // which tells the operator to sync their templates rather than showing
        // them a number computed from an assumption.
        const category = templateName
            ? await approvedTemplateCategory(
                (sql, params) => this.prisma.executeInTenantSchema(schema, sql, params ?? []),
                { templateName, channelAccountId }).catch(() => null)
            : null;
        const known = category
            && (WHATSAPP_MESSAGE_CATEGORIES as readonly string[])
                .includes(String(category).toLowerCase())
            ? String(category).toLowerCase() as any
            : null;

        return {
            success: true,
            data: estimateCampaign({
                recipients: recipients.map((row, index) => ({
                    recipientRef: String(row?.recipientRef ?? `r${index}`),
                    address: row?.address ?? null,
                })),
                category: known,
                categoryDetail: templateName,
                channelAccountId,
                currency: String(body?.currency ?? 'USD'),
                wabaTimeZone: String(body?.wabaTimeZone ?? 'America/Bogota'),
                at: new Date(),
            }),
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
