import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { PushListenerService } from './push-listener.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
    imports: [BullModule.registerQueue({ name: 'outbound-messages' })],
    providers: [PushService, PushListenerService],
    controllers: [PushController],
    exports: [PushService],
})
export class PushModule {}
