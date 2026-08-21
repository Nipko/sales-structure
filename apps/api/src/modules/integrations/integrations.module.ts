import { Global, Module } from '@nestjs/common';
import { IntegrationOutboxService } from './integration-outbox.service';

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
    providers: [IntegrationOutboxService],
    exports: [IntegrationOutboxService],
})
export class IntegrationsModule {}
