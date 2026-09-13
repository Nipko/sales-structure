import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WidgetDeliveryModule } from '../widget/widget-delivery.module';
import { PushModule } from '../push/push.module';
import { OperationalNoticeService } from './operational-notice.service';
import { OPERATIONAL_NOTICE_DELIVERY } from './operational-notice.contracts';
import { OperationalNoticeController } from './operational-notice.controller';
import { OperationalNoticeReviewService } from './operational-notice-review.service';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';
import { SlackModule } from '../slack/slack.module';

@Module({
    imports: [BullModule.registerQueue({name:'outbound-messages'}),WidgetDeliveryModule,PushModule,SlackModule,EmailTemplatesModule],
    providers: [OperationalNoticeService,OperationalNoticeReviewService,{provide:OPERATIONAL_NOTICE_DELIVERY,useExisting:OperationalNoticeService}],
    controllers:[OperationalNoticeController],
    exports: [OperationalNoticeService,OPERATIONAL_NOTICE_DELIVERY],
})
export class OperationalNoticeModule {}
