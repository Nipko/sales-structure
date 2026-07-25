import {
    Controller,
    Get,
    Post,
    Body,
    Query,
    Param,
    Res,
    Logger,
    Inject,
    forwardRef,
    Headers,
    Req,
    RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { ChannelGatewayService } from './channel-gateway.service';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelType } from '@parallext/shared';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappWebhookService } from '../whatsapp/services/whatsapp-webhook.service';
import { ChannelTokenService } from './channel-token.service';
import { validateMetaSignature } from './meta-signature.util';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
    private readonly logger = new Logger(ChannelsController.name);

    constructor(
        private gateway: ChannelGatewayService,
        private whatsappAdapter: WhatsAppAdapter,
        private instagramAdapter: InstagramAdapter,
        private messengerAdapter: MessengerAdapter,
        private telegramAdapter: TelegramAdapter,
        private prisma: PrismaService,
        @Inject(forwardRef(() => ConversationsService))
        private conversationsService: ConversationsService,
        @Inject(forwardRef(() => WhatsappWebhookService))
        private whatsappWebhookService: WhatsappWebhookService,
        private configService: ConfigService,
        private redis: RedisService,
        private channelToken: ChannelTokenService,
    ) { }

    // ==========================================
    // WhatsApp
    // ==========================================

    @Get('webhook/whatsapp')
    @ApiOperation({ summary: 'WhatsApp webhook verification' })
    verifyWhatsApp(@Query() query: any, @Res() res: Response) {
        const challenge = this.whatsappAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/whatsapp')
    @ApiOperation({ summary: 'Receive WhatsApp webhook events' })
    async receiveWhatsApp(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        if (!this.whatsappWebhookService.validateSignature(req.rawBody, signature)) {
            return res.status(401).send('Invalid signature');
        }

        this.whatsappWebhookService.handleWebhookPayload(body).catch((error) => {
            this.logger.error(`Error processing WhatsApp webhook: ${error}`);
        });

        return res.status(200).send('OK');
    }

    // ==========================================
    // Instagram DM
    // ==========================================

    @Get('webhook/instagram')
    @ApiOperation({ summary: 'Instagram webhook verification' })
    verifyInstagram(@Query() query: any, @Res() res: Response) {
        const challenge = this.instagramAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/instagram')
    @ApiOperation({ summary: 'Receive Instagram DM webhook events' })
    async receiveInstagram(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        // Instagram uses its own app secret (different Meta App than WhatsApp)
        const appSecret = this.configService.get<string>('INSTAGRAM_APP_SECRET')
            || this.configService.get<string>('META_APP_SECRET')
            || this.configService.get<string>('WHATSAPP_APP_SECRET');
        if (!validateMetaSignature(req.rawBody, signature, appSecret)) {
            return res.status(401).send('Invalid signature');
        }

        res.status(200).send('OK');

        try {
            // Process EVERY entry/messaging event — Meta can batch several in one
            // webhook; taking only entry[0].messaging[0] silently dropped the rest.
            const entries = Array.isArray(body?.entry) ? body.entry : [];
            for (const entry of entries) {
                const igUserId = entry?.id;
                if (!igUserId) continue;

                const channelAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'instagram', accountId: igUserId, isActive: true },
                });
                if (!channelAccount) {
                    this.logger.warn(`No tenant found for Instagram IG User ID: ${igUserId}`);
                    continue;
                }

                const messagingItems = Array.isArray(entry?.messaging) ? entry.messaging : [];
                for (const messagingItem of messagingItems) {
                    // Per-message idempotency (atomic SET NX).
                    const messageId = messagingItem?.message?.mid;
                    if (messageId) {
                        const claimed = await this.redis.acquireLock(`idem:ig:${messageId}`, 86400);
                        if (!claimed) continue;
                    }
                    // Synthesize a single-item payload for the adapter (it reads entry[0].messaging[0]).
                    const singlePayload = { ...body, entry: [{ ...entry, messaging: [messagingItem] }] };
                    const normalized = await this.gateway.processIncomingWebhook('instagram', singlePayload, igUserId);
                    if (!normalized) continue;
                    normalized.tenantId = channelAccount.tenantId;
                    await this.enrichIgProfileAndProcess(normalized, channelAccount.tenantId);
                }
            }
        } catch (error) {
            this.logger.error(`Error processing Instagram webhook: ${error}`);
        }
    }

    /** Fetch the IG sender profile (cached 1h) and dispatch the message to the pipeline. */
    private async enrichIgProfileAndProcess(normalized: any, tenantId: string): Promise<void> {
        if (normalized.contactId) {
            const igCacheKey = `ig_profile:${normalized.contactId}`;
            const cachedProfile = await this.redis.getJson<any>(igCacheKey);
            if (cachedProfile) {
                normalized.metadata = { ...normalized.metadata, ...cachedProfile };
            } else try {
                const token = await this.channelToken.getChannelToken(tenantId, 'instagram');
                const profileRes = await fetch(
                    `https://graph.instagram.com/v21.0/${normalized.contactId}?fields=name,username,profile_pic&access_token=${token.accessToken}`,
                );
                const profileBody = await profileRes.json() as any;
                this.logger.log(`[IG Profile] ${normalized.contactId} → status=${profileRes.status} name=${profileBody.name || ''} username=${profileBody.username || ''}`);
                if (profileRes.ok && !profileBody.error) {
                    const username = profileBody.username || '';
                    const displayName = profileBody.name
                        ? (username ? `${profileBody.name} (@${username})` : profileBody.name)
                        : (username ? `@${username}` : '');
                    const profileData = {
                        contactName: displayName,
                        contactUsername: username,
                        contactProfilePic: profileBody.profile_pic || profileBody.profile_picture_url || '',
                    };
                    normalized.metadata = { ...normalized.metadata, ...profileData };
                    await this.redis.setJson(igCacheKey, profileData, 3600);
                }
            } catch (e: any) {
                this.logger.warn(`Could not fetch IG sender profile: ${e.message}`);
            }
        }

        this.logger.log(`Incoming Instagram DM for tenant ${tenantId} from ${normalized.contactId}`);
        await this.conversationsService.processIncomingMessage(normalized);
    }

    // ==========================================
    // Facebook Messenger
    // ==========================================

    @Get('webhook/messenger')
    @ApiOperation({ summary: 'Messenger webhook verification' })
    verifyMessenger(@Query() query: any, @Res() res: Response) {
        const challenge = this.messengerAdapter.verifyWebhook(query);
        if (challenge) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    @Post('webhook/messenger')
    @ApiOperation({ summary: 'Receive Messenger webhook events' })
    async receiveMessenger(
        @Body() body: any,
        @Headers('x-hub-signature-256') signature: string,
        @Req() req: RawBodyRequest<Request>,
        @Res() res: Response,
    ) {
        const appSecret = this.configService.get<string>('META_APP_SECRET') || this.configService.get<string>('WHATSAPP_APP_SECRET');
        if (!validateMetaSignature(req.rawBody, signature, appSecret)) {
            return res.status(401).send('Invalid signature');
        }

        res.status(200).send('OK');

        try {
            // Process EVERY entry/messaging event — Meta can batch several in one
            // webhook; taking only entry[0].messaging[0] silently dropped the rest.
            const entries = Array.isArray(body?.entry) ? body.entry : [];
            for (const entry of entries) {
                const pageId = entry?.id;
                if (!pageId) continue;

                const channelAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'messenger', accountId: pageId, isActive: true },
                });
                if (!channelAccount) {
                    this.logger.warn(`No tenant found for Messenger Page ID: ${pageId}`);
                    continue;
                }

                const messagingItems = Array.isArray(entry?.messaging) ? entry.messaging : [];
                for (const messagingItem of messagingItems) {
                    const messageId = messagingItem?.message?.mid;
                    if (messageId) {
                        const claimed = await this.redis.acquireLock(`idem:fb:${messageId}`, 86400);
                        if (!claimed) continue;
                    }
                    const singlePayload = { ...body, entry: [{ ...entry, messaging: [messagingItem] }] };
                    const normalized = await this.gateway.processIncomingWebhook('messenger', singlePayload, pageId);
                    if (!normalized) continue;
                    normalized.tenantId = channelAccount.tenantId;
                    await this.enrichFbProfileAndProcess(normalized, channelAccount.tenantId);
                }
            }
        } catch (error) {
            this.logger.error(`Error processing Messenger webhook: ${error}`);
        }
    }

    /** Fetch the Messenger sender profile (cached 1h) and dispatch the message to the pipeline. */
    private async enrichFbProfileAndProcess(normalized: any, tenantId: string): Promise<void> {
        if (normalized.contactId) {
            const fbCacheKey = `fb_profile:${normalized.contactId}`;
            const cachedFbProfile = await this.redis.getJson<any>(fbCacheKey);
            if (cachedFbProfile) {
                normalized.metadata = { ...normalized.metadata, ...cachedFbProfile };
            } else try {
                const token = await this.channelToken.getChannelToken(tenantId, 'messenger');
                const profileRes = await fetch(
                    `https://graph.facebook.com/v21.0/${normalized.contactId}?fields=name,profile_pic&access_token=${token.accessToken}`,
                );
                const fbProfileBody = await profileRes.json() as any;
                this.logger.log(`[FB Profile] ${normalized.contactId} → status=${profileRes.status} name=${fbProfileBody.name || ''}`);
                if (profileRes.ok && !fbProfileBody.error) {
                    const profileData = {
                        contactName: fbProfileBody.name || fbProfileBody.first_name || '',
                        contactProfilePic: fbProfileBody.profile_pic || '',
                    };
                    if (profileData.contactName || profileData.contactProfilePic) {
                        normalized.metadata = { ...normalized.metadata, ...profileData };
                        await this.redis.setJson(fbCacheKey, profileData, 3600);
                    }
                }
            } catch (e: any) {
                this.logger.warn(`Could not fetch Messenger sender profile: ${e.message}`);
            }
        }

        this.logger.log(`Incoming Messenger message for tenant ${tenantId} from ${normalized.contactId}`);
        await this.conversationsService.processIncomingMessage(normalized);
    }

    // ==========================================
    // Telegram
    // ==========================================

    // ── SMS / Twilio Webhook ──────────────────────────────────

    @Post('webhook/sms/:phoneNumber')
    @ApiOperation({ summary: 'Receive inbound SMS from Twilio' })
    async receiveSms(
        @Param('phoneNumber') phoneNumber: string,
        @Body() body: any,
        @Headers('x-twilio-signature') twilioSignature: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        // Twilio expects TwiML response; empty <Response/> = acknowledge
        res.type('text/xml').status(200).send('<Response/>');

        const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        await this.processSmsWebhook(body, phoneNumber, twilioSignature, webhookUrl);
    }

    /**
     * Validates a Twilio webhook signature (HMAC-SHA1).
     *
     * Algorithm:
     * 1. Start with the full webhook URL
     * 2. Sort POST params alphabetically by key
     * 3. Append each key+value (no separator) to the URL string
     * 4. HMAC-SHA1 the result with the Twilio Auth Token
     * 5. Base64 encode → compare to X-Twilio-Signature header
     */
    private validateTwilioSignature(
        webhookUrl: string,
        params: Record<string, string>,
        signature: string,
        authToken: string,
    ): boolean {
        try {
            const data = Object.keys(params)
                .sort()
                .reduce((acc, key) => acc + key + params[key], webhookUrl);

            const expectedSig = crypto
                .createHmac('sha1', authToken)
                .update(data, 'utf-8')
                .digest('base64');

            const expectedBuf = Buffer.from(expectedSig);
            const actualBuf = Buffer.from(signature);

            if (expectedBuf.length !== actualBuf.length) return false;

            return crypto.timingSafeEqual(expectedBuf, actualBuf);
        } catch {
            return false;
        }
    }

    private async processSmsWebhook(
        body: any,
        phoneNumber: string,
        twilioSignature?: string,
        webhookUrl?: string,
    ): Promise<void> {
        try {
            const channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'sms', accountId: phoneNumber, isActive: true },
            });

            if (!channelAccount) {
                this.logger.warn(`No SMS channel account found for phone: ${phoneNumber}`);
                return;
            }

            // ── Twilio signature validation (BEFORE any side effect) ──
            // Resolve the auth token from the per-account encrypted credential
            // (stored as "accountSid:authToken" in channel_accounts.access_token),
            // falling back to legacy metadata / a platform-level env var. Without
            // this the token was never found and the signature check was skipped —
            // i.e. inbound SMS webhooks were accepted UNVERIFIED.
            let authToken = (channelAccount.metadata as any)?.twilioAuthToken as string | undefined;
            if (!authToken) {
                try {
                    const creds = await this.channelToken.getChannelToken(channelAccount.tenantId, 'sms', phoneNumber);
                    authToken = (creds?.accessToken || '').split(':')[1] || undefined;
                } catch { /* fall through to env / skip */ }
            }
            if (!authToken) authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');

            if (!authToken) {
                this.logger.warn(
                    `No Twilio Auth Token resolvable for SMS account ${phoneNumber} — skipping signature validation`,
                );
            } else if (!twilioSignature || !webhookUrl) {
                this.logger.warn(
                    `Missing X-Twilio-Signature header for SMS webhook on ${phoneNumber} — skipping validation`,
                );
            } else if (!this.validateTwilioSignature(webhookUrl, body || {}, twilioSignature, authToken)) {
                this.logger.warn(
                    `Invalid Twilio signature for SMS webhook on ${phoneNumber} — rejecting request`,
                );
                return;
            }

            // Idempotency AFTER auth — claimed atomically (SET NX). Setting it
            // before signature validation let an attacker (or a spoofed SID) burn
            // the key and make the real, signed message be dropped as a duplicate.
            const messageSid = body?.MessageSid;
            if (messageSid) {
                const claimed = await this.redis.acquireLock(`idem:sms:${messageSid}`, 86400);
                if (!claimed) return;
            }

            const adapter = this.gateway.getAdapter('sms');
            if (!adapter) return;

            const normalized = await adapter.handleWebhook(body, phoneNumber);
            if (!normalized) return;

            normalized.tenantId = channelAccount.tenantId;
            await this.conversationsService.processIncomingMessage(normalized);
            this.logger.log(`Incoming SMS from ${body?.From} to ${phoneNumber}`);
        } catch (error) {
            this.logger.error(`Error processing SMS webhook: ${error}`);
        }
    }

    // ── Telegram Webhook ────────────────────────────────────

    @Post('webhook/telegram/:botUsername')
    @ApiOperation({ summary: 'Receive Telegram Bot webhook updates (bot-specific URL)' })
    async receiveTelegramByBot(
        @Param('botUsername') botUsername: string,
        @Body() body: any,
        @Headers('x-telegram-bot-api-secret-token') secretToken: string,
        @Res() res: Response,
    ) {
        // ACK only AFTER the cheap synchronous stage (resolve+validate+idem,
        // milliseconds). Telegram retries an update until it sees a 200 and
        // keeps it ~24h — acking first threw that guarantee away: an update
        // arriving while the API drains for a deploy got its 200 and then the
        // processing died with the process. Now that update gets a 5xx/timeout
        // and Telegram redelivers it to the new container.
        await this.processTelegramUpdate(body, botUsername, secretToken);
        res.status(200).send('OK');
    }

    @Post('webhook/telegram')
    @ApiOperation({ summary: 'Receive Telegram Bot webhook updates (generic)' })
    async receiveTelegram(
        @Body() body: any,
        @Headers('x-telegram-bot-api-secret-token') secretToken: string,
        @Res() res: Response,
    ) {
        await this.processTelegramUpdate(body, null, secretToken);
        res.status(200).send('OK');
    }

    /**
     * Cheap synchronous stage of a Telegram update. Runs BEFORE the 200 to
     * Telegram, so an infrastructure failure here (DB/Redis down, restart)
     * propagates as a non-200 and Telegram redelivers. Expected discards
     * (unknown bot, secret mismatch, duplicate, non-message update) return
     * normally — those SHOULD be acked so Telegram stops retrying them.
     * The heavy tail (profile photo + AI turn) stays fire-and-forget.
     */
    private async processTelegramUpdate(body: any, botUsername: string | null, secretToken?: string): Promise<void> {
        // Resolve the EXACT bot first. NEVER fall back to "any active telegram
        // bot" — with more than one tenant on Telegram that routed updates to
        // the wrong tenant (cross-tenant message leak).
        let channelAccount: any = null;

        if (botUsername) {
            channelAccount = await this.prisma.channelAccount.findFirst({
                where: { channelType: 'telegram', accountId: botUsername, isActive: true },
            });
        }

        // Generic route (no botUsername in the URL): identify the bot by its
        // per-bot webhook secret token. Only matches a bot that actually has a
        // secret configured, so it can never silently pick the wrong one.
        if (!channelAccount && secretToken) {
            const candidates = await this.prisma.channelAccount.findMany({
                where: { channelType: 'telegram', isActive: true },
            });
            channelAccount = candidates.find((c: any) => {
                const s = (c.metadata as any)?.webhookSecret;
                return s && s === secretToken;
            }) || null;
        }

        if (!channelAccount) {
            this.logger.warn(`No tenant resolved for Telegram update (bot=${botUsername || 'generic'}) — discarding`);
            return;
        }

        // Validate webhook secret if configured on this bot (defense in depth).
        const expectedSecret = (channelAccount.metadata as any)?.webhookSecret;
        if (expectedSecret && secretToken !== expectedSecret) {
            this.logger.warn(`Telegram webhook secret mismatch for bot ${botUsername || channelAccount.accountId}`);
            return;
        }

        // Idempotency — namespaced by bot (update_id is per-bot, so a bare
        // idem:tg:{update_id} collided across tenants) and claimed atomically
        // via SET NX, only after the bot is resolved.
        const updateId = body?.update_id;
        if (updateId) {
            const idemKey = `idem:tg:${channelAccount.accountId}:${updateId}`;
            const claimed = await this.redis.acquireLock(idemKey, 86400);
            if (!claimed) return;
        }

        const normalized = await this.gateway.processIncomingWebhook('telegram', body, channelAccount.accountId);
        if (!normalized) return;

        normalized.tenantId = channelAccount.tenantId;

        // Heavy tail: photo fetch + full AI turn. Deliberately NOT awaited —
        // holding Telegram's HTTP request open for a 10-60s LLM turn would make
        // it time out and redeliver mid-processing. The mid-turn kill window
        // that remains here is the queue-backed-inbound work, not this fix.
        this.finishTelegramProcessing(channelAccount, normalized).catch((error) => {
            this.logger.error(`Error processing Telegram webhook: ${error}`);
        });
    }

    private async finishTelegramProcessing(channelAccount: any, normalized: any): Promise<void> {
        try {
            // Telegram: get profile photo via Bot API if available
            if (normalized.contactId && !(normalized.metadata as any)?.contactProfilePic) {
                try {
                    const tgSenderId = (normalized.metadata as any)?.tgSenderId;
                    const botToken = channelAccount.accessToken !== 'encrypted_ref'
                        ? channelAccount.accessToken : null;
                    if (tgSenderId && botToken) {
                        // Decrypt bot token
                        const token = await this.channelToken.getChannelToken(channelAccount.tenantId, 'telegram');
                        const photoRes = await fetch(
                            `https://api.telegram.org/bot${token.accessToken}/getUserProfilePhotos?user_id=${tgSenderId}&limit=1`,
                        );
                        const photoData = await photoRes.json() as any;
                        if (photoData.ok && photoData.result?.photos?.length > 0) {
                            // Get file path for the smallest photo
                            const fileId = photoData.result.photos[0]?.[0]?.file_id;
                            if (fileId) {
                                const fileRes = await fetch(
                                    `https://api.telegram.org/bot${token.accessToken}/getFile?file_id=${fileId}`,
                                );
                                const fileData = await fileRes.json() as any;
                                if (fileData.ok && fileData.result?.file_path) {
                                    (normalized.metadata as any).contactProfilePic =
                                        `https://api.telegram.org/file/bot${token.accessToken}/${fileData.result.file_path}`;
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    // Non-critical — photo fetch failed
                }
            }

            this.logger.log(`Incoming Telegram message for tenant ${channelAccount.tenantId} from ${normalized.contactId}`);
            await this.conversationsService.processIncomingMessage(normalized);
        } catch (error) {
            this.logger.error(`Error processing Telegram webhook: ${error}`);
        }
    }

    // ==========================================
    // Generic (fallback for future channels)
    // ==========================================

    @Post('webhook/:channelType')
    @ApiOperation({ summary: 'Generic channel webhook receiver' })
    async receiveGeneric(
        @Param('channelType') channelType: string,
        @Body() body: any,
        @Res() res: Response,
    ) {
        if (channelType === 'whatsapp') {
            return res.status(400).send('Use /channels/webhook/whatsapp');
        }

        res.status(200).send('OK');

        try {
            const normalized = await this.gateway.processIncomingWebhook(channelType as ChannelType, body, '');
            if (!normalized) return;

            if (!normalized.tenantId) {
                this.logger.warn(`Skipping ${channelType} inbound message without tenant context`);
                return;
            }

            await this.conversationsService.processIncomingMessage(normalized);
            this.logger.log(`Incoming ${channelType} message: ${normalized.contactId}`);
        } catch (error) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
        }
    }
}


