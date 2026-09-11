import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappSpendService } from './whatsapp-spend.service';

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
    providers: [WhatsappSpendService],
    exports: [WhatsappSpendService],
})
export class WhatsappSpendModule {}
