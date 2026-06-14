import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { FISCAL_QUEUE } from './fiscal.constants';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalProviderFactory } from './fiscal-provider.factory';
import { FactusAdapter } from './adapters/factus.adapter';
import { UsRemoteAdapter } from './adapters/us-remote.adapter';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FiscalInvoiceProcessor } from './processors/fiscal-invoice.processor';
import { FiscalController } from './fiscal.controller';
import { FiscalAdminController } from './fiscal-admin.controller';

/**
 * Fiscal module — DIAN electronic invoicing (Colombia) via Factus, decoupled
 * from the payment provider. FiscalInvoiceService listens to normalized billing
 * events (MercadoPago/Stripe agnostic) and enqueues issuance; the processor
 * calls the resolved fiscal provider (FactusAdapter for CO_LOCAL, UsRemoteAdapter
 * for US_REMOTE). EventEmitter2 is global (app.module), so @OnEvent works here
 * without importing it.
 */
@Module({
    imports: [PrismaModule, RedisModule, BullModule.registerQueue({ name: FISCAL_QUEUE })],
    controllers: [FiscalController, FiscalAdminController],
    providers: [
        FiscalConfigService,
        FiscalProviderFactory,
        FactusAdapter,
        UsRemoteAdapter,
        FiscalInvoiceService,
        FiscalInvoiceProcessor,
    ],
    exports: [FiscalConfigService],
})
export class FiscalModule {}
