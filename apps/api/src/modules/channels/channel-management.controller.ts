import { Controller, Get, Post, Delete, Body, Param, Req, Logger, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ChannelTokenService } from './channel-token.service';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { SmsAdapter } from './sms/sms.adapter';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('channel-management')
@Controller('channels')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ChannelManagementController {
    private readonly logger = new Logger(ChannelManagementController.name);

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private cryptoService: WhatsappCryptoService,
        private channelToken: ChannelTokenService,
        private telegramAdapter: TelegramAdapter,
        private smsAdapter: SmsAdapter,
        private throttle: TenantThrottleService,
    ) {}

    @Get('overview')
    @ApiOperation({ summary: 'Get all connected channels with agent assignment status' })
    async getOverview(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return { success: true, data: [] };

        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, isActive: true },
            orderBy: { createdAt: 'desc' },
        });

        // Fetch agent assignments from tenant schema
        let agentAssignments: Record<string, { id: string; name: string }> = {};
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
            if (tenant?.schemaName) {
                const agents = await this.prisma.executeInTenantSchema<any[]>(
                    tenant.schemaName,
                    `SELECT id, name, channels FROM agent_personas WHERE is_active = true`,
                    [],
                );
                for (const agent of (agents || [])) {
                    for (const ch of (agent.channels || [])) {
                        agentAssignments[ch] = { id: agent.id, name: agent.name };
                    }
                }
            }
        } catch (e) { /* agent_personas table may not exist yet */ }

        return {
            success: true,
            data: accounts.map((a: any) => ({
                id: a.id,
                channelType: a.channelType,
                accountId: a.accountId,
                displayName: a.displayName,
                isActive: a.isActive,
                metadata: a.metadata,
                assignedAgent: agentAssignments[a.channelType] || null,
                needsAssignment: !agentAssignments[a.channelType],
            })),
        };
    }

    @Get(':channelType/status')
    @ApiOperation({ summary: 'Check if a channel is connected for the tenant' })
    async getStatus(@Param('channelType') channelType: string, @Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return { success: true, data: { connected: false } };

        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, channelType, isActive: true },
        });

        // Get token expiration for Instagram
        let tokenExpiresAt: Date | null = null;
        if (channelType === 'instagram' && accounts.length > 0) {
            const cred = await this.prisma.whatsappCredential.findFirst({
                where: { tenantId, credentialType: 'instagram_token', rotationState: 'active' },
            });
            tokenExpiresAt = cred?.expiresAt || null;
        }

        return {
            success: true,
            data: {
                connected: accounts.length > 0,
                account: accounts[0] ? {
                    accountId: accounts[0].accountId,
                    displayName: accounts[0].displayName,
                    metadata: accounts[0].metadata,
                    channelType: accounts[0].channelType,
                } : null,
                accounts: accounts.map((a: any) => ({
                    accountId: a.accountId,
                    displayName: a.displayName,
                    metadata: a.metadata,
                })),
                tokenExpiresAt,
            },
        };
    }

    // ==========================================
    // Telegram-specific (MUST be before :channelType params)
    // ==========================================

    @Post('telegram/connect')
    @ApiOperation({ summary: 'Connect a Telegram bot — validates token, sets webhook, stores credentials' })
    async connectTelegram(
        @Body() body: { botToken: string; displayName?: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const { botToken, displayName } = body;
        if (!botToken) throw new BadRequestException('botToken is required');

        // 1. Validate bot token
        const botInfo = await this.telegramAdapter.validateBotToken(botToken);
        if (!botInfo) {
            throw new BadRequestException('Token invalido — verifica que el token de @BotFather sea correcto');
        }

        const accountId = botInfo.username;

        // 2. Auto-set webhook URL using bot-specific path
        const apiUrl = this.configService.get<string>('API_BASE_URL')
            || this.configService.get<string>('NEXT_PUBLIC_API_URL')
            || 'https://api.parallly-chat.cloud/api/v1';
        const baseUrl = apiUrl.replace('/api/v1', '');
        const webhookUrl = `${baseUrl}/api/v1/channels/webhook/telegram/${accountId}`;

        // Generate a secret token for webhook validation
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        const webhookResult = await this.telegramAdapter.setWebhook(botToken, webhookUrl, webhookSecret);
        if (!webhookResult.ok) {
            this.logger.error(`Failed to set Telegram webhook: ${webhookResult.description}`);
            throw new BadRequestException(`Error al configurar webhook: ${webhookResult.description}`);
        }

        // 3. Encrypt and store token
        const encryptedToken = this.cryptoService.encryptToken(botToken);

        const existing = await this.prisma.channelAccount.findFirst({
            where: { channelType: 'telegram', accountId, tenantId },
        });

        if (existing) {
            await this.prisma.channelAccount.update({
                where: { id: existing.id },
                data: {
                    tenantId,
                    displayName: displayName || `@${accountId}`,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: {
                        source: 'dashboard_connect',
                        botId: botInfo.id,
                        botUsername: botInfo.username,
                        botName: botInfo.firstName,
                        webhookUrl,
                        webhookSecret,
                    },
                },
            });
        } else {
            await this.prisma.channelAccount.create({
                data: {
                    tenantId,
                    channelType: 'telegram',
                    accountId,
                    displayName: displayName || `@${accountId}`,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: {
                        source: 'dashboard_connect',
                        botId: botInfo.id,
                        botUsername: botInfo.username,
                        botName: botInfo.firstName,
                        webhookUrl,
                        webhookSecret,
                    },
                },
            });
        }

        // 4. Store encrypted credential
        const existingCred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: 'telegram_token' },
        });

        if (existingCred) {
            await this.prisma.whatsappCredential.update({
                where: { id: existingCred.id },
                data: { encryptedValue: encryptedToken, rotationState: 'active' },
            });
        } else {
            await this.prisma.whatsappCredential.create({
                data: {
                    tenantId,
                    credentialType: 'telegram_token',
                    encryptedValue: encryptedToken,
                    rotationState: 'active',
                },
            });
        }

        this.logger.log(`Telegram bot @${accountId} connected for tenant ${tenantId}`);
        return {
            success: true,
            message: `Bot @${accountId} conectado correctamente`,
            data: {
                botUsername: botInfo.username,
                botName: botInfo.firstName,
                webhookUrl,
            },
        };
    }

    @Post('telegram/test')
    @ApiOperation({ summary: 'Send a test message through the connected Telegram bot' })
    async testTelegram(
        @Body() body: { chatId: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const creds = await this.channelToken.getChannelToken(tenantId, 'telegram');
        if (!creds?.accessToken) {
            throw new BadRequestException('No hay bot de Telegram conectado');
        }

        const messageId = await this.telegramAdapter.sendTextMessage(
            body.chatId,
            'Hola desde Parallly! Tu bot de Telegram esta funcionando correctamente.',
            creds.accountId,
            creds.accessToken,
        );

        return { success: true, data: { messageId } };
    }

    @Delete('telegram/disconnect')
    @ApiOperation({ summary: 'Disconnect Telegram bot — removes webhook from Telegram and deactivates channel' })
    async disconnectTelegram(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        let providerOk = false;
        let providerError: string | null = null;

        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'telegram');
            if (!creds?.accessToken) {
                providerError = 'No active Telegram credentials';
            } else {
                const res = await fetch(
                    `https://api.telegram.org/bot${creds.accessToken}/deleteWebhook?drop_pending_updates=true`,
                    { method: 'POST' },
                );
                if (res.ok) {
                    providerOk = true;
                    this.logger.log(`Telegram webhook deleted for tenant ${tenantId}`);
                } else {
                    const body = await res.text().catch(() => '');
                    providerError = `Telegram returned ${res.status}: ${body.substring(0, 200)}`;
                    this.logger.warn(providerError);
                }
            }
        } catch (err: any) {
            providerError = err?.message || 'unknown error calling Telegram';
            this.logger.warn(`Telegram disconnect error for tenant ${tenantId}: ${providerError}`);
        }

        await this.finalizeChannelDisconnect(tenantId, 'telegram', providerOk, providerError, req.user?.sub);
        return this.buildDisconnectResponse('Bot de Telegram', providerOk, providerError);
    }

    // ==========================================
    // Messenger OAuth
    // ==========================================

    @Post('messenger/oauth-connect')
    @ApiOperation({ summary: 'Receive user access token from FB.login(), list pages, subscribe webhooks, store encrypted credentials' })
    async messengerOAuthConnect(
        @Body() body: { userAccessToken: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const userAccessToken = body.userAccessToken;
        if (!userAccessToken) throw new BadRequestException('User access token is required');

        const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');

        // Step 1: Exchange short-lived user token for long-lived user token
        // This ensures page tokens derived from it are also long-lived (non-expiring)
        let longLivedUserToken = userAccessToken;
        try {
            const appId = this.configService.get<string>('META_APP_ID') || '';
            const appSecret = this.configService.get<string>('META_APP_SECRET') || '';
            if (appId && appSecret) {
                const llRes = await fetch(
                    `https://graph.facebook.com/${graphVersion}/oauth/access_token?` +
                    new URLSearchParams({
                        grant_type: 'fb_exchange_token',
                        client_id: appId,
                        client_secret: appSecret,
                        fb_exchange_token: userAccessToken,
                    }),
                );
                const llData = await llRes.json() as any;
                if (llData.access_token) {
                    longLivedUserToken = llData.access_token;
                    this.logger.log('Messenger OAuth: exchanged for long-lived user token');
                }
            }
        } catch (e: any) {
            this.logger.warn(`Long-lived token exchange failed (using short-lived): ${e.message}`);
        }

        // Step 2a: Introspect token via /debug_token to see real scopes
        let grantedScopes: string[] = [];
        let declinedPerms: string[] = [];
        try {
            const appId = this.configService.get<string>('META_APP_ID') || '';
            const appSecret = this.configService.get<string>('META_APP_SECRET') || '';
            if (appId && appSecret) {
                const debugRes = await fetch(
                    `https://graph.facebook.com/${graphVersion}/debug_token?` +
                    new URLSearchParams({
                        input_token: longLivedUserToken,
                        access_token: `${appId}|${appSecret}`,
                    }),
                );
                const debugData = await debugRes.json() as any;
                const tokenData = debugData.data || {};
                grantedScopes = tokenData.scopes || [];
                const granularScopes = (tokenData.granular_scopes || []).map((gs: any) => `${gs.permission}(${(gs.target_ids || []).join(',') || '*'})`);
                this.logger.log(`Messenger OAuth: /debug_token for tenant ${tenantId} — app_id=${tokenData.app_id}, user_id=${tokenData.user_id}, type=${tokenData.type}, is_valid=${tokenData.is_valid}, scopes=[${grantedScopes.join(', ')}], granular=[${granularScopes.join(', ')}], expires_at=${tokenData.expires_at}`);

                if (!tokenData.is_valid) {
                    this.logger.error(`Messenger OAuth: token is NOT valid for tenant ${tenantId}`);
                    throw new BadRequestException('Facebook token is invalid. Please try connecting again.');
                }
            }
        } catch (e: any) {
            if (e instanceof BadRequestException) throw e;
            this.logger.warn(`Messenger OAuth: /debug_token failed: ${e.message}`);
        }

        // Step 2b: Check granted permissions via /me/permissions (complementary to debug_token)
        try {
            const permRes = await fetch(
                `https://graph.facebook.com/${graphVersion}/me/permissions?` +
                new URLSearchParams({ access_token: longLivedUserToken }),
            );
            const permData = await permRes.json() as any;
            const granted = (permData.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
            declinedPerms = (permData.data || []).filter((p: any) => p.status === 'declined').map((p: any) => p.permission);
            if (granted.length > 0) grantedScopes = granted; // prefer /me/permissions over debug_token
            this.logger.log(`Messenger OAuth: /me/permissions for tenant ${tenantId} — granted: [${granted.join(', ')}] declined: [${declinedPerms.join(', ')}]`);
        } catch (e: any) {
            this.logger.warn(`Messenger OAuth: failed to check permissions: ${e.message}`);
        }

        // Step 2c: List pages the user manages (with pagination, using long-lived token → page tokens won't expire)
        const allPages: any[] = [];
        let nextUrl: string | null = `https://graph.facebook.com/${graphVersion}/me/accounts?` +
            new URLSearchParams({
                fields: 'id,name,category,picture,access_token,tasks',
                limit: '100',
                access_token: longLivedUserToken,
            }).toString();

        while (nextUrl) {
            const pagesRes = await fetch(nextUrl);
            const pagesData = await pagesRes.json() as any;
            this.logger.log(`Messenger OAuth: /me/accounts page for tenant ${tenantId}: ${JSON.stringify({ data: (pagesData.data || []).map((p: any) => ({ id: p.id, name: p.name, tasks: p.tasks, has_access_token: !!p.access_token })), paging: pagesData.paging, error: pagesData.error })}`);

            if (pagesData.error) {
                this.logger.error(`Messenger OAuth: /me/accounts error for tenant ${tenantId}: ${JSON.stringify(pagesData.error)}`);
                throw new BadRequestException(`Page listing failed: ${pagesData.error.message}`);
            }

            allPages.push(...(pagesData.data || []));
            nextUrl = pagesData.paging?.next || null;
        }

        this.logger.log(`Messenger OAuth: /me/accounts returned ${allPages.length} page(s) total for tenant ${tenantId}`);

        // Accept pages that have MESSAGING/MANAGE tasks, or if tasks field is absent (deprecated in Graph API v19.0+)
        const pages = allPages.filter((p: any) => {
            const tasks = p.tasks;
            if (!tasks || !Array.isArray(tasks)) {
                return true;
            }
            const allowed = tasks.includes('MESSAGING') || tasks.includes('MANAGE');
            if (!allowed) {
                this.logger.warn(`Messenger OAuth: page ${p.id} (${p.name}) filtered out — tasks: [${tasks.join(', ')}]`);
            }
            return allowed;
        });

        if (pages.length === 0) {
            const missingPerms = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata']
                .filter(p => !grantedScopes.includes(p));
            const diagParts: string[] = [];
            if (missingPerms.length > 0) diagParts.push(`missing permissions: ${missingPerms.join(', ')}`);
            if (declinedPerms.length > 0) diagParts.push(`declined by user: ${declinedPerms.join(', ')}`);
            if (allPages.length === 0 && missingPerms.length === 0) diagParts.push('token has permissions but /me/accounts returned 0 pages — verify the Facebook user is admin of at least one Page');
            const diagMsg = diagParts.length > 0 ? ` Diagnostic: ${diagParts.join('. ')}.` : '';

            this.logger.error(`Messenger OAuth: 0 eligible pages for tenant ${tenantId}. allPages=${allPages.length}, scopes=[${grantedScopes.join(', ')}], declined=[${declinedPerms.join(', ')}]`);
            throw new BadRequestException(`No Facebook pages found.${diagMsg} Ensure the Facebook account manages at least one Page, that pages_show_list permission was granted in the login dialog, and that all required pages were selected.`);
        }

        // Step 3: For each page, subscribe webhook and store
        const connected: { id: string; name: string; picture?: string }[] = [];
        for (const page of pages) {
            try {
                if (!page.access_token) {
                    this.logger.warn(`Messenger OAuth: page ${page.id} (${page.name}) skipped — no access_token (insufficient permissions)`);
                    continue;
                }

                // Subscribe app webhooks to the page
                const subRes = await fetch(
                    `https://graph.facebook.com/${graphVersion}/${page.id}/subscribed_apps`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads,messaging_referrals',
                            access_token: page.access_token,
                        }),
                    },
                );
                const subData = await subRes.json() as any;
                if (subData.error) {
                    this.logger.warn(`Webhook subscription failed for page ${page.id}: code=${subData.error.code} subcode=${subData.error.error_subcode} type=${subData.error.type} message=${subData.error.message} fbtrace=${subData.error.fbtrace_id}`);
                }

                // Encrypt page access token
                const encrypted = this.cryptoService.encryptToken(page.access_token);
                const pictureUrl = page.picture?.data?.url || null;

                // Upsert ChannelAccount (unique on [channelType, accountId])
                const existingAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'messenger', accountId: page.id, tenantId },
                });

                if (existingAccount) {
                    await this.prisma.channelAccount.update({
                        where: { id: existingAccount.id },
                        data: {
                            tenantId,
                            displayName: page.name,
                            accessToken: 'encrypted_ref',
                            isActive: true,
                            metadata: {
                                source: 'oauth_connect',
                                category: page.category,
                                picture: pictureUrl,
                                tasks: page.tasks,
                            },
                        },
                    });
                } else {
                    await this.prisma.channelAccount.create({
                        data: {
                            tenantId,
                            channelType: 'messenger',
                            accountId: page.id,
                            displayName: page.name,
                            accessToken: 'encrypted_ref',
                            isActive: true,
                            metadata: {
                                source: 'oauth_connect',
                                category: page.category,
                                picture: pictureUrl,
                                tasks: page.tasks,
                            },
                        },
                    });
                }

                // Store encrypted credential (messenger_token per tenant)
                const existingCred = await this.prisma.whatsappCredential.findFirst({
                    where: { tenantId, credentialType: 'messenger_token' },
                });

                if (existingCred) {
                    await this.prisma.whatsappCredential.update({
                        where: { id: existingCred.id },
                        data: { encryptedValue: encrypted, rotationState: 'active' },
                    });
                } else {
                    await this.prisma.whatsappCredential.create({
                        data: {
                            tenantId,
                            credentialType: 'messenger_token',
                            encryptedValue: encrypted,
                            rotationState: 'active',
                        },
                    });
                }

                connected.push({ id: page.id, name: page.name, picture: pictureUrl });
            } catch (e: any) {
                this.logger.warn(`Failed to connect Messenger page ${page.id}: ${e.message}`);
            }
        }

        if (connected.length === 0) {
            throw new BadRequestException('Failed to connect any Facebook page');
        }

        // Invalidate cached token so next message uses the fresh one
        await this.channelToken.invalidateCache('messenger', tenantId);

        this.logger.log(`Messenger OAuth: ${connected.length} page(s) connected for tenant ${tenantId}`);
        return { success: true, data: { connected, total: pages.length } };
    }

    @Delete('messenger/disconnect')
    @ApiOperation({ summary: 'Disconnect Messenger — unsubscribes the app from each FB Page and deactivates channel' })
    async disconnectMessenger(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        let providerOk = false;
        let providerError: string | null = null;
        let sessionExpired = false;

        try {
            // Messenger may have multiple Pages — we need to call unsubscribe
            // for each one, not just the first that getChannelToken returns.
            const accounts = await this.prisma.channelAccount.findMany({
                where: { tenantId, channelType: 'messenger', isActive: true },
            });

            if (accounts.length === 0) {
                providerError = 'No active Messenger pages';
            } else {
                const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');
                let okCount = 0;
                let expiredCount = 0;
                const errors: string[] = [];

                for (const acc of accounts) {
                    try {
                        const creds = await this.channelToken.getChannelToken(tenantId, 'messenger');
                        if (!creds?.accessToken) {
                            errors.push(`page ${acc.accountId}: no token`);
                            // No-token usually means the user already cleaned
                            // up at Meta side or never had a fresh session.
                            // Treat as a session-expired equivalent.
                            expiredCount++;
                            continue;
                        }
                        const res = await fetch(
                            `https://graph.facebook.com/${graphVersion}/${acc.accountId}/subscribed_apps?access_token=${creds.accessToken}`,
                            { method: 'DELETE' },
                        );
                        if (res.ok) {
                            okCount++;
                        } else {
                            const body = await res.text().catch(() => '');
                            errors.push(`page ${acc.accountId}: ${res.status} ${body.substring(0, 100)}`);
                            if (this.isMetaSessionExpiredError(body)) {
                                expiredCount++;
                            }
                        }
                    } catch (e: any) {
                        errors.push(`page ${acc.accountId}: ${e?.message || 'unknown'}`);
                    }
                }

                providerOk = okCount === accounts.length && okCount > 0;
                // Soft-success: every non-OK page failed because the FB session
                // was already gone — the user already lost the ability to push
                // anything via that token, so the unsubscribe is moot.
                sessionExpired = !providerOk && (okCount + expiredCount) === accounts.length && expiredCount > 0;
                if (errors.length > 0) {
                    providerError = errors.join(' | ');
                    if (sessionExpired) {
                        this.logger.log(`Messenger disconnect soft-success (FB session expired) for tenant ${tenantId}`);
                    } else {
                        this.logger.warn(`Messenger disconnect partial for tenant ${tenantId}: ${providerError}`);
                    }
                } else {
                    this.logger.log(`Messenger fully unsubscribed for tenant ${tenantId} (${okCount} pages)`);
                }
            }
        } catch (err: any) {
            providerError = err?.message || 'unknown error calling Meta';
            this.logger.warn(`Messenger disconnect error for tenant ${tenantId}: ${providerError}`);
        }

        // For audit / reactivate purposes, session-expired counts as
        // "provider side is settled" — same as a successful unsubscribe,
        // because the user must redo OAuth either way.
        const finalProviderOk = providerOk || sessionExpired;
        await this.finalizeChannelDisconnect(tenantId, 'messenger', finalProviderOk, providerError, req.user?.sub);
        return this.buildDisconnectResponse('Messenger', providerOk, providerError, sessionExpired);
    }

    // ==========================================
    // Instagram OAuth
    // ==========================================

    @Post('instagram/oauth-connect')
    @ApiOperation({ summary: 'Exchange Instagram OAuth code for long-lived token, fetch profile, store encrypted credentials' })
    async instagramOAuthConnect(
        @Body() body: { code: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const code = body.code;
        if (!code) throw new BadRequestException('OAuth code is required');

        const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');

        // Step 1: Exchange code for short-lived token
        const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.configService.get<string>('INSTAGRAM_APP_ID') || '',
                client_secret: this.configService.get<string>('INSTAGRAM_APP_SECRET') || '',
                grant_type: 'authorization_code',
                redirect_uri: this.configService.get<string>(
                    'INSTAGRAM_REDIRECT_URI',
                    'https://admin.parallly-chat.cloud/admin/channels/instagram/callback',
                ) || '',
                code,
            }),
        });
        const shortData = await shortRes.json() as any;
        const shortToken: string | undefined = shortData.access_token || shortData.data?.[0]?.access_token;
        const igUserId: string = String(shortData.user_id || shortData.data?.[0]?.user_id || '');

        if (!shortToken) {
            const { access_token: _s, ...safeShort } = shortData;
            this.logger.warn(`Instagram short-lived token exchange failed (HTTP ${shortRes.status}): ${JSON.stringify(safeShort)}`);
            const igError = safeShort.error_message || safeShort.error?.message || safeShort.error || 'Unknown';
            throw new BadRequestException(`Instagram token exchange failed: ${igError}`);
        }

        // Step 2: Exchange short-lived → long-lived (60 days)
        const longRes = await fetch(
            `https://graph.instagram.com/access_token?` +
            new URLSearchParams({
                grant_type: 'ig_exchange_token',
                client_secret: this.configService.get<string>('INSTAGRAM_APP_SECRET') || '',
                access_token: shortToken,
            }),
        );
        const longData = await longRes.json() as any;
        if (!longData.access_token) {
            const { access_token: _l, ...safeLong } = longData;
            this.logger.warn(`Instagram long-lived token exchange failed: ${JSON.stringify(safeLong)}`);
            throw new BadRequestException('Instagram long-lived token exchange failed');
        }

        const longLivedToken: string = longData.access_token;
        const expiresAt = new Date(Date.now() + (longData.expires_in || 5184000) * 1000);

        // Step 3: Fetch profile info
        const profileRes = await fetch(
            `https://graph.instagram.com/${graphVersion}/me?` +
            new URLSearchParams({
                fields: 'user_id,username,name,profile_picture_url,account_type',
                access_token: longLivedToken,
            }),
        );
        const profile = await profileRes.json() as any;

        // Step 4: Encrypt and store
        const encrypted = this.cryptoService.encryptToken(longLivedToken);
        // Use the IG-scoped user ID from profile (matches webhook entry.id)
        // profile.user_id or profile.id is the IGSID, while shortData.user_id is app-scoped
        const igScopedId = String(profile.user_id || profile.id || igUserId);
        const displayName = profile.username ? `@${profile.username}` : profile.name || igScopedId;
        const pictureUrl = profile.profile_picture_url || null;

        this.logger.log(`Instagram OAuth: app-scoped=${igUserId}, ig-scoped=${igScopedId}, username=${profile.username}`);

        // Upsert ChannelAccount (unique on [channelType, accountId])
        // Use igScopedId so it matches the webhook's entry[0].id
        // Also check old app-scoped ID for migration
        const existingAccount = await this.prisma.channelAccount.findFirst({
            where: {
                channelType: 'instagram',
                tenantId,
                accountId: { in: [igScopedId, igUserId] },
            },
        });

        if (existingAccount) {
            await this.prisma.channelAccount.update({
                where: { id: existingAccount.id },
                data: {
                    tenantId,
                    accountId: igScopedId, // Fix: ensure we store the IG-scoped ID
                    displayName,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: {
                        source: 'oauth_connect',
                        username: profile.username,
                        accountType: profile.account_type,
                        profilePicture: pictureUrl,
                    },
                },
            });
        } else {
            await this.prisma.channelAccount.create({
                data: {
                    tenantId,
                    channelType: 'instagram',
                    accountId: igScopedId,
                    displayName,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: {
                        source: 'oauth_connect',
                        username: profile.username,
                        accountType: profile.account_type,
                        profilePicture: pictureUrl,
                    },
                },
            });
        }

        // Store encrypted credential with expiration
        const existingCred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: 'instagram_token' },
        });

        if (existingCred) {
            await this.prisma.whatsappCredential.update({
                where: { id: existingCred.id },
                data: {
                    encryptedValue: encrypted,
                    rotationState: 'active',
                    expiresAt,
                },
            });
        } else {
            await this.prisma.whatsappCredential.create({
                data: {
                    tenantId,
                    credentialType: 'instagram_token',
                    encryptedValue: encrypted,
                    rotationState: 'active',
                    expiresAt,
                },
            });
        }

        // Step 5: Subscribe account to webhooks so Meta delivers DM events
        try {
            const subRes = await fetch(
                `https://graph.instagram.com/${graphVersion}/${igScopedId}/subscribed_apps`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        subscribed_fields: 'messages,messaging_postbacks',
                        access_token: longLivedToken,
                    }),
                },
            );
            const subData = await subRes.json() as any;
            if (subData.success) {
                this.logger.log(`Instagram webhook subscription activated for ${igScopedId}`);
            } else {
                this.logger.warn(`Instagram webhook subscription failed for ${igScopedId}: ${JSON.stringify(subData)}`);
            }
        } catch (subErr: any) {
            this.logger.warn(`Instagram webhook subscription error for ${igScopedId}: ${subErr.message}`);
        }

        // Invalidate cached token so next message uses the fresh one
        await this.channelToken.invalidateCache('instagram', tenantId);

        this.logger.log(`Instagram OAuth: ${displayName} connected for tenant ${tenantId}`);
        return {
            success: true,
            data: {
                id: igUserId,
                username: profile.username,
                name: profile.name,
                picture: pictureUrl,
            },
        };
    }

    @Delete('instagram/disconnect')
    @ApiOperation({ summary: 'Disconnect Instagram — revokes app permissions on the IG account and deactivates channel' })
    async disconnectInstagram(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        let providerOk = false;
        let providerError: string | null = null;
        let sessionExpired = false;

        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'instagram');
            if (!creds?.accessToken) {
                providerError = 'No active Instagram credentials';
                // No token to call DELETE with — same practical outcome as
                // an expired session: the local row gets cleaned up and
                // nothing can flow either way.
                sessionExpired = true;
            } else {
                const res = await fetch(
                    `https://graph.instagram.com/me/permissions?access_token=${creds.accessToken}`,
                    { method: 'DELETE' },
                );
                if (res.ok) {
                    providerOk = true;
                    this.logger.log(`Instagram permissions revoked for tenant ${tenantId}`);
                } else {
                    const body = await res.text().catch(() => '');
                    providerError = `Instagram returned ${res.status}: ${body.substring(0, 200)}`;
                    if (this.isMetaSessionExpiredError(body)) {
                        sessionExpired = true;
                        this.logger.log(`Instagram disconnect soft-success (token expired) for tenant ${tenantId}`);
                    } else {
                        this.logger.warn(providerError);
                    }
                }
            }
        } catch (err: any) {
            providerError = err?.message || 'unknown error calling Instagram';
            this.logger.warn(`Instagram disconnect error for tenant ${tenantId}: ${providerError}`);
        }

        const finalProviderOk = providerOk || sessionExpired;
        await this.finalizeChannelDisconnect(tenantId, 'instagram', finalProviderOk, providerError, req.user?.sub);
        return this.buildDisconnectResponse('Instagram', providerOk, providerError, sessionExpired);
    }

    // ==========================================
    // SMS / Twilio
    // ==========================================

    @Post('sms/connect')
    @ApiOperation({ summary: 'Connect Twilio SMS — validates credentials, stores encrypted' })
    async connectSms(
        @Body() body: { accountSid: string; authToken: string; phoneNumber: string; displayName?: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const features = await this.throttle.getPlanFeatures(tenantId);
        const channels: string[] = features.channels || [];
        if (!channels.includes('sms')) {
            throw new ForbiddenException('El canal SMS no está disponible en tu plan actual. Mejora a Enterprise para acceder.');
        }

        const { accountSid, authToken, phoneNumber, displayName } = body;
        if (!accountSid || !authToken || !phoneNumber) {
            throw new BadRequestException('accountSid, authToken, and phoneNumber are required');
        }

        // 1. Validate credentials
        const account = await this.smsAdapter.validateCredentials(accountSid, authToken);
        if (!account) {
            throw new BadRequestException('Invalid Twilio credentials');
        }

        // 2. Configure webhook URL for inbound SMS
        const apiUrl = this.configService.get<string>('API_BASE_URL')
            || this.configService.get<string>('NEXT_PUBLIC_API_URL')
            || 'https://api.parallly-chat.cloud/api/v1';
        const baseUrl = apiUrl.replace('/api/v1', '');
        const webhookUrl = `${baseUrl}/api/v1/channels/webhook/sms/${encodeURIComponent(phoneNumber)}`;

        // 3. Encrypt credentials (store as "accountSid:authToken")
        const combined = `${accountSid}:${authToken}`;
        const encryptedToken = this.cryptoService.encryptToken(combined);

        // 4. Upsert channel_account
        const existing = await this.prisma.channelAccount.findFirst({
            where: { channelType: 'sms', accountId: phoneNumber, tenantId },
        });

        const channelData = {
            tenantId,
            channelType: 'sms',
            accountId: phoneNumber,
            displayName: displayName || `SMS ${phoneNumber}`,
            accessToken: 'encrypted_ref',
            isActive: true,
            metadata: {
                source: 'dashboard_connect',
                accountSid,
                friendlyName: account.friendlyName,
                webhookUrl,
            },
        };

        if (existing) {
            await this.prisma.channelAccount.update({ where: { id: existing.id }, data: channelData });
        } else {
            await this.prisma.channelAccount.create({ data: channelData });
        }

        // 5. Store encrypted credential
        const existingCred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: 'sms_token' },
        });

        if (existingCred) {
            await this.prisma.whatsappCredential.update({
                where: { id: existingCred.id },
                data: { encryptedValue: encryptedToken, rotationState: 'active' },
            });
        } else {
            await this.prisma.whatsappCredential.create({
                data: {
                    tenantId,
                    credentialType: 'sms_token',
                    encryptedValue: encryptedToken,
                    rotationState: 'active',
                },
            });
        }

        this.logger.log(`SMS connected for tenant ${tenantId}: ${phoneNumber}`);

        return {
            success: true,
            data: {
                phoneNumber,
                friendlyName: account.friendlyName,
                webhookUrl,
                message: 'SMS connected. Configure this webhook URL in your Twilio console for incoming messages.',
            },
        };
    }

    @Get('sms/status')
    @ApiOperation({ summary: 'Get SMS channel status' })
    async getSmsStatus(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        const account = await this.prisma.channelAccount.findFirst({
            where: { tenantId, channelType: 'sms', isActive: true },
        });
        return {
            success: true,
            data: {
                connected: !!account,
                phoneNumber: account?.accountId || null,
                displayName: account?.displayName || null,
                metadata: account?.metadata || null,
            },
        };
    }

    @Delete('sms/disconnect')
    @ApiOperation({ summary: 'Disconnect Twilio SMS — clears the webhook URL on the Twilio phone number and deactivates channel' })
    async disconnectSms(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        let providerOk = false;
        let providerError: string | null = null;

        try {
            // Twilio doesn't have an "unsubscribe app" concept — credentials are
            // pull-style, the user pasted them in. The closest equivalent is
            // clearing the webhook URLs on the IncomingPhoneNumber so Twilio
            // stops POSTing to our endpoint when the carrier delivers an SMS.
            const accounts = await this.prisma.channelAccount.findMany({
                where: { tenantId, channelType: 'sms', isActive: true },
            });

            if (accounts.length === 0) {
                providerError = 'No active SMS phone numbers';
            } else {
                let okCount = 0;
                const errors: string[] = [];
                for (const acc of accounts) {
                    try {
                        const meta = (acc.metadata as any) || {};
                        const accountSid = meta.accountSid as string | undefined;
                        const phoneNumberSid = meta.phoneNumberSid as string | undefined;
                        const creds = await this.channelToken.getChannelToken(tenantId, 'sms');
                        const authToken = creds?.accessToken;
                        if (!accountSid || !phoneNumberSid || !authToken) {
                            errors.push(`${acc.accountId}: incomplete twilio credentials`);
                            continue;
                        }
                        // Twilio API: POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers/{PnSid}.json
                        // Setting the URL to empty string clears the webhook.
                        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
                        const formBody = new URLSearchParams({ SmsUrl: '', SmsFallbackUrl: '' });
                        const res = await fetch(
                            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneNumberSid}.json`,
                            {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Basic ${auth}`,
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                },
                                body: formBody.toString(),
                            },
                        );
                        if (res.ok) {
                            okCount++;
                        } else {
                            const body = await res.text().catch(() => '');
                            errors.push(`${acc.accountId}: ${res.status} ${body.substring(0, 100)}`);
                        }
                    } catch (e: any) {
                        errors.push(`${acc.accountId}: ${e?.message || 'unknown'}`);
                    }
                }
                providerOk = okCount === accounts.length && okCount > 0;
                if (errors.length > 0) {
                    providerError = errors.join(' | ');
                    this.logger.warn(`Twilio webhook clear partial for tenant ${tenantId}: ${providerError}`);
                } else {
                    this.logger.log(`Twilio webhooks cleared for tenant ${tenantId} (${okCount} numbers)`);
                }
            }
        } catch (err: any) {
            providerError = err?.message || 'unknown error calling Twilio';
            this.logger.warn(`SMS disconnect error for tenant ${tenantId}: ${providerError}`);
        }

        await this.finalizeChannelDisconnect(tenantId, 'sms', providerOk, providerError, req.user?.sub);
        return this.buildDisconnectResponse('SMS / Twilio', providerOk, providerError);
    }

    @Post('sms/test')
    @ApiOperation({ summary: 'Send a test SMS' })
    async testSms(
        @Body() body: { to: string },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const creds = await this.channelToken.getChannelToken(tenantId, 'sms');
        await this.smsAdapter.sendTextMessage(
            body.to,
            'Test message from Parallly - SMS channel connected successfully!',
            creds.accountId,
            creds.accessToken,
        );

        return { success: true, message: `Test SMS sent to ${body.to}` };
    }

    // ==========================================
    // Generic channel (parameterized — MUST be after specific routes)
    // ==========================================

    @Post(':channelType/connect')
    @ApiOperation({ summary: 'Connect a channel (Instagram, Messenger, etc.)' })
    async connect(
        @Param('channelType') channelType: string,
        @Body() body: { accountId: string; displayName?: string; accessToken: string; metadata?: any },
        @Req() req: any,
    ) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        const { accountId, displayName, accessToken, metadata } = body;
        if (!accountId || !accessToken) throw new BadRequestException('accountId and accessToken are required');

        // Encrypt the access token
        const encryptedToken = this.cryptoService.encryptToken(accessToken);

        // Upsert channel_account
        const existing = await this.prisma.channelAccount.findFirst({
            where: { channelType, accountId, tenantId },
        });

        if (existing) {
            await this.prisma.channelAccount.update({
                where: { id: existing.id },
                data: {
                    tenantId,
                    displayName: displayName || accountId,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: { ...(existing.metadata as any), ...metadata, source: 'manual_connect' },
                },
            });
        } else {
            await this.prisma.channelAccount.create({
                data: {
                    tenantId,
                    channelType,
                    accountId,
                    displayName: displayName || accountId,
                    accessToken: 'encrypted_ref',
                    isActive: true,
                    metadata: { ...metadata, source: 'manual_connect' },
                },
            });
        }

        // Store encrypted credential (reuse whatsapp_credentials table for all channels)
        const existingCred = await this.prisma.whatsappCredential.findFirst({
            where: { tenantId, credentialType: `${channelType}_token` },
        });

        if (existingCred) {
            await this.prisma.whatsappCredential.update({
                where: { id: existingCred.id },
                data: { encryptedValue: encryptedToken, rotationState: 'active' },
            });
        } else {
            await this.prisma.whatsappCredential.create({
                data: {
                    tenantId,
                    credentialType: `${channelType}_token`,
                    encryptedValue: encryptedToken,
                    rotationState: 'active',
                },
            });
        }

        this.logger.log(`Channel ${channelType} connected for tenant ${tenantId} (accountId=${accountId})`);
        return { success: true, message: `${channelType} connected successfully` };
    }

    @Get(':channelType/config')
    @ApiOperation({ summary: 'Get webhook configuration for a channel' })
    async getConfig(@Param('channelType') channelType: string) {
        const apiUrl = this.configService.get<string>('API_BASE_URL')
            || this.configService.get<string>('NEXT_PUBLIC_API_URL')
            || 'https://api.parallly-chat.cloud/api/v1';
        const baseUrl = apiUrl.replace('/api/v1', '');
        const verifyToken = this.configService.get<string>('META_VERIFY_TOKEN') || this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') || '';

        return {
            success: true,
            data: {
                webhookUrl: `${baseUrl}/api/v1/channels/webhook/${channelType}`,
                verifyToken,
                instructions: this.getChannelInstructions(channelType),
            },
        };
    }

    private getChannelInstructions(channelType: string): string {
        switch (channelType) {
            case 'instagram':
                return 'En tu Facebook App, ve a Instagram → Settings → Webhooks y configura la URL y Verify Token. Habilita los campos: messages, messaging_postbacks.';
            case 'messenger':
                return 'En tu Facebook App, ve a Messenger → Settings → Webhooks y configura la URL y Verify Token. Habilita los campos: messages, messaging_postbacks, messaging_optins.';
            case 'telegram':
                return '1. Abre @BotFather en Telegram y usa /newbot para crear un bot. 2. Copia el token del bot. 3. Pegalo en el campo Bot Token y haz clic en Conectar. El webhook se configura automaticamente.';
            default:
                return 'Configura el webhook en la plataforma del canal con la URL y Verify Token indicados.';
        }
    }

    /**
     * Shared finalization for every channel disconnect endpoint:
     * - Per-account update so we can stamp metadata.disconnected_at_provider
     *   (used by reactivate to know if a flag flip is enough or OAuth has to
     *   be redone)
     * - audit_logs row with the actor + provider outcome
     * - cache invalidation so the webhook resolver stops seeing the channel
     *   on the next message
     */
    private async finalizeChannelDisconnect(
        tenantId: string,
        channelType: string,
        providerOk: boolean,
        providerError: string | null,
        userId?: string,
    ): Promise<{ rowsTouched: number }> {
        const rows = (await this.prisma.$queryRawUnsafe(
            `UPDATE channel_accounts
               SET is_active = false,
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                       'disconnected_at', NOW()::text,
                       'disconnected_at_provider', $3::boolean,
                       'disconnect_error', $4::text
                   ),
                   updated_at = NOW()
             WHERE tenant_id = $1::uuid AND channel_type = $2 AND is_active = true
             RETURNING id`,
            tenantId, channelType, providerOk, providerError,
        )) as any[];

        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'channel_disconnected',
                    resource: channelType,
                    details: {
                        providerOk,
                        providerError,
                        triggeredBy: userId || 'unknown',
                        rowsTouched: rows.length,
                    },
                },
            });
        } catch { /* non-blocking */ }

        // Invalidate the channel-token cache so subsequent webhooks miss
        // promptly (these caches live in Redis with 5 min TTL).
        try {
            await this.channelToken.invalidateCache(channelType, tenantId);
        } catch { /* non-blocking */ }

        return { rowsTouched: rows.length };
    }

    private buildDisconnectResponse(
        channelLabel: string,
        providerOk: boolean,
        providerError: string | null,
        sessionExpired: boolean = false,
    ) {
        if (providerOk) {
            return { success: true, message: `${channelLabel} desconectado completamente`, providerOk: true };
        }
        // Session-expired: the OAuth token Meta wanted us to use was already
        // dead, so we couldn't deliver an explicit unsubscribe — but that
        // same dead token can't push messages to us either. From the user's
        // POV the disconnect is final and clean; just tell them that if
        // they want to scrub the residual app-page binding from Meta itself,
        // they have to do it manually in Facebook settings.
        if (sessionExpired) {
            return {
                success: true,
                message: `${channelLabel} desconectado. Tu sesión de Facebook ya había caducado, así que no fue necesario notificar a Meta. Si deseas remover por completo la integración del lado de Facebook, ve a tu Página → Configuración → Integraciones de negocio.`,
                providerOk: true,
                providerExpired: true,
            };
        }
        return {
            success: true,
            message: `${channelLabel} marcado como desconectado en la plataforma. ATENCIÓN: el proveedor podría seguir intentando enviar webhooks (${providerError ?? 'sin detalle del error'}) — revisar la integración manualmente.`,
            providerOk: false,
            providerError,
        };
    }

    /**
     * Detect Meta's `OAuthException code 190` (session expired or token
     * invalid). When the user's FB Login session has already expired by
     * the time they hit Disconnect, the unsubscribe call is meaningless —
     * we route those failures to the soft-success branch.
     */
    private isMetaSessionExpiredError(body: string): boolean {
        if (!body) return false;
        const lower = body.toLowerCase();
        return (
            lower.includes('session has expired') ||
            lower.includes('"code":190') ||
            lower.includes('error validating access token') ||
            lower.includes('user has not authorized application')
        );
    }
}
