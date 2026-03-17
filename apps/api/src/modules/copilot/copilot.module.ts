import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
    imports: [ConfigModule],
    controllers: [CopilotController],
    providers: [CopilotService],
    exports: [CopilotService],
})
export class CopilotModule { }
