import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { AutomationService } from './automation.service';
import { PipelineController } from './pipeline.controller';

@Module({
    providers: [PipelineService, AutomationService],
    controllers: [PipelineController],
    exports: [PipelineService, AutomationService],
})
export class PipelineModule {}
