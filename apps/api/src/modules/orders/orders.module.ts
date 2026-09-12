import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RedisModule } from '../redis/redis.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // `EmailTemplatesModule`: the order confirmation the tenant's own
    // `tools.orders.emailConfirmations` switch governs is rendered from the
    // tenant's `order_confirmation` template.
    imports: [RedisModule, EmailTemplatesModule],
    controllers: [OrdersController],
    providers: [OrdersService],
    exports: [OrdersService],
})
export class OrdersModule { }
