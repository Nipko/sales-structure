import { Module } from '@nestjs/common';
import { RecallService } from './recall.service';
import { RecallController } from './recall.controller';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [ChannelsModule],
    controllers: [RecallController],
    providers: [RecallService],
    exports: [RecallService],
})
export class RecallModule {}
