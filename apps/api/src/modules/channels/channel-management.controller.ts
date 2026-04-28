import { Controller, Get, Post, Delete, Body, Param, Req, Logger, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ChannelTokenService } from './channel-token.service';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { SmsAdapter } from './sms/sms.adapter';
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

        const webhookResult = await this.telegramAdapter.setWebhook(botToken, webhookUrl);
        if (!webhookResult.ok) {
            this.logger.error(`Failed to set Telegram webhook: ${webhookResult.description}`);
            throw new BadRequestException(`Error al configurar webhook: ${webhookResult.description}`);
        }

        // 3. Encrypt and store token
        const encryptedToken = this.cryptoService.encryptToken(botToken);

        const existing = await this.prisma.channelAccount.findFirst({
            where: { channelType: 'telegram', accountId },
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
    @ApiOperation({ summary: 'Disconnect Telegram bot — removes webhook and deactivates channel' })
    async disconnectTelegram(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        // Get current token to call deleteWebhook
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'telegram');
            if (creds?.accessToken) {
                // Remove webhook from Telegram
                await fetch(`https://api.telegram.org/bot${creds.accessToken}/deleteWebhook`, {
                    method: 'POST',
                }).catch(() => { /* best effort */ });
            }
        } catch {
            // No credentials found — continue with deactivation
        }

        // Deactivate channel account
        const account = await this.prisma.channelAccount.findFirst({
            where: { tenantId, channelType: 'telegram', isActive: true },
        });

        if (account) {
            await this.prisma.channelAccount.update({
                where: { id: account.id },
                data: { isActive: false },
            });
        }

        this.logger.log(`Telegram disconnected for tenant ${tenantId}`);
        return { success: true, message: 'Bot de Telegram desconectado' };
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

        // No code exchange needed — FB.login() with response_type:'token' provides
        // the user access token directly. We use it to list pages and get page tokens.

        // Step 2: List pages the user manages
        const pagesRes = await fetch(
            `https://graph.facebook.com/${graphVersion}/me/accounts?` +
            new URLSearchParams({
                fields: 'id,name,category,picture,access_token,tasks',
                access_token: userAccessToken,
            }),
        );
        const pagesData = await pagesRes.json() as any;
        if (pagesData.error) {
            throw new BadRequestException(`Page listing failed: ${pagesData.error.message}`);
        }

        const pages = (pagesData.data || []).filter(
            (p: any) => p.tasks?.includes('MESSAGING') || p.tasks?.includes('MANAGE'),
        );
        if (pages.length === 0) {
            throw new BadRequestException('No Facebook pages with messaging permission found');
        }

        // Step 3: For each page, subscribe webhook and store
        const connected: { id: string; name: string; picture?: string }[] = [];
        for (const page of pages) {
            try {
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
                const subData = await subRes.json();
                if (subData.error) {
                    this.logger.warn(`Webhook subscription failed for page ${page.id}: ${subData.error.message}`);
                }

                // Encrypt page access token
                const encrypted = this.cryptoService.encryptToken(page.access_token);
                const pictureUrl = page.picture?.data?.url || null;

                // Upsert ChannelAccount (unique on [channelType, accountId])
                const existingAccount = await this.prisma.channelAccount.findFirst({
                    where: { channelType: 'messenger', accountId: page.id },
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
    @ApiOperation({ summary: 'Disconnect Messenger — unsubscribe webhooks and deactivate channel' })
    async disconnectMessenger(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        // Try to unsubscribe webhook (best effort)
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'messenger');
            if (creds?.accessToken) {
                const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');
                await fetch(
                    `https://graph.facebook.com/${graphVersion}/${creds.accountId}/subscribed_apps?access_token=${creds.accessToken}`,
                    { method: 'DELETE' },
                ).catch(() => { /* best effort */ });
            }
        } catch {
            // No credentials — continue with deactivation
        }

        await this.prisma.channelAccount.updateMany({
            where: { tenantId, channelType: 'messenger' },
            data: { isActive: false },
        });

        this.logger.log(`Messenger disconnected for tenant ${tenantId}`);
        return { success: true, message: 'Messenger disconnected' };
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
            this.logger.warn(`Instagram short-lived token exchange failed: ${JSON.stringify(shortData)}`);
            throw new BadRequestException('Instagram token exchange failed');
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
            this.logger.warn(`Instagram long-lived token exchange failed: ${JSON.stringify(longData)}`);
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
    @ApiOperation({ summary: 'Disconnect Instagram — revoke permissions and deactivate channel' })
    async disconnectInstagram(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        // Try to revoke permissions (best effort)
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'instagram');
            if (creds?.accessToken) {
                await fetch(
                    `https://graph.instagram.com/me/permissions?access_token=${creds.accessToken}`,
                    { method: 'DELETE' },
                ).catch(() => { /* best effort */ });
            }
        } catch {
            // No credentials — continue with deactivation
        }

        await this.prisma.channelAccount.updateMany({
            where: { tenantId, channelType: 'instagram' },
            data: { isActive: false },
        });

        this.logger.log(`Instagram disconnected for tenant ${tenantId}`);
        return { success: true, message: 'Instagram disconnected' };
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
            where: { channelType: 'sms', accountId: phoneNumber },
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
    @ApiOperation({ summary: 'Disconnect Twilio SMS' })
    async disconnectSms(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) throw new BadRequestException('Tenant ID required');

        await this.prisma.channelAccount.updateMany({
            where: { tenantId, channelType: 'sms' },
            data: { isActive: false },
        });

        this.logger.log(`SMS disconnected for tenant ${tenantId}`);
        return { success: true, message: 'SMS disconnected' };
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
        if (!tenantId) throw new Error('Tenant ID required');

        const { accountId, displayName, accessToken, metadata } = body;
        if (!accountId || !accessToken) throw new Error('accountId and accessToken are required');

        // Encrypt the access token
        const encryptedToken = this.cryptoService.encryptToken(accessToken);

        // Upsert channel_account
        const existing = await this.prisma.channelAccount.findFirst({
            where: { channelType, accountId },
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
}
