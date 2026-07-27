import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';
import { LlmKeyService } from './llm-key.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

/**
 * Configuración de PLATAFORMA (tabla global `platform_settings`): claves de
 * LLM, credenciales de Meta, defaults del motor. Nada de acá es por-tenant,
 * así que todo el controlador es super_admin: un `tenant_admin` no tiene nada
 * suyo que leer ni escribir en este store, y sí podía pisar config compartida.
 * La identidad del negocio del tenant vive en el módulo `business-info` y la
 * industria en `tenants.industry` (PATCH /tenants/:id).
 */
@Controller('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class SettingsController {

    constructor(
        private settingsService: SettingsService,
        private llmKeyService: LlmKeyService,
    ) { }

    @Get()
    @Roles('super_admin')
    async getSettings() {
        const settings = await this.settingsService.getSettingsForDisplay();
        return { success: true, data: settings };
    }

    @Put()
    @Roles('super_admin')
    async updateSettings(@Body() body: Record<string, string>) {
        const otherSettings: Record<string, string> = {};

        for (const [key, value] of Object.entries(body)) {
            // El body no está validado: un valor no-string reventaría en .includes()
            if (typeof value !== 'string') continue;
            if (this.llmKeyService.isLlmKeyField(key)) {
                if (value.includes('•••')) continue;
                const provider = this.llmKeyService.resolveProviderFromDbKey(key);
                if (provider) await this.llmKeyService.setKey(provider, value);
            } else {
                otherSettings[key] = value;
            }
        }

        if (Object.keys(otherSettings).length > 0) {
            await this.settingsService.updateSettings(otherSettings);
        }

        return { success: true, message: 'Settings updated' };
    }

    @Get('api-keys')
    @Roles('super_admin')
    async getApiKeys() {
        const data = await this.llmKeyService.getMaskedKeys();
        return { success: true, data };
    }

    @Post('api-keys')
    @Roles('super_admin')
    async setApiKey(@Body() body: { provider: string; key: string }) {
        if (!body?.provider) {
            return { success: false, message: 'provider is required' };
        }

        const providerName = this.llmKeyService.resolveProviderFromDbKey(body.provider) || body.provider;
        await this.llmKeyService.setKey(providerName, body.key || '');
        return { success: true, message: 'API key updated' };
    }

    @Delete('api-keys/:provider')
    @Roles('super_admin')
    async deleteApiKey(@Param('provider') provider: string) {
        const providerName = this.llmKeyService.resolveProviderFromDbKey(provider) || provider;
        await this.llmKeyService.deleteKey(providerName);
        return { success: true, message: 'API key removed' };
    }
}
