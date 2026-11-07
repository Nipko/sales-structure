import { Module } from '@nestjs/common';
import { ToolObservabilityController } from './tool-observability.controller';
import { ToolObservabilityService } from './tool-observability.service';
import { ToolUsageRecorder } from './tool-usage-recorder.service';

/**
 * Observabilidad de las tools del agente: el recorder que cuenta cada llamada
 * (lo inyecta `AIToolExecutorService`) y el panel de superadmin que la lee.
 * Prisma y el throttle son globales, así que este módulo no importa nada y no
 * puede formar un ciclo con conversaciones.
 */
@Module({
    controllers: [ToolObservabilityController],
    providers: [ToolUsageRecorder, ToolObservabilityService],
    exports: [ToolUsageRecorder],
})
export class ToolObservabilityModule { }
