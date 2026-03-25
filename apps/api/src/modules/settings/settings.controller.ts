import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class SettingsController {

    constructor(private settingsService: SettingsService) { }

    @Get()
    @Roles('super_admin', 'tenant_admin')
    async getSettings() {
        const settings = await this.settingsService.getSettingsForDisplay();
        return { success: true, data: settings };
    }

    @Put()
    @Roles('super_admin', 'tenant_admin')
    async updateSettings(@Body() body: Record<string, string>) {
        await this.settingsService.updateSettings(body);
        return { success: true, message: 'Settings updated' };
    }

    @Get('api-keys')
    @Roles('super_admin', 'tenant_admin')
    async getApiKeys() {
        const settings = await this.settingsService.getSettingsForDisplay();
        return { success: true, data: this.flattenSettings(settings as Record<string, any>) };
    }

    @Post('api-keys')
    @Roles('super_admin', 'tenant_admin')
    async setApiKey(@Body() body: { provider: string; key: string }) {
        if (!body?.provider) {
            return { success: false, message: 'provider is required' };
        }

        await this.settingsService.updateSettings({ [body.provider]: body.key || '' });
        return { success: true, message: 'API key updated' };
    }

    @Delete('api-keys/:provider')
    @Roles('super_admin', 'tenant_admin')
    async deleteApiKey(@Param('provider') provider: string) {
        await this.settingsService.updateSettings({ [provider]: '' });
        return { success: true, message: 'API key removed' };
    }

    private flattenSettings(settings: Record<string, any>): Record<string, string> {
        const flattened: Record<string, string> = {};

        for (const [category, value] of Object.entries(settings)) {
            if (!value || typeof value !== 'object') continue;
            for (const [field, fieldValue] of Object.entries(value)) {
                flattened[`${category}.${field}`] = fieldValue == null ? '' : String(fieldValue);
            }
        }

        return flattened;
    }
}
