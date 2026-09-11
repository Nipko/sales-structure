import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { WhatsappSendAdmissionService } from './whatsapp-send-admission.service';
import { AccountPauseStore } from '../../channels/account-pause-store';

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
    // `AccountPauseStore` is declared here rather than in `ChannelsModule`
    // on purpose: importing that module would close a cycle through the
    // processor, and the store is a leaf that needs only Prisma.
    providers: [WhatsappSpendService, WhatsappSendAdmissionService, AccountPauseStore],
    exports: [WhatsappSpendService, WhatsappSendAdmissionService, AccountPauseStore],
})
export class WhatsappSpendModule {}
