import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsKillSwitchService } from '../sms-credits/sms-kill-switch.service';

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

    constructor(config: ConfigService, private readonly killSwitch: SmsKillSwitchService) {
        this.accountSid = config.get<string>('SMS_ALERT_ACCOUNT_SID');
        this.authToken = config.get<string>('SMS_ALERT_AUTH_TOKEN');
        this.from = config.get<string>('SMS_ALERT_FROM');
    }

    get enabled(): boolean {
        return !!(this.accountSid && this.authToken && this.from);
    }

    /** Send an SMS to an arbitrary number from the platform Twilio number. */
    async sendTo(to: string, body: string): Promise<boolean> {
        try {
            return !!await this.sendToStrict(to,body);
        } catch (e: any) {
            this.logger.warn(`Platform SMS to ${to} error: ${e.message}`);
            return false;
        }
    }

    /** Durable callers prepare all local checks before recording that a POST may leave. */
    async prepareBoundedSend(to:string,body:string):Promise<()=>Promise<string>>{
        if(!this.enabled||!to||!body)throw new Error('platform_sms_unavailable');
        if(!(await this.killSwitch.isEnabled()))throw new Error('platform_sms_kill_switch_disabled');
        const url=`${TWILIO_API}/Accounts/${this.accountSid}/Messages.json`;
        const params=new URLSearchParams({To:to,From:this.from!,Body:body});
        const authorization='Basic '+Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        return async()=>{
            const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
                Authorization:authorization},body:params.toString(),signal:AbortSignal.timeout(10_000)});
            const text=await res.text();
            let data:any={};
            try{data=text?JSON.parse(text):{};}catch{throw new Error(`platform_sms_invalid_response_${res.status}`);}
            if(!res.ok||data.error_code||data.status==='failed')
                throw new Error(`platform_sms_refused_${res.status}_${String(data.message||'unknown').slice(0,80)}`);
            if(!data.sid)throw new Error('platform_sms_missing_sid');
            return String(data.sid);
        };
    }

    async sendToStrict(to:string,body:string):Promise<string>{
        const send=await this.prepareBoundedSend(to,body);
        return send();
    }
}
