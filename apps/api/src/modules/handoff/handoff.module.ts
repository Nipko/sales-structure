import { Module } from '@nestjs/common';
import { HandoffService } from './handoff.service';
import { HandoffController } from './handoff.controller';

@Module({
    providers: [HandoffService],
    controllers: [HandoffController],
    exports: [HandoffService],
})
export class HandoffModule {}
