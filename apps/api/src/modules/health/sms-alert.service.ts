import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Sends critical platform alerts to the super_admin ops phone(s) via SMS (Twilio).
 * Separate from the per-tenant customer SMS channel — uses its own platform-level
 * SMS_ALERT_ACCOUNT_SID / SMS_ALERT_AUTH_TOKEN / SMS_ALERT_FROM / SMS_ALERT_TO.
 * No-op when unconfigured (mirrors TelegramAlertService).
 *
 * Recipients come from SMS_ALERT_TO (comma-separated E.164 numbers). SMS is
 * intrusive and costly, so the caller gates this to critical severity; the 1h
 * per-key cooldown in PlatformMonitorService.alert() already prevents spam.
 */
@Injectable()
export class SmsAlertService {
    private readonly logger = new Logger(SmsAlertService.name);
    private readonly accountSid?: string;
    private readonly authToken?: string;
    private readonly from?: string;
    private readonly to: string[];

    constructor(config: ConfigService) {
        this.accountSid = config.get<string>('SMS_ALERT_ACCOUNT_SID');
        this.authToken = config.get<string>('SMS_ALERT_AUTH_TOKEN');
        this.from = config.get<string>('SMS_ALERT_FROM');
        this.to = (config.get<string>('SMS_ALERT_TO') || '')
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean);
    }

    get enabled(): boolean {
        return !!(this.accountSid && this.authToken && this.from && this.to.length > 0);
    }

    /** Best-effort SMS to every configured super_admin number. `text` is plain text. */
    async send(text: string): Promise<void> {
        if (!this.enabled) return;
        const body = text.slice(0, 600); // keep alerts short (a few segments max)
        const url = `${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`;
        const auth = 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        for (const to of this.to) {
            try {
                const params = new URLSearchParams({ To: to, From: this.from!, Body: body });
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Authorization: auth,
                    },
                    body: params.toString(),
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) {
                    const errBody = await res.text().catch(() => '');
                    this.logger.warn(`SMS alert to ${to} failed: ${res.status} ${errBody.slice(0, 200)}`);
                }
            } catch (e: any) {
                this.logger.warn(`SMS alert to ${to} error: ${e.message}`);
            }
        }
    }
}
