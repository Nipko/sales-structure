import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { AIModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
    imports: [ConfigModule, AIModule, KnowledgeModule],
    controllers: [CopilotController],
    providers: [CopilotService],
    exports: [CopilotService],
})
export class CopilotModule {}
