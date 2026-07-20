import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Sends platform-level SMS (e.g. 2FA login codes for dashboard users) from the
 * platform Twilio account (SMS_ALERT_ACCOUNT_SID / SMS_ALERT_AUTH_TOKEN /
 * SMS_ALERT_FROM — the same platform Twilio credentials the ops alert sender
 * uses). The dashboard has no WhatsApp channel of its own, so platform SMS is
 * the only text channel for dashboard-user 2FA. Returns false when unconfigured
 * or on error (never throws).
 */
@Injectable()
export class PlatformSmsService {
    private readonly logger = new Logger(PlatformSmsService.name);
    private readonly accountSid?: string;
    private readonly authToken?: string;
    private readonly from?: string;

    constructor(config: ConfigService) {
        this.accountSid = config.get<string>('SMS_ALERT_ACCOUNT_SID');
        this.authToken = config.get<string>('SMS_ALERT_AUTH_TOKEN');
        this.from = config.get<string>('SMS_ALERT_FROM');
    }

    get enabled(): boolean {
        return !!(this.accountSid && this.authToken && this.from);
    }

    /** Send an SMS to an arbitrary number from the platform Twilio number. */
    async sendTo(to: string, body: string): Promise<boolean> {
        if (!this.enabled || !to) return false;
        try {
            const url = `${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`;
            const params = new URLSearchParams({ To: to, From: this.from!, Body: body });
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
                },
                body: params.toString(),
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                this.logger.warn(`Platform SMS to ${to} failed: ${res.status} ${errBody.slice(0, 200)}`);
                return false;
            }
            return true;
        } catch (e: any) {
            this.logger.warn(`Platform SMS to ${to} error: ${e.message}`);
            return false;
        }
    }
}
