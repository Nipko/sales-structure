import { Injectable, Logger } from '@nestjs/common';
import { ChannelTokenService } from '../channels/channel-token.service';
import { SmsAdapter } from '../channels/sms/sms.adapter';

/**
 * Transactional (non-conversational) SMS sender on the TENANT plane: sends from
 * the tenant's own Twilio number, resolved via ChannelTokenService, reusing the
 * existing SmsAdapter (no duplicated Twilio REST logic — unlike broadcast).
 *
 * Best-effort: returns false (never throws) when the tenant has no SMS channel
 * connected or the send fails, so callers can treat SMS as an optional fallback.
 *
 * Reused by handoff notifications (Phase 2) and, later, tenant OTP / subscriber
 * notifications (Phases 3-4).
 */
@Injectable()
export class SmsSenderService {
    private readonly logger = new Logger(SmsSenderService.name);

    constructor(
        private readonly channelToken: ChannelTokenService,
        private readonly smsAdapter: SmsAdapter,
    ) {}

    /** Send a transactional SMS from the tenant's Twilio number. Returns true if sent. */
    async sendToNumber(tenantId: string, to: string, body: string): Promise<boolean> {
        if (!to || !body) return false;
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, 'sms');
            // accountId = tenant's Twilio "from" number; accessToken = "accountSid:authToken"
            await this.smsAdapter.sendTextMessage(to, body, creds.accountId, creds.accessToken);
            return true;
        } catch (e: any) {
            this.logger.warn(`Tenant ${tenantId} SMS to ${to} not sent: ${e.message}`);
            return false;
        }
    }
}
