import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { GoogleAuthService } from './google-auth.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { PersonaModule } from '../persona/persona.module';
import { BusinessInfoModule } from '../business-info/business-info.module';

@Module({
    imports: [
        PersonaModule,
        BusinessInfoModule,
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
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, GoogleAuthService, MicrosoftAuthService],
    exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule { }
