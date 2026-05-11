import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { PushListenerService } from './push-listener.service';

@Module({
    providers: [PushService, PushListenerService],
    controllers: [PushController],
    exports: [PushService],
})
export class PushModule {}
