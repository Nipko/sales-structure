import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleAuthService } from './google-auth.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { SamlService } from './saml.service';
import { SamlStrategy } from './saml.strategy';
import { SamlController } from './saml.controller';
import { PersonaModule } from '../persona/persona.module';
import { BusinessInfoModule } from '../business-info/business-info.module';
import { BillingModule } from '../billing/billing.module';
import { VerticalsModule } from '../verticals/verticals.module';

@Module({
    imports: [
        PersonaModule,
        BusinessInfoModule,
        BillingModule,
        VerticalsModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
                signOptions: {
                    expiresIn: config.get<string>('auth.jwtExpiration', '15m'),
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [AuthController, SamlController],
    providers: [AuthService, JwtStrategy, GoogleAuthService, MicrosoftAuthService, SamlService, SamlStrategy],
    exports: [AuthService, JwtStrategy, PassportModule, SamlService],
})
export class AuthModule { }
