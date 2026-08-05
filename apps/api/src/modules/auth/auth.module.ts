import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PlatformSmsService } from './platform-sms.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleAuthService } from './google-auth.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { SamlService } from './saml.service';
import { SamlStrategy } from './saml.strategy';
import { SamlController } from './saml.controller';
import { AuthThrottleGuard } from '../../common/guards/auth-throttle.guard';
import { PersonaModule } from '../persona/persona.module';
import { BusinessInfoModule } from '../business-info/business-info.module';
import { BillingModule } from '../billing/billing.module';
import { VerticalsModule } from '../verticals/verticals.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';

@Module({
    imports: [
        PersonaModule,
        SmsCreditsModule,
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
    providers: [AuthService, PlatformSmsService, JwtStrategy, GoogleAuthService, MicrosoftAuthService, SamlService, SamlStrategy, AuthThrottleGuard],
    exports: [AuthService, JwtStrategy, PassportModule, SamlService],
})
export class AuthModule { }
