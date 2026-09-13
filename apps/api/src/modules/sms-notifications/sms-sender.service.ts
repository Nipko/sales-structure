import { Injectable, Logger } from '@nestjs/common';
import { ChannelTokenService } from '../channels/channel-token.service';
import { SmsAdapter } from '../channels/sms/sms.adapter';
import { SmsKillSwitchService } from '../sms-credits/sms-kill-switch.service';

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
        private readonly killSwitch: SmsKillSwitchService,
    ) {}

    /** Send a transactional SMS from the tenant's Twilio number. Returns true if sent. */
    async sendToNumber(tenantId: string, to: string, body: string): Promise<boolean> {
        try {
            return !!await this.sendToNumberStrict(tenantId,to,body);
        } catch (e: any) {
            this.logger.warn(`Tenant ${tenantId} SMS to ${to} not sent: ${e.message}`);
            return false;
        }
    }

    /** Durable callers need the Twilio SID or the thrown provider outcome. */
    async sendToNumberStrict(tenantId:string,to:string,body:string):Promise<string|null> {
        if(!to||!body)return null;
        if(!(await this.killSwitch.isEnabled()))return null;
        const creds=await this.channelToken.getChannelToken(tenantId,'sms');
        const sid=await this.smsAdapter.sendTextMessage(to,body,creds.accountId,creds.accessToken);
        if(!sid)throw new Error('twilio_missing_message_sid');
        return sid;
    }
}
