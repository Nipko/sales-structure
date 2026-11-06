import { Injectable } from '@nestjs/common';

/**
 * Platform SMS transport for the dashboard-user 2FA fallback.
 *
 * SMS was retired as a product (ADR 0018) together with the platform switch
 * `sms.platform_enabled` that kept this transport off. The 2FA "send me an SMS"
 * fallback (endpoint, user columns and outbox kind `auth.access_code_sms`) is an
 * OTP concept and stays, but nothing is sent: every attempt fails before any
 * provider is contacted, exactly as it did while the switch was off, and the
 * caller answers "SMS delivery unavailable. Try email instead.". Turning SMS 2FA
 * back on is a product decision that needs a new transport and a new ADR.
 */
@Injectable()
export class PlatformSmsService {
    get enabled(): boolean {
        return false;
    }

    /** Never sends. Kept so best-effort callers keep their boolean contract. */
    async sendTo(_to: string, _body: string): Promise<boolean> {
        return false;
    }

    /** Durable callers fail in preparation, before recording that a POST may leave. */
    async prepareBoundedSend(_to: string, _body: string): Promise<() => Promise<string>> {
        throw new Error('platform_sms_retired');
    }

    async sendToStrict(to: string, body: string): Promise<string> {
        const send = await this.prepareBoundedSend(to, body);
        return send();
    }
}
