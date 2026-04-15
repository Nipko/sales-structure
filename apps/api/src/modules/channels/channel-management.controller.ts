import { Controller, Get, Post, Delete, Body, Param, Req, Logger, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { ChannelTokenService } from './channel-token.service';
import { TelegramAdapter } from './telegram/telegram.adapter';
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
    ) {}

    @Get('overview')
    @ApiOperation({ summary: 'Get all connected channels for the authenticated tenant' })
    async getOverview(@Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return { success: true, data: [] };

        const accounts = await this.prisma.channelAccount.findMany({
            where: { tenantId, isActive: true },
            orderBy: { createdAt: 'desc' },
        });

        return {
            success: true,
            data: accounts.map((a: any) => ({
                id: a.id,
                channelType: a.channelType,
                accountId: a.accountId,
                displayName: a.displayName,
                isActive: a.isActive,
                metadata: a.metadata,
            })),
        };
    }

    @Get(':channelType/status')
    @ApiOperation({ summary: 'Check if a channel is connected for the tenant' })
    async getStatus(@Param('channelType') channelType: string, @Req() req: any) {
        const tenantId = req.user?.tenantId;
        if (!tenantId) return { success: true, data: { connected: false } };

        const account = await this.prisma.channelAccount.findFirst({
            where: { tenantId, channelType, isActive: true },
        });

        return {
            success: true,
            data: {
                connected: !!account,
                account: account ? {
                    accountId: account.accountId,
                    displayName: account.displayName,
                    metadata: account.metadata,
                } : null,
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
        const apiUrl = this.configService.get<string>('NEXT_PUBLIC_API_URL') || 'https://api.parallly-chat.cloud/api/v1';
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
        const apiUrl = this.configService.get<string>('NEXT_PUBLIC_API_URL') || 'https://api.parallly-chat.cloud/api/v1';
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
