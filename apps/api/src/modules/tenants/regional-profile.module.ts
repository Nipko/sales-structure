import { Global, Module } from '@nestjs/common';
import { RegionalProfileService } from './regional-profile.service';

/**
 * La identidad regional del tenant, disponible en todo el backend.
 *
 * Vive en su propio módulo global porque sus consumidores son transversales:
 * identidad de contactos, CRM, import/export, portal del cliente, SMS,
 * reservas públicas y el turno del agente. Colgarlo de `TenantsModule` obligaba
 * a cada uno de esos módulos a importar Tenants entero —con sus controladores y
 * su servicio de administración— sólo para saber en qué país opera el negocio,
 * y varios de esos imports habrían cerrado un ciclo.
 *
 * Sólo depende de Prisma y Redis, que ya son globales.
 */
@Global()
@Module({
    providers: [RegionalProfileService],
    exports: [RegionalProfileService],
})
export class RegionalProfileModule {}
