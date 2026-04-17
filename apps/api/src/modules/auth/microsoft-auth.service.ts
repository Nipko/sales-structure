import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfidentialClientApplication } from '@azure/msal-node';

@Injectable()
export class MicrosoftAuthService {
    private msalClient: ConfidentialClientApplication | null = null;
    private readonly clientId: string;
    private readonly redirectUri: string;
    private readonly logger = new Logger(MicrosoftAuthService.name);

    constructor(private config: ConfigService) {
        this.clientId = config.get('MS_AUTH_CLIENT_ID') || config.get('MS_CLIENT_ID', '');
        const clientSecret = config.get('MS_AUTH_CLIENT_SECRET') || config.get('MS_CLIENT_SECRET', '');
        this.redirectUri = config.get(
            'MS_AUTH_REDIRECT_URI',
            'https://api.parallly-chat.cloud/api/v1/auth/microsoft/callback',
        );

        if (this.clientId && clientSecret) {
            this.msalClient = new ConfidentialClientApplication({
                auth: {
                    clientId: this.clientId,
                    clientSecret,
                    authority: 'https://login.microsoftonline.com/common',
                },
            });
            this.logger.log('Microsoft OAuth initialized');
        } else {
            this.logger.warn('Microsoft OAuth not configured (MS_AUTH_CLIENT_ID missing)');
        }
    }

    isConfigured(): boolean {
        return !!this.msalClient;
    }

    getAuthUrl(state = ''): string {
        if (!this.msalClient) throw new BadRequestException('Microsoft login not configured');

        const params = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: this.redirectUri,
            scope: 'openid profile email User.Read offline_access',
            state,
            prompt: 'select_account',
            response_mode: 'query',
        });

        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
    }

    async exchangeCode(code: string): Promise<{
        microsoftId: string;
        email: string;
        firstName: string;
        lastName: string;
        displayName: string;
    }> {
        if (!this.msalClient) throw new BadRequestException('Microsoft login not configured');

        const result = await this.msalClient.acquireTokenByCode({
            code,
            redirectUri: this.redirectUri,
            scopes: ['User.Read'],
        });

        if (!result || !result.account) {
            throw new BadRequestException('Failed to authenticate with Microsoft');
        }

        const account = result.account;
        const claims = result.idTokenClaims as any;

        return {
            microsoftId: claims.oid || account.localAccountId,
            email: account.username || claims.email || claims.preferred_username || '',
            firstName: claims.given_name || '',
            lastName: claims.family_name || '',
            displayName: account.name || claims.name || '',
        };
    }
}
