import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('api/v1/settings')
export class SettingsController {

    constructor(private settingsService: SettingsService) { }

    @Get()
    async getSettings() {
        const settings = await this.settingsService.getSettingsForDisplay();
        return { success: true, data: settings };
    }

    @Put()
    async updateSettings(@Body() body: Record<string, string>) {
        await this.settingsService.updateSettings(body);
        return { success: true, message: 'Settings updated' };
    }
}
