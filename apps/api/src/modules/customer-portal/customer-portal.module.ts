import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalController } from './customer-portal.controller';
import { EmailModule } from '../email/email.module';
import { SmsNotificationsModule } from '../sms-notifications/sms-notifications.module';

@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('auth.jwtSecret'),
                signOptions: { expiresIn: '1h' },
            }),
            inject: [ConfigService],
        }),
        EmailModule,
        SmsNotificationsModule,
    ],
    controllers: [CustomerPortalController],
    providers: [CustomerPortalService],
    exports: [CustomerPortalService],
})
export class CustomerPortalModule {}
