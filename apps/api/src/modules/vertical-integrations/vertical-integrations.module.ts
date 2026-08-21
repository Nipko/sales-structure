import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { VerticalIntegrationsService } from './vertical-integrations.service';
import { VerticalIntegrationsController } from './vertical-integrations.controller';
import { TenantSecretCryptoService } from '../../common/crypto/tenant-secret-crypto.service';

/**
 * Real vertical integrations (T3.19): Toast / Mindbody / Cliniko adapters.
 * The conversation pipeline reuses VerticalIntegrationsService to feed live
 * external data to the agent tools.
 */
@Module({
    imports: [HttpModule, PrismaModule, RedisModule],
    providers: [VerticalIntegrationsService, TenantSecretCryptoService],
    controllers: [VerticalIntegrationsController],
    exports: [VerticalIntegrationsService],
})
export class VerticalIntegrationsModule {}
