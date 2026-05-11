import { Module } from '@nestjs/common';
import { HandoffService } from './handoff.service';
import { HandoffController } from './handoff.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [EmailTemplatesModule, AIModule],
    providers: [HandoffService],
    controllers: [HandoffController],
    exports: [HandoffService],
})
export class HandoffModule {}
