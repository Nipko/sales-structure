import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
    private client: OAuth2Client;
    private clientId: string;
    private readonly logger = new Logger(GoogleAuthService.name);

    constructor(private config: ConfigService) {
        this.clientId = config.get('GOOGLE_OAUTH_CLIENT_ID') || '';
        if (!this.clientId) {
            this.logger.warn('GOOGLE_OAUTH_CLIENT_ID not set — Google OAuth login will fail');
        }
        this.client = new OAuth2Client(this.clientId);
    }

    async verifyIdToken(idToken: string): Promise<{
        googleId: string;
        email: string;
        firstName: string;
        lastName: string;
        picture?: string;
    }> {
        try {
            const ticket = await this.client.verifyIdToken({
                idToken,
                audience: this.clientId,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.email || payload.email_verified !== true) {
                throw new UnauthorizedException('Invalid Google token');
            }
            return {
                googleId: payload.sub,
                email: payload.email,
                firstName: payload.given_name || '',
                lastName: payload.family_name || '',
                picture: payload.picture,
            };
        } catch (error) {
            this.logger.error(`Google token verification failed: ${error.message}`);
            throw new UnauthorizedException('Google token verification failed');
        }
    }
}
