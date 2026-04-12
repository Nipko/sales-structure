import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

const DEFAULT_CLIENT_ID =
    '950001098107-4ctk2jm3876afqktip7r4f04120kt0ou.apps.googleusercontent.com';

@Injectable()
export class GoogleAuthService {
    private client: OAuth2Client;
    private clientId: string;
    private readonly logger = new Logger(GoogleAuthService.name);

    constructor(private config: ConfigService) {
        this.clientId = config.get('GOOGLE_OAUTH_CLIENT_ID') || DEFAULT_CLIENT_ID;
        this.client = new OAuth2Client(this.clientId);
        this.logger.log(`Google OAuth initialized with client ID: ${this.clientId.slice(0, 20)}...`);
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
            if (!payload || !payload.email) {
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
