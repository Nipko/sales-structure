import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { ActionExecutorService } from './action-executor.service';
import { AutomationController } from './automation.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [PrismaModule, WhatsappModule],
    controllers: [AutomationController],
    providers: [AutomationService, ActionExecutorService],
    exports: [AutomationService]
})
export class AutomationModule {}
