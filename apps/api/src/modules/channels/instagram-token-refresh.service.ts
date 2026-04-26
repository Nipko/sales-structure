import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';

/**
 * Instagram long-lived tokens expire after 60 days.
 * This cron refreshes tokens that are within 30 days of expiration
 * to prevent silent disconnection.
 */
@Injectable()
export class InstagramTokenRefreshService {
    private readonly logger = new Logger(InstagramTokenRefreshService.name);

    constructor(
        private prisma: PrismaService,
        private cryptoService: WhatsappCryptoService,
    ) {}

    /** Daily at 6AM — refresh IG tokens expiring within 30 days */
    @Cron('0 6 * * *')
    async refreshExpiringSoonTokens() {
        const threshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

        const credentials = await this.prisma.whatsappCredential.findMany({
            where: {
                credentialType: 'instagram_token',
                rotationState: 'active',
                expiresAt: { lte: threshold, gt: new Date() },
            },
        });

        if (credentials.length === 0) return;

        this.logger.log(`Found ${credentials.length} Instagram token(s) to refresh`);

        for (const cred of credentials) {
            try {
                const currentToken = this.cryptoService.decryptToken(cred.encryptedValue);

                const res = await fetch(
                    `https://graph.instagram.com/refresh_access_token?` +
                    new URLSearchParams({
                        grant_type: 'ig_refresh_token',
                        access_token: currentToken,
                    }),
                );
                const data = await res.json();

                if (!data.access_token) {
                    await this.prisma.whatsappCredential.update({
                        where: { id: cred.id },
                        data: { rotationState: 'error', updatedAt: new Date() },
                    });
                    this.logger.warn(`IG token refresh failed for tenant ${cred.tenantId}: ${JSON.stringify(data.error || data)}`);
                    continue;
                }

                const newExpiresAt = new Date(Date.now() + (data.expires_in || 5184000) * 1000);

                await this.prisma.whatsappCredential.update({
                    where: { id: cred.id },
                    data: {
                        encryptedValue: this.cryptoService.encryptToken(data.access_token),
                        expiresAt: newExpiresAt,
                        rotationState: 'active',
                        updatedAt: new Date(),
                    },
                });

                this.logger.log(`IG token refreshed for tenant ${cred.tenantId}, new expiry: ${newExpiresAt.toISOString()}`);
            } catch (e: any) {
                this.logger.error(`IG token refresh error for tenant ${cred.tenantId}: ${e.message}`);
            }
        }
    }
}
