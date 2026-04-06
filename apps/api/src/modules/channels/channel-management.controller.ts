import { Controller, Get, Post, Body, Param, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
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
            data: accounts.map(a => ({
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
            default:
                return 'Configura el webhook en la plataforma del canal con la URL y Verify Token indicados.';
        }
    }
}
