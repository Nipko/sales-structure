import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { MultiSamlStrategy, Profile, VerifiedCallback } from '@node-saml/passport-saml';
import { Request } from 'express';
import { SamlService } from './saml.service';

@Injectable()
export class SamlStrategy extends PassportStrategy(MultiSamlStrategy, 'saml') {
    private readonly logger = new Logger(SamlStrategy.name);

    constructor(private readonly samlService: SamlService) {
        super({
            passReqToCallback: true,
            getSamlOptions: async (req: Request, done: (err: Error | null, options?: any) => void) => {
                try {
                    const tenantId = req.query?.tenantId as string
                        || req.body?.RelayState as string;

                    if (!tenantId) {
                        return done(new Error('Missing tenantId'));
                    }

                    const config = await this.samlService.getSamlConfig(tenantId);
                    if (!config?.enabled) {
                        return done(new Error('SAML not configured for this tenant'));
                    }

                    const options = {
                        callbackUrl: `https://api.parallly-chat.cloud/api/v1/auth/saml/acs`,
                        entryPoint: config.idpSsoUrl,
                        issuer: config.spEntityId,
                        cert: config.idpCertificate,
                        identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
                        wantAssertionsSigned: true,
                        additionalParams: { RelayState: tenantId },
                    };

                    done(null, options);
                } catch (err: any) {
                    this.logger.error(`getSamlOptions error: ${err.message}`);
                    done(err);
                }
            },
        });
    }

    async validate(req: Request, profile: Profile, done: VerifiedCallback): Promise<void> {
        try {
            const tenantId = req.body?.RelayState as string;
            if (!tenantId) {
                return done(new Error('Missing RelayState (tenantId)'));
            }

            const email = profile.nameID
                || profile.email
                || (profile as any)['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']
                || (profile as any)['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'];

            if (!email) {
                return done(new Error('No email found in SAML assertion'));
            }

            const firstName = (profile as any).firstName
                || (profile as any)['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname']
                || (profile as any).givenName
                || '';

            const lastName = (profile as any).lastName
                || (profile as any)['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']
                || (profile as any).sn
                || '';

            const user = {
                tenantId,
                email: email.toLowerCase(),
                firstName,
                lastName,
                nameId: profile.nameID,
            };

            done(null, user);
        } catch (err: any) {
            this.logger.error(`SAML validate error: ${err.message}`);
            done(err);
        }
    }
}
