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
        picture?: string;
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

        // Microsoft Graph doesn't return a public photo URL. We fetch the photo
        // binary with the user's access token and convert it to a data URL so
        // the frontend <img> can render it. Best-effort — photo is optional.
        const picture = await this.fetchPhotoAsDataUrl(result.accessToken).catch(() => undefined);

        return {
            microsoftId: claims.oid || account.localAccountId,
            email: account.username || claims.email || claims.preferred_username || '',
            firstName: claims.given_name || '',
            lastName: claims.family_name || '',
            displayName: account.name || claims.name || '',
            picture,
        };
    }

    /**
     * Pull the signed-in user's photo from Microsoft Graph and encode it as
     * a data URL. Graph only returns a binary — there's no public URL we can
     * persist. We cap the size to avoid stuffing huge base64 blobs into the DB.
     * Returns undefined if the user has no photo or Graph call fails.
     */
    private async fetchPhotoAsDataUrl(accessToken?: string): Promise<string | undefined> {
        if (!accessToken) return undefined;
        try {
            const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) return undefined;
            const contentType = res.headers.get('content-type') || 'image/jpeg';
            const buf = Buffer.from(await res.arrayBuffer());
            const MAX_BYTES = 256 * 1024; // 256KB cap
            if (buf.length > MAX_BYTES) {
                this.logger.warn(`MS photo too large (${buf.length} bytes), skipping`);
                return undefined;
            }
            return `data:${contentType};base64,${buf.toString('base64')}`;
        } catch (e: any) {
            this.logger.warn(`Failed to fetch MS photo: ${e.message}`);
            return undefined;
        }
    }
}
