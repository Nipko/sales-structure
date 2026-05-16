import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { LlmKeyService } from './llm-key.service';

@Module({
    providers: [SettingsService, LlmKeyService],
    controllers: [SettingsController],
    exports: [SettingsService, LlmKeyService],
})
export class SettingsModule { }
