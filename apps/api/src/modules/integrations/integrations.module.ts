import { Global, Module } from '@nestjs/common';
import { IntegrationOutboxService } from './integration-outbox.service';
import { IntegrationOutboxWorker } from './integration-outbox.worker';
import { IntegrationsController } from './integrations.controller';
import { IntegrationWebhookWorker } from './integration-webhook.worker';
import { SystemOfRecordBoundaryService } from './system-of-record-boundary.service';

/**
 * El andamiaje compartido de integraciones.
 *
 * Global porque sus consumidores son transversales —channel manager,
 * integraciones verticales, MCP y cualquier proveedor futuro— y obligar a cada
 * uno a importar un módulo para encolar una escritura es cómo terminan
 * escribiendo su propia cola.
 *
 * Sólo depende de Prisma, que ya es global.
 */
@Global()
@Module({
    controllers: [IntegrationsController],
    providers: [
        IntegrationOutboxService,
        IntegrationOutboxWorker,
        IntegrationWebhookWorker,
        SystemOfRecordBoundaryService,
    ],
    exports: [
        IntegrationOutboxService,
        IntegrationOutboxWorker,
        IntegrationWebhookWorker,
        SystemOfRecordBoundaryService,
    ],
})
export class IntegrationsModule {}
