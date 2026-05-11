import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChannelManagerService } from './channel-manager.service';
import { ChannelManagerController } from './channel-manager.controller';

@Module({
    imports: [HttpModule],
    controllers: [ChannelManagerController],
    providers: [ChannelManagerService],
    exports: [ChannelManagerService],
})
export class ChannelManagerModule {}
