import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
    private client: OAuth2Client;

    constructor(private config: ConfigService) {
        this.client = new OAuth2Client(config.get('GOOGLE_OAUTH_CLIENT_ID'));
    }

    async verifyIdToken(idToken: string): Promise<{
        googleId: string;
        email: string;
        firstName: string;
        lastName: string;
        picture?: string;
    }> {
        const ticket = await this.client.verifyIdToken({
            idToken,
            audience: this.config.get('GOOGLE_OAUTH_CLIENT_ID'),
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
    }
}
