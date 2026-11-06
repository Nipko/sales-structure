import { Module } from '@nestjs/common';
import { TenantNotificationSmsService } from './tenant-notification-sms.service';

/**
 * Remnant of the retired SMS product (ADR 0018). Only `ConversationsModule`
 * still imports it, for the identity-verification fallback in
 * `chat-identity.service.ts`; `conversations/` is outside the retirement PR, so
 * the module stays as an always-refusing stub until that import is removed.
 */
@Module({
    providers: [TenantNotificationSmsService],
    exports: [TenantNotificationSmsService],
})
export class SmsCreditsModule { }
