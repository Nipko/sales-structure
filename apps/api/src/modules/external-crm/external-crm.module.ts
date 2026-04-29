import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { ExternalCrmService, CRM_SYNC_QUEUE } from './external-crm.service';
import { CrmImportService, CRM_IMPORT_QUEUE } from './crm-import.service';
import { ExternalCrmController } from './external-crm.controller';
import { ExternalCrmProcessor } from './external-crm.processor';
import { CrmImportProcessor } from './crm-import.processor';
import { CrmAdapterFactory } from './crm-adapter.factory';
import { CrmCryptoService } from './crm-crypto.service';
import { HubSpotAdapter } from './adapters/hubspot.adapter';
import { PipedriveAdapter } from './adapters/pipedrive.adapter';

@Module({
    imports: [
        PrismaModule,
        BullModule.registerQueue({ name: CRM_SYNC_QUEUE }),
        BullModule.registerQueue({ name: CRM_IMPORT_QUEUE }),
    ],
    controllers: [ExternalCrmController],
    providers: [
        ExternalCrmService,
        CrmImportService,
        ExternalCrmProcessor,
        CrmImportProcessor,
        CrmAdapterFactory,
        CrmCryptoService,
        HubSpotAdapter,
        PipedriveAdapter,
    ],
    exports: [ExternalCrmService, CrmImportService],
})
export class ExternalCrmModule {}
