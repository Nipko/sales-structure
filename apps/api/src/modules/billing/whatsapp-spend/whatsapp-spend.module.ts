import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { WhatsappSendAdmissionService } from './whatsapp-send-admission.service';
import { AccountPauseStore } from '../../channels/account-pause-store';
import { WhatsappSpendController } from './whatsapp-spend.controller';
import { WhatsappSpendMaintenanceService } from './whatsapp-spend-maintenance.service';
import { IncidentService } from '../../health/incident.service';

/**
 * The money authority, exported on its own.
 *
 * Deliberately not folded into `BillingModule`: that module is about what the
 * TENANT pays Parallly, and this one is about what the tenant's own WhatsApp
 * Business Account pays Meta. They are different payers, different rails and
 * different failure modes, and putting them behind one import is how somebody
 * ends up pausing a subscription because a WABA ran out of credit.
 */
@Module({
    imports: [PrismaModule],
    controllers: [WhatsappSpendController],
    // `AccountPauseStore` is declared here rather than in `ChannelsModule`
    // on purpose: importing that module would close a cycle through the
    // processor, and the store is a leaf that needs only Prisma. `IncidentService`
    // is declared for the same reason and with the same shape — importing
    // `HealthModule` for one writer would drag the whole monitoring graph in,
    // and an alert nobody can raise is how the sweep came to exist with no
    // caller in the first place.
    providers: [
        WhatsappSpendService, WhatsappSendAdmissionService, AccountPauseStore,
        IncidentService, WhatsappSpendMaintenanceService,
    ],
    exports: [
        WhatsappSpendService, WhatsappSendAdmissionService, AccountPauseStore,
        WhatsappSpendMaintenanceService,
    ],
})
export class WhatsappSpendModule {}
