import { Module } from '@nestjs/common';
import { RepairOrdersController } from './repair-orders.controller';
import { RepairOrdersService } from './repair-orders.service';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    // The intake receipt `tools.repairOrders.emailConfirmations` governs.
    imports: [EmailTemplatesModule],
    controllers: [RepairOrdersController],
    providers: [RepairOrdersService],
    exports: [RepairOrdersService],
})
export class RepairOrdersModule {}
